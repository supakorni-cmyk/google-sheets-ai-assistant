import { Context } from "@netlify/functions";
import { GoogleGenerativeAI } from '@google/generative-ai';
import { google } from 'googleapis';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Note: You would replicate the Google Sheets Auth block here just like in webhook.ts

export default async (req: Request, context: Context) => {
    const url = new URL(req.url);
    
    if (url.searchParams.get("action") === "getSheetData") {
        // Here you would use the googleapis client to fetch your sheet
        // Returning mock data for the structure:
        const mockSheetData = [
            ["Expense", "Amount"],
            ["Groceries", "$50"],
            ["Internet", "$60"]
        ];
        
        return new Response(JSON.stringify(mockSheetData), {
            headers: { "Content-Type": "application/json" }
        });
    }

    if (url.searchParams.get("action") === "askAI" && req.method === "POST") {
        const body = await req.json();
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(`You are a helpful assistant. The user asked: ${body.question}`);
        
        return new Response(JSON.stringify({ answer: result.response.text() }), {
            headers: { "Content-Type": "application/json" }
        });
    }

    return new Response("Not Found", { status: 404 });
};