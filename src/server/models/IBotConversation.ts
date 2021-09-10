import { ConversationReference } from "botbuilder";

export interface IBotConversation {
    id: string;
    conversationReference?: ConversationReference;
}