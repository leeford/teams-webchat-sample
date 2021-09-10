import { Activity, ActivityHandler, BotFrameworkAdapter, ChannelAccount, ConversationParameters, ConversationReference, ConversationResourceResponse, InvokeResponse, InvokeException, MessageFactory, ResourceResponse, StatusCodes, TurnContext } from "botbuilder";
import { v4 as uuidv4 } from "uuid";
import moment from "moment";
import { CosmosDB } from "./services/CosmosDB";
import { AdaptiveCards } from "./services/AdaptiveCards";
import { IConversation } from "./models/IConversation";
import { IConversationStatus } from "./models/IConversationStatus";
import { ITeamsChannel } from "./models/ITeamsChannel";
import ChatMessage from "./cards/WebChat/ChatMessage.json";
import ChatPrompt from "./cards/WebChat/ChatPrompt.json";
import AddChannel from "./cards/Teams/AddChannel.json";
import ChannelAdded from "./cards/Teams/ChannelAdded.json"
import ChatRequest from "./cards/Teams/ChatRequest.json";

export class WebChatBot extends ActivityHandler {

    private cosmos = new CosmosDB();
    private adaptiveCards = new AdaptiveCards();

    private cardActions = [
        {
            type: "Action.ShowCard",
            title: "End chat",
            card: {
                version: "1.4",
                type: "AdaptiveCard",
                body: [
                    {
                        type: "Input.Text",
                        id: "closingNotes",
                        label: "Closing notes",
                        isMultiline: true,
                        isRequired: true,
                        errorMessage: "Closing notes are required",
                        placeholder: "Please provide some closing notes about the conversation"
                    }
                ],
                actions: [
                    {
                        type: "Action.Execute",
                        title: "Send",
                        data: {
                            action: "endChatFromTeams"
                        }
                    }
                ],
                $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
            }
        }
    ]

    constructor() {
        super();

        this.onInstallationUpdate(async (context: TurnContext, next) => {
            const addChannel = await this.adaptiveCards.createAdaptiveCardActivity(AddChannel);
            await context.sendActivity(addChannel);
            await next();
        })

        this.onMessage(async (context: TurnContext, next) => {
            switch (context.activity.channelId) {
                case "webchat":
                case "directline":
                    // Upsert conversation reference
                    await this.cosmos.upsertWebChatConversation(context);
                    // Send from Web Chat to Teams
                    await this.webChatToTeamsActivityHandler(context);
                    break;
                case "msteams":
                    // Upsert conversation reference
                    await this.cosmos.upsertTeamsConversation(context);
                    // Send from Teams to Web Chat
                    await this.teamsToWebChatActivityHandler(context);
                    break;
            }
            await next();
        });

        this.onMembersAdded(async (context: TurnContext, next) => {
            if ((context.activity.channelId === "webchat" || context.activity.channelId === "directline") && context.activity.membersAdded) {
                const teamsChannels = await this.cosmos.getTeamsChannels();
                const teamsChannelsData = teamsChannels.map(channel => ({ value: channel.id, title: channel.displayName }));
                const ChatPromptPayload = {
                    teamsChannels: teamsChannelsData
                }
                const chatPrompt = await this.adaptiveCards.createAdaptiveCardActivity(ChatPrompt, ChatPromptPayload);
                for (const member of context.activity.membersAdded) {
                    if (member.id !== context.activity.recipient.id) {
                        await context.sendActivity(chatPrompt);
                    }
                }
            }
            await next();
        });

    }

    async onInvokeActivity(context: TurnContext): Promise<InvokeResponse> {
        try {
            let responseCard: unknown;
            if (context.activity.name === "adaptiveCard/action") {
                if (context.activity.value.action.data.action) {
                    let activity: Partial<Activity> | undefined;
                    // Upsert conversation reference
                    await this.cosmos.upsertTeamsConversation(context);
                    switch (context.activity.value.action.data.action) {
                        // End conversation from Teams
                        case "endChatFromTeams": {
                            const conversation = await this.cosmos.getConversationWithTeamsConversationId(context.activity.conversation.id);
                            if (conversation) {
                                await this.endConversations(context, conversation, context.activity.value.action.data.closingNotes || undefined);
                                activity = await this.createChatRequestActivity(conversation);
                            }
                            break;
                        }
                        // Add new channel to Web Chat
                        case "addChannelToWebChat": {
                            if (context.activity.channelData.channel.id && context.activity.value.action.data.displayName) {
                                const teamsChannel: ITeamsChannel = {
                                    id: context.activity.channelData.channel.id,
                                    displayName: context.activity.value.action.data.displayName,
                                    isVisible: true
                                }
                                await this.cosmos.upsertTeamsChannel(teamsChannel);
                                const ChannelAddedPayload = {
                                    displayName: context.activity.value.action.data.displayName
                                };
                                activity = await this.adaptiveCards.createAdaptiveCardActivity(ChannelAdded, ChannelAddedPayload);
                            }
                            break;
                        }
                        default:
                            throw new InvokeException(StatusCodes.NOT_IMPLEMENTED);
                    }
                    if (activity?.attachments && activity?.attachments[0]) {
                        responseCard = activity?.attachments[0].content
                    }
                }
            }
            const body = {
                statusCode: 200,
                type: 'application/vnd.microsoft.card.adaptive',
                value: responseCard
            }
            return this.createInvokeResponse(body);
        } finally {
            this.defaultNextEvent(context)();
        }
    }

    private createInvokeResponse(body?: Record<string, unknown>): InvokeResponse {
        return { status: 200, body }
    }

    private async teamsToWebChatActivityHandler(context: TurnContext): Promise<void> {
        // Get conversation using Teams conversation ID
        const conversation = await this.cosmos.getConversationWithTeamsConversationId(context.activity.conversation.id);
        // Reply to an in-progress Teams conversation
        if (conversation && conversation.webChatConversationId && conversation.status !== IConversationStatus.ended) {
            const webChatConversation = await this.cosmos.getWebChatConversation(conversation.webChatConversationId);
            if (webChatConversation && webChatConversation.conversationReference) {
                const webChatConversationId = webChatConversation.conversationReference.conversation.id;
                if (context.activity.text) {
                    // Send message to web chat
                    const ChatMessagePayload = {
                        displayName: context.activity.from.name,
                        message: TurnContext.removeRecipientMention(context.activity),
                        sentDateTime: moment().format('llll')
                    };
                    await this.continueConversationWithActivity(context, webChatConversation.conversationReference, await this.adaptiveCards.createAdaptiveCardActivity(ChatMessage, ChatMessagePayload));
                }
                // Update to responded/in-progress
                if (conversation.status === IConversationStatus.notResponded && conversation.teamsConversationId) {
                    conversation.status = IConversationStatus.inProgress;
                    const teamsConversation = await this.cosmos.getTeamsConversation(conversation.teamsConversationId)
                    if (teamsConversation.conversationReference) {
                        const chatRequestActivity = await this.createChatRequestActivity(conversation, this.cardActions);
                        chatRequestActivity.id = conversation.teamsChatRequestActivityId;
                        await this.updateConversationWithActivity(context, teamsConversation.conversationReference, chatRequestActivity);
                    }
                }
                // Upsert with latest conversation
                conversation.webChatConversationId = webChatConversationId;
                conversation.teamsConversationId = context.activity.conversation.id;
                await this.cosmos.upsertConversation(conversation);
            }
        } else {
            // Reply stating this message is not in relation to a known in-progress Web Chat (ignore it)
            await context.sendActivity(MessageFactory.text('**Sorry, your message is not related to any in-progress Web Chat.**'));
        }
    }

    private async updateConversationWithActivity(context: TurnContext, conversationReference: ConversationReference, activity: Partial<Activity>): Promise<void> {
        const botAdapter = context.adapter as BotFrameworkAdapter;
        await botAdapter.continueConversation(conversationReference, async (turnContext: TurnContext) => {
            await turnContext.updateActivity(activity);
        });
    }

    private async continueConversationWithActivity(context: TurnContext, conversationReference: ConversationReference, activity: Partial<Activity>): Promise<ResourceResponse | undefined> {
        let resourceResponse: ResourceResponse | undefined;
        const botAdapter = context.adapter as BotFrameworkAdapter;
        await botAdapter.continueConversation(conversationReference, async (turnContext: TurnContext) => {
            resourceResponse = await turnContext.sendActivity(activity);
        });
        return resourceResponse;
    }

    private async webChatToTeamsActivityHandler(context: TurnContext): Promise<void> {
        const conversation = await this.getconversation(context.activity.conversation.id);
        // Determine what type of activity has been received
        // Text message
        if (context.activity.text) {
            // Send a reply prompt too
            if (conversation && conversation.displayName) {
                if (conversation.status !== IConversationStatus.ended) {
                    await this.sendTeamsActivity(context, MessageFactory.text(TurnContext.removeRecipientMention(context.activity)));
                } else {
                    await context.sendActivity(MessageFactory.text('**Sorry, this Web Chat has ended.**'));
                }
            } else {
                throw new Error("Unable to send Teams activity - No existing conversation found");
            }
        } else if (context.activity.value.action) {
            switch (context.activity.value.action) {
                // New chat
                case "joinChatFromWebChat": {
                    const teamsChannelId = context.activity.value.teamsChannelId;
                    const channelAccount = context.activity.from as ChannelAccount;
                    // Reply with confirmation
                    const replyActivity = MessageFactory.text('Thank you for submitting your details. Please wait and someone will be with you shortly.');
                    await context.sendActivity(replyActivity);
                    // Create new conversation object before creating Teams conversation
                    const conversation: IConversation = {
                        id: uuidv4(),
                        description: context.activity.value.description,
                        displayName: context.activity.value.displayName,
                        emailAddress: context.activity.value.emailAddress,
                        phoneNumber: context.activity.value.phoneNumber,
                        startDateTime: moment().toISOString(),
                        status: IConversationStatus.notResponded,
                        subject: context.activity.value.subject,
                        teamsChannelId: context.activity.value.teamsChannelId,
                        webChatConversationId: context.activity.conversation.id,
                    }
                    // Chat Request Activity for Teams
                    const activity = await this.createChatRequestActivity(conversation, this.cardActions);
                    // Create new conversation in Teams
                    const teamsConversation = await this.createTeamsConversation(context, channelAccount, teamsChannelId, activity, context.activity.value.displayName);
                    // Upsert new conversation
                    conversation.teamsConversationId = teamsConversation.id;
                    conversation.teamsChatRequestActivityId = teamsConversation.activityId;
                    await this.cosmos.upsertConversation(conversation);
                    break;
                }
                // End conversation from WebChat
                case "endChatFromWebChat": {
                    if (conversation) {
                        await this.endConversations(context, conversation);
                    }
                    break;
                }
            }
        }

    }

    private async sendTeamsActivity(context: TurnContext, activity: Partial<Activity>): Promise<ResourceResponse | undefined> {
        let resourceResponse: ResourceResponse | undefined;
        // Get conversation using conversation ID
        const conversation = await this.getconversation(context.activity.conversation.id);
        // Reply to an existing Teams conversation or create a new one
        if (conversation && conversation.teamsConversationId) {
            const teamsConversation = await this.cosmos.getTeamsConversation(conversation.teamsConversationId);
            // Use conversation reference to send the message
            if (teamsConversation && teamsConversation.conversationReference) {
                const teamsConversationId = teamsConversation.conversationReference.conversation.id;
                // Reply to existing conversation
                const teamsActivity = await this.addAttributionToTeamsActivity(context, activity, conversation.displayName);
                resourceResponse = await this.continueConversationWithActivity(context, teamsConversation.conversationReference, teamsActivity);
                conversation.teamsConversationId = teamsConversationId;
            } else {
                // Use conversation ID only to send message
                const botAdapter = context.adapter as BotFrameworkAdapter;
                const connectorClient = botAdapter.createConnectorClient('https://smba.trafficmanager.net/emea/');
                await connectorClient.conversations.sendToConversation(conversation.teamsConversationId, activity);
            }
            // Upsert latest conversation IDs
            conversation.webChatConversationId = context.activity.conversation.id;
            await this.cosmos.upsertConversation(conversation);
        } else {
            throw new Error("Unable to send Teams activity - No existing conversation found");
        }
        return resourceResponse;
    }

    private async createTeamsConversation(context: TurnContext, channelAccount: ChannelAccount, teamsChannelId: string, activity: Partial<Activity>, displayName: string): Promise<ConversationResourceResponse> {
        const teamsActivity = await this.addAttributionToTeamsActivity(context, activity, displayName);
        const conversationParameters = {
            bot: channelAccount,
            channelData: {
                channel: {
                    id: teamsChannelId
                }
            },
            isGroup: true,
            activity: teamsActivity
        } as ConversationParameters;
        const botAdapter = context.adapter as BotFrameworkAdapter;
        const connectorClient = botAdapter.createConnectorClient('https://smba.trafficmanager.net/emea/');
        const conversationResourceResponse = await connectorClient.conversations.createConversation(conversationParameters);
        return conversationResourceResponse;
    }

    private async addAttributionToTeamsActivity(context: TurnContext, activity: Partial<Activity>, displayName: string): Promise<Partial<Activity>> {
        activity.channelData = {
            onBehalfOf: [
                { itemId: 0, mentionType: 'person', mri: context.activity.from.id, displayname: displayName }
            ]
        }
        return activity;
    }

    private async getconversation(conversationId: string): Promise<IConversation | undefined> {
        return await this.cosmos.getConversationWithWebChatConversationId(conversationId) || await this.cosmos.getConversationWithTeamsConversationId(conversationId);
    }

    private async endConversations(context: TurnContext, conversation: IConversation, closingNotes?: string) {
        // Upsert Cosmos with ending details
        if (closingNotes) {
            conversation.closingNotes = closingNotes;
        }
        conversation.endDateTime = moment().toISOString();
        conversation.status = IConversationStatus.ended;
        await this.cosmos.upsertConversation(conversation);

        // End conversation in Teams
        // Don't use conversation reference as we may not have one (no one responded)
        if (conversation.teamsConversationId && conversation.teamsChatRequestActivityId) {
            const botAdapter = context.adapter as BotFrameworkAdapter;
            const connectorClient = botAdapter.createConnectorClient('https://smba.trafficmanager.net/emea/');
            // Add activity to notify that chat has ended
            const endConversationNotificationActivity = MessageFactory.text('**This chat has now ended.**');
            await connectorClient.conversations.sendToConversation(conversation.teamsConversationId, endConversationNotificationActivity);
            // Set chat request activity to "ended"
            // This covers being "ended" from outside Teams
            // "ended" from within Teams is handed by "onInvokeActivity" handler
            if (context.activity.channelId !== "msteams") {
                const endConversationActivity = await this.createChatRequestActivity(conversation);
                endConversationActivity.id = conversation.teamsChatRequestActivityId;
                await connectorClient.conversations.updateActivity(conversation.teamsConversationId, conversation.teamsChatRequestActivityId, endConversationActivity);
            }
        }

        // End conversation in Web Chat
        if (conversation.webChatConversationId) {
            const webChatConversation = await this.cosmos.getWebChatConversation(conversation.webChatConversationId);
            if (webChatConversation && webChatConversation.conversationReference) {
                // Add activity to notify that chat has ended
                const endConversationNotificationActivity = MessageFactory.text('**This chat has now ended. Thank you for contacting us.**')
                await this.continueConversationWithActivity(context, webChatConversation.conversationReference, endConversationNotificationActivity);
                // End the conversation
                const endConversationActivity: Partial<Activity> = {
                    type: "endOfConversation"
                }
                await this.continueConversationWithActivity(context, webChatConversation.conversationReference, endConversationActivity);
            }
        }
    }

    public async createChatRequestActivity(conversation: IConversation, cardActions?: unknown[]): Promise<Partial<Activity>> {
        // Facts
        const factSet = [];
        if (conversation.startDateTime) { factSet.push({ title: "Started", value: moment(conversation.startDateTime).format('llll') }) }
        if (conversation.endDateTime) { factSet.push({ title: "Ended", value: moment(conversation.endDateTime).format('llll') }) }
        if (conversation.displayName) { factSet.push({ title: "Requested by", value: conversation.displayName }) }
        if (conversation.emailAddress) { factSet.push({ title: "Email address", value: conversation.emailAddress }) }
        if (conversation.phoneNumber) { factSet.push({ title: "Phone number", value: conversation.phoneNumber }) }
        if (conversation.description) { factSet.push({ title: "Description", value: conversation.description }) }
        if (conversation.closingNotes) { factSet.push({ title: "Closing notes", value: conversation.closingNotes }) }

        const ChatRequestPayload = {
            status: conversation.status,
            subject: conversation.subject,
            webChatConversationId: conversation.webChatConversationId,
            factSet
        };
        return await this.adaptiveCards.createAdaptiveCardActivity(ChatRequest, ChatRequestPayload, cardActions);
    }

}
