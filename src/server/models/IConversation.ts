import { IConversationStatus } from "./IConversationStatus";

export interface IConversation {
    id: string;
    displayName: string;
    description: string;
    emailAddress: string;
    endDateTime?: string;
    phoneNumber?: string;
    startDateTime: string;
    status: IConversationStatus;
    subject: string;
    teamsChannelId: string;
    teamsConversationId?: string;
    teamsChatRequestActivityId?: string;
    webChatConversationId: string;
    closingNotes?: string;
}