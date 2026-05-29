import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

// Initialize Clients
const lineClient = new messagingApi.MessagingApiClient({ 
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' 
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Setup Google Sheets Auth
const sheetsAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

export default async (req: Request, context: Context) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    
    try {
        const body = await req.json();
        const events: webhook.Event[] = body.events;

        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // Fetch data from Google Sheets
                const sheetData = await sheets.spreadsheets.values.get({
                    spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
                    range: 'Sheet1!A1:B10', 
                });
                
                const myData = JSON.stringify(sheetData.data.values || "No data found");

                // Process with Gemini AI
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const prompt = `You are my personal assistant. 
                User asked: "${userMessage}". 
                Here is the latest data from their Google Sheet: ${myData}. 
                Respond conversationally and concisely.`;
                
                const result = await model.generateContent(prompt);
                
                // Reply to LINE
                await lineClient.replyMessage({
                    replyToken: event.replyToken || '',
                    messages: [{ type: 'text', text: result.response.text() }]
                });
            }
        }
        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};