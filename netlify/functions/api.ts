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
    
    if (url.searchParams.get("action") === "getSheetData") {
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A:B', 
        });
        
        return new Response(JSON.stringify(sheetData.data.values || []), {
            headers: { "Content-Type": "application/json" }
        });
    }

    if (url.searchParams.get("action") === "createTask" && req.method === "POST") {
        const body = await req.json();
        await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A:B',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[body.task, 'Pending']] }
        });
        
        return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    if (url.searchParams.get("action") === "askAI" && req.method === "POST") {
        const body = await req.json();
        
        // Fetch context for the AI
        const sheetData = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A:B',
        });
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