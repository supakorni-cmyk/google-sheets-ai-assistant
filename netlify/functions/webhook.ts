import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

// 1. Initialize API Clients
const lineClient = new messagingApi.MessagingApiClient({ 
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' 
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 2. Setup Google Sheets Auth
const sheetsAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

// 3. Main Webhook Handler
export default async (req: Request, context: Context) => {
    // LINE sends POST requests
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    
    try {
        const body = await req.json();
        const events: webhook.Event[] = body.events;
        const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';

        for (const event of events) {
            // Only process text messages
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // --- LOGIC BRANCH 1: TRIGGER LIFF FORM ---
                if (userMessage.toLowerCase().trim() === 'add task') {
                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ 
                            type: 'text', 
                            text: '📝 Click here to open the Task Form:\nhttps://liff.line.me/2010230678-8eqN4V5B' 
                        }]
                    });
                    continue; // Skip the rest of the loop
                }

                // --- LOGIC BRANCH 2: SAVE TASK FROM TEXT OR LIFF ---
                else if (userMessage.toLowerCase().startsWith('add task:')) {
                    let rawTask = userMessage.substring(9).trim();
                    let taskName = rawTask;
                    let deadline = "-";
                    
                    // Check if the user included a deadline using the word "by"
                    if (rawTask.toLowerCase().includes(' by ')) {
                        const parts = rawTask.split(/ by /i);
                        taskName = parts[0].trim();
                        deadline = parts[1].trim();
                    }

                    // Get current time in Bangkok timezone
                    const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
                    
                    // Append 4 columns: Task, Status, Date Added, Deadline
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:D', 
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[taskName, 'Pending', now, deadline]] }
                    });

                    // Format a dynamic reply based on whether a deadline was provided
                    const replyText = deadline === "-" 
                        ? `✅ Added: "${taskName}"` 
                        : `✅ Added: "${taskName}"\n⏳ Deadline: ${deadline}`;

                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ type: 'text', text: replyText }]
                    });
                } 
                
                // --- LOGIC BRANCH 3: AI ASSISTANT CHAT ---
                else {
                    // Fetch the latest context from Google Sheets (Columns A through D)
                    const sheetData = await sheets.spreadsheets.values.get({
                        spreadsheetId: spreadsheetId,
                        range: 'Sheet1!A:D', 
                    });
                    const myData = JSON.stringify(sheetData.data.values || "No data");

                    // Send the user's question and their sheet data to Gemini
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                    const prompt = `You are my personal assistant. The user asked: "${userMessage}". Here is the latest data from their Google Sheet to help you answer: ${myData}. Respond conversationally, accurately, and concisely.`;
                    
                    const result = await model.generateContent(prompt);
                    
                    // Reply to the user with the AI's answer
                    await lineClient.replyMessage({
                        replyToken: event.replyToken || '',
                        messages: [{ type: 'text', text: result.response.text() }]
                    });
                }
            }
        }
        
        // Always return 200 OK to LINE
        return new Response("OK", { status: 200 });
        
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};