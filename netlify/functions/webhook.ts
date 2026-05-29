import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ 
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' 
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
        const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';

        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // 1. ADD TASK LOGIC
                // 1. ADD TASK LOGIC
                if (userMessage.toLowerCase().startsWith('add task:')) {
                    let rawTask = userMessage.substring(9).trim();
                    let taskName = rawTask;
                    let deadline = "-";
                    
                    // Check if the user included a deadline using the word "by"
                    if (rawTask.toLowerCase().includes(' by ')) {
                        // Split the string at " by " (case-insensitive)
                        const parts = rawTask.split(/ by /i);
                        taskName = parts[0].trim();
                        deadline = parts[1].trim();
                    }

                    // Get current time in Thailand
                    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
                    
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:D', // Expanded range to A:D
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[taskName, 'Pending', now, deadline]] }
                    });

                    // Format a nice reply
                    const replyText = deadline === "-" 
                        ? `✅ Added: "${taskName}"` 
                        : `✅ Added: "${taskName}"\n⏳ Deadline: ${deadline}`;

                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ type: 'text', text: replyText }]
                    });
                }
                // 2. AI CHAT LOGIC
                else {
                    const sheetData = await sheets.spreadsheets.values.get({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:B', 
                    });
                    const myData = JSON.stringify(sheetData.data.values || "No data");

                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                    const prompt = `You are my personal assistant. User asked: "${userMessage}". Latest data: ${myData}. Respond conversationally and concisely.`;
                    
                    const result = await model.generateContent(prompt);
                    
                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ type: 'text', text: result.response.text() }]
                    });
                }
            }
        }
        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};