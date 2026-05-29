import { Config } from "@netlify/functions";
import { messagingApi } from '@line/bot-sdk';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ 
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' 
});

const sheetsAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

export default async (req: Request) => {
    try {
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
            range: 'Sheet1!A2:B', 
        });
        
        const rows = sheetData.data.values || [];
        const pendingTasks = rows.filter(row => row[1] !== 'Done');
        
        if (pendingTasks.length === 0) return new Response("No tasks today", { status: 200 });

        let messageText = "☀️ Good morning! Here is your pending to-do list:\n\n";
        pendingTasks.forEach((task, index) => {
            messageText += `${index + 1}. ${task[0]}\n`;
        });

        await lineClient.pushMessage({
            to: process.env.LINE_USER_ID || '',
            messages: [{ type: 'text', text: messageText.trim() }]
        });

        return new Response("Sent", { status: 200 });
    } catch (error) {
        console.error("Notify Error:", error);
        return new Response("Internal Error", { status: 500 });
    }
};

// Runs at 8:00 AM Thailand Time (1:00 AM UTC)
export const config: Config = {
    schedule: "0 1 * * *" 
};