import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================
// Google Gemini wrapper. `geminiJSON<T>` mirrors the old claudeJSON
// contract: returns parsed JSON of type T, or null when no API key is
// set or the call/parse fails — callers fall back to deterministic
// mock data so the app never crashes.
// ============================================================

const apiKey = process.env.GEMINI_API_KEY;

export const gemini = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/** True when a Gemini key is present; otherwise SPECTRE uses mock AI. */
export function isGeminiConfigured(): boolean {
  return gemini !== null;
}

// Cheap, fast — default for short structured calls (Whisper, Oracle).
export const DEFAULT_MODEL = "gemini-2.5-flash-lite";
// More capable — longer/creative output (Hand proposals, cold-call scripts).
export const COMPLEX_MODEL = "gemini-2.5-flash";

export interface GeminiOptions {
  /** Explicit model id. Overrides `complex`. */
  model?: string;
  /** Use COMPLEX_MODEL instead of DEFAULT_MODEL. */
  complex?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  /** Force `application/json` response mime type. */
  jsonMode?: boolean;
}

function resolveModel(options?: GeminiOptions): string {
  if (options?.model) return options.model;
  return options?.complex ? COMPLEX_MODEL : DEFAULT_MODEL;
}

/**
 * Low-level text generation. Throws when no key is configured — use
 * `geminiJSON` for the null-on-failure contract the API routes rely on.
 */
export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  options?: GeminiOptions,
): Promise<string> {
  if (!gemini) {
    throw new Error("Gemini API key non configurata");
  }

  const model = gemini.getGenerativeModel({
    model: resolveModel(options),
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxOutputTokens ?? 2048,
      responseMimeType: options?.jsonMode ? "application/json" : "text/plain",
    },
  });

  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

/** Pull the first balanced JSON object out of a model response. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) return body.trim();
  return body.slice(start, end + 1);
}

/**
 * Generate and parse a JSON object of type T. Returns null when the key
 * is missing or the request/parse fails, so callers can `?? mock`.
 */
export async function geminiJSON<T>(
  system: string,
  user: string,
  options?: GeminiOptions,
): Promise<T | null> {
  if (!gemini) return null;
  try {
    const text = (
      await generateWithGemini(system, user, { ...options, jsonMode: true })
    ).trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return JSON.parse(extractJson(text)) as T;
    }
  } catch (err) {
    console.error(
      "[gemini] request failed, falling back to mock:",
      (err as Error).message,
    );
    return null;
  }
}
