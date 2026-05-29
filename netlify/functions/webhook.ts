import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' });
// IMPORTANT: Use gemini-1.5-flash as it has native audio stream support in the API
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
                    // Fetch the audio stream from LINE
                    const stream = await lineClient.getMessageContent(event.message.id);
                    
                    // Convert stream to Base64
                    const buffer = await new Promise<Buffer>((resolve, reject) => {
                        const chunks: any[] = [];
                        stream.on('data', (chunk) => chunks.push(chunk));
                        stream.on('end', () => resolve(Buffer.concat(chunks)));
                        stream.on('error', reject);
                    });
                    const base64Audio = buffer.toString('base64');

                    // Send to Gemini to transcribe
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const prompt = "Transcribe this audio. If the user is giving a task, return EXACTLY the phrase 'add task: ' followed by the task and deadline (e.g., 'add task: buy groceries by tomorrow'). Otherwise, just return the transcription.";
                    
                    const result = await model.generateContent([
                        prompt,
                        { inlineData: { data: base64Audio, mimeType: "audio/mp4" } }
                    ]);
                    
                    userMessage = result.response.text().trim();
                }
            }

            // --- 2. PROCESS THE MESSAGE (Text or Transcribed Audio) ---
            if (userMessage) {
                // If it's a LIFF trigger
                if (userMessage.toLowerCase().trim() === 'add task') {
                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ type: 'text', text: '📝 Click here to open the Task Form:\nhttps://liff.line.me/YOUR_LIFF_ID_HERE' }]
                    });
                    continue;
                }
                
                // If it's a task creation command
                else if (userMessage.toLowerCase().startsWith('add task:')) {
                    let rawTask = userMessage.substring(9).trim();
                    let taskName = rawTask;
                    let deadline = "-";
                    
                    if (rawTask.toLowerCase().includes(' by ')) {
                        const parts = rawTask.split(/ by /i);
                        taskName = parts[0].trim();
                        deadline = parts[1].trim();
                    }

                    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
                    
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId, range: 'Sheet1!A:D', valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[taskName, 'Pending', now, deadline]] }
                    });

                    // If it was voice, let them know what the bot heard
                    let replyText = deadline === "-" ? `✅ Added: "${taskName}"` : `✅ Added: "${taskName}"\n⏳ Due: ${deadline}`;
                    if (isVoice) replyText = `🎙️ Heard: "${taskName}"\n` + replyText;

                    await lineClient.replyMessage({ replyToken: event.replyToken || '', messages: [{ type: 'text', text: replyText }] });
                } 
                
                // General AI Chat
                else {
                    const sheetData = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId, range: 'Sheet1!A:D' });
                    const myData = JSON.stringify(sheetData.data.values || "No data");
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    
                    let replyPrefix = isVoice ? `🎙️ Heard: "${userMessage}"\n\n` : "";
                    const result = await model.generateContent(`You are my personal assistant. User asked: "${userMessage}". Latest data from Google Sheet: ${myData}. Respond conversationally and concisely.`);
                    
                    await lineClient.replyMessage({ replyToken: event.replyToken || '', messages: [{ type: 'text', text: replyPrefix + result.response.text() }] });
                }
            }
        }
        return new Response("OK", { status: 200 });
        
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};