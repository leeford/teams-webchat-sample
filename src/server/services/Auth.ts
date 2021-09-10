import "isomorphic-fetch"
import { v4 as uuidv4 } from "uuid";

export async function getWebChatToken(): Promise<Record<string, unknown>> {
    // Generate unique user ID
    const userId = `dl_${uuidv4()}`;
    const url = "https://directline.botframework.com/v3/directline/tokens/generate";
    const headers = {
        Authorization: `Bearer ${process.env.BotDirectLineSecret}`,
        'Content-Type': 'application/json'
    };
    const body = {
        user: {
            id: userId,
            name: "webChatUser"
        }
    }

    const response = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) })
    const { token } = await response.json();
    return { userId, token };
}
