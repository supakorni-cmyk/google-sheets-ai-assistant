import { Config } from "@netlify/functions";
import { messagingApi } from '@line/bot-sdk';
import { google } from 'googleapis';

const lineClient = new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '' });
const sheetsAuth = new google.auth.JWT({ email: process.env.GOOGLE_CLIENT_EMAIL || '', key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

export default async (req: Request) => {
    try {
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
            range: 'Sheet1!A2:D', 
        });
        
        const rows = sheetData.data.values || [];
        const pendingTasks = rows.filter(row => row[1] !== 'Done');
        
        if (pendingTasks.length === 0) return new Response("No tasks today", { status: 200 });

        // Get dates for Thailand timezone
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
        const todayStr = now.toLocaleDateString();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString();

        // Build Flex Message Array
        const taskContents: any[] = [];

        pendingTasks.forEach((task) => {
            const taskName = task[0] || "Unknown Task";
            const rawDeadline = task[3] || "-";
            let displayIcon = "⚪";
            let color = "#333333";

            // Check deadlines
            if (rawDeadline !== "-") {
                const deadlineDate = new Date(rawDeadline).toLocaleDateString();
                if (deadlineDate === todayStr) {
                    displayIcon = "🚨"; color = "#ef4444"; // Urgent Red
                } else if (deadlineDate === tomorrowStr) {
                    displayIcon = "⏳"; color = "#f59e0b"; // Warning Orange
                }
            }

            taskContents.push({
                type: "box",
                layout: "horizontal",
                contents: [
                    { type: "text", text: displayIcon, flex: 1, size: "sm" },
                    { type: "text", text: taskName, flex: 8, size: "sm", color: color, wrap: true }
                ],
                margin: "md"
            });
        });

        // The Flex Message Payload
        const flexMessage = {
            type: "flex",
            altText: "☀️ Your Daily Task Summary",
            contents: {
                type: "bubble",
                body: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                        { type: "text", text: "☀️ Daily Summary", weight: "bold", size: "xl", color: "#10a37f" },
                        { type: "separator", margin: "md" },
                        { type: "box", layout: "vertical", margin: "md", contents: taskContents }
                    ]
                }
            }
        };

        // Note: PushMessage ignores TypeScript strict typing for Flex objects in older bot-sdk versions, 
        // so we cast it to any to prevent compiler errors.
        await lineClient.pushMessage({
            to: process.env.LINE_USER_ID || '',
            messages: [flexMessage as any]
        });

        return new Response("Sent", { status: 200 });
    } catch (error) {
        console.error("Notify Error:", error);
        return new Response("Internal Error", { status: 500 });
    }
};

export const config: Config = { schedule: "0 1 * * *" };