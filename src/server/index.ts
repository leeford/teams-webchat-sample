import * as path from "path";
import { config } from "dotenv";
import express from "express";
import { BotFrameworkAdapter, TurnContext } from "botbuilder";
import { WebChatBot } from "./bot";
import { getWebChatToken } from "./services/Auth";

const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

// Bot
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
});

const onTurnErrorHandler = async (context: TurnContext, error: unknown) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    await context.sendActivity('Sorry, we encountered an error. Please try again later.');
};

adapter.onTurnError = onTurnErrorHandler;

const bot = new WebChatBot();

// HTTP server
const app = express();
const port = process.env.port || process.env.PORT || 3978;

// Bot messages
app.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (context) => {
        await bot.run(context);
    });
});

// Token issuing for Web Chat
app.post('/api/tokens', async (req, res) => {
    const token = await getWebChatToken();
    res.status(200).send(token);
});

// Listen on root
app.use("/webChat", express.static(path.join(__dirname, "webChat/"), {
    index: "index.html"
}));

// Listen on port
app.listen(port, () => {
    console.log(`\nListening on port: ${port}`);
});
