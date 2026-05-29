import { Context } from "@netlify/functions";
import { messagingApi, webhook } from '@line/bot-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ 
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' 
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/calendar']
});
const sheets = google.sheets({ version: 'v4', auth });
const calendar = google.calendar({ version: 'v3', auth });

export default async (req: Request, context: Context) => {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    
    try {
        const body = await req.json();
        const events: webhook.Event[] = body.events;
        const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
        const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

        for (const event of events) {
            // 1. HANDLE AUDIO MESSAGES
            if (event.type === 'message' && event.message.type === 'audio') {
                await lineClient.replyMessage({
                    replyToken: event.replyToken || '',
                    messages: [{ type: 'text', text: "🎙️ I received your audio! (Voice processing logic will be activated soon)." }]
                });
                continue;
            }

            // 2. HANDLE TEXT MESSAGES (THE MASTER ROUTER)
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // Tell Gemini to strictly return a JSON structure determining the user's intent
                const systemPrompt = `You are an elite personal assistant. Analyze the user's message.
                Decide if the user is logging an EXPENSE, adding a TASK, or having a general CHAT.
                Return ONLY a valid JSON object matching this structure:
                {
                    "intent": "TASK" | "EXPENSE" | "CHAT",
                    "taskData": {"name": "", "deadline_iso": "", "category": "Work|Personal|Errand", "estMinutes": 30},
                    "expenseData": {"item": "", "amount": 0, "category": "Food|Transport|Bills|Misc"},
                    "reply": "Your friendly conversational reply to the user"
                }
                If it's a task with a timeframe, estimate the ISO 8601 deadline. Today is ${new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" })}`;

                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    generationConfig: { responseMimeType: "application/json" } 
                });
                
                const result = await model.generateContent(`${systemPrompt}\n\nUser Message: "${userMessage}"`);
                const aiDecision = JSON.parse(result.response.text());

                const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });

                // -- ROUTE A: EXPENSE LOGGING --
                if (aiDecision.intent === 'EXPENSE') {
                    const ex = aiDecision.expenseData;
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Finances!A:D',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[now, ex.item, ex.amount, ex.category]] }
                    });
                }

                // -- ROUTE B: TASK CREATION & CALENDAR SYNC --
                else if (aiDecision.intent === 'TASK') {
                    const tk = aiDecision.taskData;
                    
                    // 1. Save to Sheet (Columns: Task, Status, Category, Time, Date Added, Deadline)
                    await sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: 'Tasks!A:F',
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[tk.name, 'Pending', tk.category, `${tk.estMinutes} mins`, now, tk.deadline_iso || "-"]] }
                    });

                    // 2. Add to Google Calendar (If a deadline/time was parsed)
                    if (tk.deadline_iso) {
                        const endTime = new Date(tk.deadline_iso);
                        const startTime = new Date(endTime.getTime() - (tk.estMinutes * 60000)); // Subtract estimated minutes
                        
                        await calendar.events.insert({
                            calendarId: calendarId,
                            requestBody: {
                                summary: `[AI] ${tk.name}`,
                                start: { dateTime: startTime.toISOString() },
                                end: { dateTime: endTime.toISOString() },
                            }
                        });
                    }
                }

                // Send the conversational reply Gemini generated back to the user
                await lineClient.replyMessage({
                    replyToken: event.replyToken || '',
                    messages: [{ type: 'text', text: aiDecision.reply }]
                });
            }
        }
        return new Response("OK", { status: 200 });
        
    } catch (error) {
        console.error("Webhook Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};