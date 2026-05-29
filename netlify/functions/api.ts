import { Context } from "@netlify/functions";
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const sheetsAuth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL || '',
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

export default async (req: Request, context: Context) => {
    const url = new URL(req.url);
    const spreadsheetId = process.env.GOOGLE_SHEET_ID || '';
    
    // 1. GET DATA (Updated to include Row Numbers)
    if (url.searchParams.get("action") === "getSheetData") {
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A:D', 
        });
        
        const rows = sheetData.data.values || [];
        // Map data to include the exact Google Sheet row number
        const rowsWithNumbers = rows.map((row, index) => ({
            rowNumber: index + 1,
            data: row
        }));
        
        return new Response(JSON.stringify(rowsWithNumbers), {
            headers: { "Content-Type": "application/json" }
        });
    }

    // 2. CREATE TASK
    if (url.searchParams.get("action") === "createTask" && req.method === "POST") {
        const body = await req.json();
        const now = new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" });
        const deadline = body.deadline || "-";

        await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A:D',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[body.task, 'Pending', now, deadline]] }
        });
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    // 3. UPDATE STATUS (Mark Done / Pending)
    if (url.searchParams.get("action") === "updateStatus" && req.method === "POST") {
        const body = await req.json();
        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `Sheet1!B${body.rowNumber}`, // Update Column B
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[body.status]] }
        });
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" }});
    }

    // 4. EDIT TASK NAME
    if (url.searchParams.get("action") === "editTask" && req.method === "POST") {
        const body = await req.json();
        await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: `Sheet1!A${body.rowNumber}`, // Update Column A
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[body.newName]] }
        });
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" }});
    }

    // 5. DELETE TASK
    if (url.searchParams.get("action") === "deleteTask" && req.method === "POST") {
        const body = await req.json();
        // We use "clear" to empty the row so we don't mess up the sheet structure
        await sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: `Sheet1!A${body.rowNumber}:D${body.rowNumber}` 
        });
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" }});
    }

    // 6. ASK AI
    if (url.searchParams.get("action") === "askAI" && req.method === "POST") {
        const body = await req.json();
        const sheetData = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId, range: 'Sheet1!A:D' });
        const myData = JSON.stringify(sheetData.data.values || "No data");

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `You are a helpful assistant. The user asked: "${body.question}". Here is their current data: ${myData}`;
        
        const result = await model.generateContent(prompt);
        return new Response(JSON.stringify({ answer: result.response.text() }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    return new Response("Not Found", { status: 404 });
};