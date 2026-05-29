import { Context } from "@netlify/functions";
import { google } from 'googleapis';

const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

export default async (req: Request, context: Context) => {
    const url = new URL(req.url);
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';

    try {
        // 1. GET TASKS
        if (url.searchParams.get("action") === "getTasks") {
            const sheetData = await sheets.spreadsheets.values.get({
                spreadsheetId, range: 'Tasks!A:F', 
            });
            const rows = sheetData.data.values || [];
            const tasks = rows.map((row, index) => ({ rowNumber: index + 1, data: row }));
            return new Response(JSON.stringify(tasks), { headers: { "Content-Type": "application/json" } });
        }

        // 2. GET FINANCES
        if (url.searchParams.get("action") === "getFinances") {
            const sheetData = await sheets.spreadsheets.values.get({
                spreadsheetId, range: 'Finances!A:D', 
            });
            return new Response(JSON.stringify(sheetData.data.values || []), { headers: { "Content-Type": "application/json" } });
        }

        // 3. UPDATE TASK STATUS (For Kanban Drag & Drop)
        if (url.searchParams.get("action") === "updateTaskStatus" && req.method === "POST") {
            const body = await req.json();
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `Tasks!B${body.rowNumber}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[body.status]] }
            });
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        // 4. DELETE TASK
        if (url.searchParams.get("action") === "deleteTask" && req.method === "POST") {
            const body = await req.json();
            await sheets.spreadsheets.values.clear({
                spreadsheetId,
                range: `Tasks!A${body.rowNumber}:F${body.rowNumber}` 
            });
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }

        return new Response("Not Found", { status: 404 });
    } catch (error) {
        console.error("API Error:", error);
        return new Response("Internal Server Error", { status: 500 });
    }
};