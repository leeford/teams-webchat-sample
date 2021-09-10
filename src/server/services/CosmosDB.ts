import { CosmosClient, CosmosClientOptions, FeedOptions, SqlQuerySpec } from "@azure/cosmos";
import { ConversationReference, TurnContext } from "botbuilder";
import { IBotConversation } from "../models/IBotConversation";
import { IConversation } from "../models/IConversation";
import { ITeamsChannel } from "../models/ITeamsChannel";

export class CosmosDB {

    private database: string;
    private client: CosmosClient;

    private containerConversations = "conversations";
    private containerTeamsChannels = "teamsChannels";
    private containerTeamsConversations = "teamsConversations";
    private containerWebChatConversations = "webChatConversations";

    constructor() {

        const endpoint = process.env.CosmosDbUri as string;
        const key = process.env.CosmosDbKey as string;
        this.database = process.env.CosmosDbDatabase as string;

        const cosmosClientOptions: CosmosClientOptions = { endpoint, key };
        this.client = new CosmosClient(cosmosClientOptions);

        // Create DB (if it doesn't exist)
        this.client.databases.createIfNotExists({ id: this.database });

        // Create Containers (if they doesn't exist)
        this.ensureContainer(this.containerConversations, "/id");
        this.ensureContainer(this.containerTeamsChannels, "/id");
        this.ensureContainer(this.containerTeamsConversations, "/id");
        this.ensureContainer(this.containerWebChatConversations, "/id");

    }

    /**
     * Ensure container exists before operation
     *
     * @param container Container
     * @param partitionKey Property to be used as partition key
     */
    private async ensureContainer(container: string, partitionKey?: string): Promise<void> {
        await this.client.database(this.database).containers.createIfNotExists({ id: container, partitionKey: partitionKey || "/id" });
    }

    /**
     * Generic method for retuning all items of a container using a query. Returns results or an empty type array
     *
     * @param containerName Container
     * @param query SQL-like query
     * @param feedOptions Cosmos feed options
     * @returns Array of typed items
     */
    private async getItems<T>(containerName: string, query: SqlQuerySpec, feedOptions?: FeedOptions): Promise<T[]> {
        const result = await this.client
            .database(this.database)
            .container(containerName)
            .items
            .query(query, feedOptions)
            .fetchAll();

        if (result.resources && result.resources.length > 0) {
            return result.resources;
        }

        // return an empty array if no results are received from Cosmos
        return [] as T[];
    }

    /**
     * Generic method for getting an item from a Cosmos container
     *
     * @param id Id of item
     * @param containerName Container
     * @param partitionKey Partition key of item
     * @returns Item
     */
    private async getItem<T>(id: string, containerName: string, partitionKey?: string): Promise<T> {
        const { resource: item } = await this.client
            .database(this.database)
            .container(containerName)
            .item(id, (partitionKey || id))
            .read();
        return item;
    }

    /**
     * Generic method for upserting (update if exists, otherwise create) item into a Cosmos container
     *
     * @param itemToUpsert Item
     * @param containerName Container
     * @returns Upserted item
     */
    private async upsertItem<T>(itemToUpsert: T, containerName: string): Promise<any> {
        const { resource: upsertedItem } = await this.client
            .database(this.database)
            .container(containerName)
            .items
            .upsert(itemToUpsert);
        return upsertedItem;
    }

    async getConversationWithWebChatConversationId(webChatConversationId: string): Promise<IConversation | undefined> {
        const querySpec: SqlQuerySpec = {
            query: "SELECT * FROM c WHERE c.webChatConversationId = @webChatConversationId",
            parameters: [
                { name: "@webChatConversationId", value: webChatConversationId }
            ]
        };

        const conversations = await this.getItems<IConversation>(this.containerConversations, querySpec);

        return conversations.length === 0
            ? undefined
            : conversations[0];
    }

    async getConversationWithTeamsConversationId(teamsConversationId: string): Promise<IConversation | undefined> {
        const querySpec: SqlQuerySpec = {
            query: "SELECT * FROM c WHERE c.teamsConversationId = @teamsConversationId",
            parameters: [
                { name: "@teamsConversationId", value: teamsConversationId }
            ]
        };

        const conversations = await this.getItems<IConversation>(this.containerConversations, querySpec);

        return conversations.length === 0
            ? undefined
            : conversations[0];
    }

    async getTeamsConversation(conversationId: string): Promise<IBotConversation> {
        return await this.getItem<IBotConversation>(conversationId, this.containerTeamsConversations, conversationId);
    }

    async getWebChatConversation(conversationId: string): Promise<IBotConversation> {
        return await this.getItem<IBotConversation>(conversationId, this.containerWebChatConversations, conversationId);
    }

    async getTeamsChannels(): Promise<ITeamsChannel[]> {
        const querySpec: SqlQuerySpec = {
            query: "SELECT * FROM c WHERE c.isVisible = true ORDER BY c.displayName ASC"
        };
        const teamsChannels = await this.getItems<ITeamsChannel>(this.containerTeamsChannels, querySpec);

        return teamsChannels;
    }

    async upsertConversation(conversation: IConversation): Promise<IConversation> {
        return await this.upsertItem<IConversation>(conversation, this.containerConversations);
    }

    async upsertTeamsConversation(context: TurnContext): Promise<IBotConversation> {
        const conversation: IBotConversation = {
            id: context.activity.conversation.id,
            conversationReference: TurnContext.getConversationReference(context.activity) as ConversationReference
        }
        return await this.upsertItem<IBotConversation>(conversation, this.containerTeamsConversations);
    }

    async upsertWebChatConversation(context: TurnContext): Promise<IBotConversation> {
        const conversation: IBotConversation = {
            id: context.activity.conversation.id,
            conversationReference: TurnContext.getConversationReference(context.activity) as ConversationReference
        }
        return await this.upsertItem<IBotConversation>(conversation, this.containerWebChatConversations);
    }

    async upsertTeamsChannel(teamsChannel: ITeamsChannel): Promise<ITeamsChannel> {
        return await this.upsertItem<ITeamsChannel>(teamsChannel, this.containerTeamsChannels);
    }
}
