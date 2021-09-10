import * as ACData from "adaptivecards-templating";
import { Activity, CardFactory, MessageFactory } from "botbuilder";

export class AdaptiveCards {

    /**
     * Creates an activity to be send to the bot conversation using a specified template and data
     *
     * @param cardDefinition JSON definition of the card
     * @param cardPayload Data to be merged with the card template
     * @returns Activity to be sent to the bot conversation
     */
    public async createAdaptiveCardActivity(cardDefinition: Record<string, unknown>, cardPayload?: Record<string, unknown>, cardActions?: unknown[]): Promise<Partial<Activity>> {
        const template = new ACData.Template(cardDefinition);
        const cardPayloadObject = template.expand({ $root: cardPayload });
        const card = CardFactory.adaptiveCard(cardPayloadObject);
        cardActions?.forEach((action) => {
            card.content.actions.push(action);
        })
        return MessageFactory.attachment(card);
    }

}