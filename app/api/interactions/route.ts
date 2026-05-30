import { NextResponse } from "next/server";
import { createInteraction, getInteractions } from "@/lib/data";
import type {
  ApiResponse,
  Interaction,
  InteractionType,
  Sentiment,
} from "@/types";

const TYPES: InteractionType[] = ["call", "email", "whatsapp", "meeting", "note"];
const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];

export async function GET(req: Request) {
  const leadId = new URL(req.url).searchParams.get("leadId") ?? undefined;
  const interactions = await getInteractions(leadId);
  return NextResponse.json<ApiResponse<Interaction[]>>({
    success: true,
    data: interactions,
    meta: { total: interactions.length, page: 1, limit: interactions.length },
  });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }

  const lead_id = typeof body.lead_id === "string" ? body.lead_id : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!lead_id || !content) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: lead_id, content." },
      { status: 400 },
    );
  }

  try {
    const interaction = await createInteraction({
      lead_id,
      content,
      type: TYPES.includes(body.type as InteractionType)
        ? (body.type as InteractionType)
        : "note",
      sentiment: SENTIMENTS.includes(body.sentiment as Sentiment)
        ? (body.sentiment as Sentiment)
        : "neutral",
      ai_summary: typeof body.ai_summary === "string" ? body.ai_summary : "",
    });
    return NextResponse.json<ApiResponse<Interaction>>(
      { success: true, data: interaction },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
