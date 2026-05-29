import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' });
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
            let userMessage = "";
            let isVoice = false;

            // --- 1. CAPTURE TEXT OR VOICE ---
            if (event.type === 'message') {
                if (event.message.type === 'text') {
                    userMessage = event.message.text;
                } 
                else if (event.message.type === 'audio') {
                    isVoice = true;
                    const stream = await blobClient.getMessageContent(event.message.id);
                    const buffer = await new Promise<Buffer>((resolve, reject) => {
                        const chunks: any[] = [];
                        stream.on('data', (chunk: any) => chunks.push(chunk));
                        stream.on('end', () => resolve(Buffer.concat(chunks)));
                        stream.on('error', reject);
                    });
                    const base64Audio = buffer.toString('base64');

                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const prompt = "Transcribe this audio. If giving a task, return EXACTLY 'add task: [task] by [deadline]'. If logging an expense, return EXACTLY 'spent: [amount] on [item]'. Otherwise just transcribe it.";
                    
                    const result = await model.generateContent([ prompt, { inlineData: { data: base64Audio, mimeType: "audio/mp4" } } ]);
                    userMessage = result.response.text().trim();
                }
            }

            // --- 2. PROCESS COMMANDS ---
            if (userMessage) {
                const messageEvent = event as webhook.MessageEvent;
                const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });

                // COMMAND: OPEN LIFF FORM
                if (userMessage.toLowerCase().trim() === 'add task') {
                    await lineClient.replyMessage({
                        replyToken: messageEvent.replyToken || '',
                        messages: [{ type: 'text', text: '📝 Click here to open the Task Form:\nhttps://liff.line.me/2010230678-8eqN4V5B' }]
                    });
                    continue;
                }
                
                // COMMAND: LOG EXPENSE (FINANCES)
                // COMMAND: LOG EXPENSE (FINANCES)
                else if (userMessage.toLowerCase().startsWith('spent:')) {
                    let rawText = userMessage.substring(6).trim(); // e.g. "150 on coffee"
                    let amount = 0;
                    let item = rawText;
                    
                    // Pull the number and the item
                    const parts = rawText.split(' ');
                    if (!isNaN(parseFloat(parts[0]))) {
                        amount = parseFloat(parts[0]);
                        item = parts.slice(1).join(' ').replace(/^on /i, '').trim();
                    }

                    // --- NEW: AUTO-CATEGORIZER ---
                    let category = 'Misc';
                    const lowerItem = item.toLowerCase();
                    
                    if (/(coffee|food|lunch|dinner|breakfast|snack|pad thai|restaurant|groceries|water)/i.test(lowerItem)) {
                        category = 'Food';
                    } else if (/(gas|petrol|taxi|grab|bts|mrt|train|bus|transport|toll)/i.test(lowerItem)) {
                        category = 'Transport';
                    } else if (/(bill|electric|rent|internet|phone|netflix|spotify|subscription)/i.test(lowerItem)) {
                        category = 'Bills';
                    } else if (/(shirt|shoes|clothes|mall|amazon|shopee|lazada)/i.test(lowerItem)) {
                        category = 'Shopping';
                    } else if (/(movie|cinema|game|concert|party)/i.test(lowerItem)) {
                        category = 'Entertainment';
                    }
                    // -----------------------------

                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId, range: 'Finances!A:D', valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[now, item, amount, category]] }
                    });

                    let replyText = `💸 Logged: ฿${amount} for "${item}"\n📂 Category: ${category}`;
                    if (isVoice) replyText = `🎙️ Heard: "${userMessage}"\n` + replyText;

                    await lineClient.replyMessage({ 
                        replyToken: messageEvent.replyToken || '', 
                        messages: [{ type: 'text', text: replyText }] 
                    });
                }

                // COMMAND: ADD TASK
                else if (userMessage.toLowerCase().startsWith('add task:')) {
                    let rawTask = userMessage.substring(9).trim();
                    let taskName = rawTask;
                    let deadline = "-";
                    
                    if (rawTask.toLowerCase().includes(' by ')) {
                        const parts = rawTask.split(/ by /i);
                        taskName = parts[0].trim();
                        deadline = parts[1].trim();
                    }
                    
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId, range: 'Tasks!A:F', valueInputOption: 'USER_ENTERED',
                        // Format: [Task, Status, Category, Time, Added, Deadline]
                        requestBody: { values: [[taskName, 'Pending', '', '', now, deadline]] }
                    });

                    let replyText = deadline === "-" ? `✅ Added: "${taskName}"` : `✅ Added: "${taskName}"\n⏳ Due: ${deadline}`;
                    if (isVoice) replyText = `🎙️ Heard: "${taskName}"\n` + replyText;

                    await lineClient.replyMessage({ replyToken: messageEvent.replyToken || '', messages: [{ type: 'text', text: replyText }] });
                } 
                
                // DEFAULT: AI CHAT
                else {
                    const sheetData = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId, range: 'Tasks!A:F' });
                    const myData = JSON.stringify(sheetData.data.values || "No data");
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    
                    let replyPrefix = isVoice ? `🎙️ Heard: "${userMessage}"\n\n` : "";
                    const result = await model.generateContent(`You are my assistant. User asked: "${userMessage}". Latest Tasks: ${myData}. Respond concisely.`);
                    
                    await lineClient.replyMessage({ replyToken: messageEvent.replyToken || '', messages: [{ type: 'text', text: replyPrefix + result.response.text() }] });
                }
            }
        }
        return new Response("OK", { status: 200 });
        
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};