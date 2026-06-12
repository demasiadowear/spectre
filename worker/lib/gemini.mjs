// Gemini Flash (stack lock fino a 200 clienti) — JSON helper del worker.
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("[worker] GEMINI_API_KEY mancante.");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const MODEL = "gemini-2.5-flash";

/** Genera e parsa JSON. Torna null su errore (il chiamante decide). */
export async function geminiJSON(systemPrompt, userPrompt, temperature = 0.7) {
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
        // 2.5-flash consuma token anche per il "thinking" interno:
        // 1024 troncava il JSON a metà su prompt lunghi.
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });
    const result = await model.generateContent(userPrompt);
    const text = result.response.text().trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return JSON.parse(start === -1 ? text : text.slice(start, end + 1));
  } catch (err) {
    console.error("[worker/gemini]", err.message);
    return null;
  }
}
