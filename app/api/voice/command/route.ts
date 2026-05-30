import { NextResponse } from "next/server";
import { parseCommand } from "@/lib/voice/commands";
import type { ApiResponse } from "@/types";
import type { VoiceCommand } from "@/types/voice";

// POST /api/voice/command — parse a transcript into a structured
// command (regex only, no AI — instant). The client hook parses
// locally too; this route exists for programmatic / external use.

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

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  if (!transcript.trim()) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: transcript." },
      { status: 400 },
    );
  }

  const command = parseCommand(transcript);
  return NextResponse.json<ApiResponse<VoiceCommand>>({
    success: true,
    data: command,
  });
}
