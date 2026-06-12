import { NextResponse } from "next/server";
import {
  listTemplates,
  updateTemplateContent,
} from "@/lib/templates/db";
import type { MessageTemplate } from "@/lib/templates/registry";
import type { ApiResponse } from "@/types";

// TEMPLATE MANAGER — lista e modifica testi WA. Dietro auth
// (middleware JWT, nessun bypass cron su questo path). Lettura
// sempre live: il salvataggio vale subito per worker e Study.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await listTemplates();
    return NextResponse.json<ApiResponse<MessageTemplate[]>>({
      success: true,
      data,
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* validato sotto */
  }
  const key = typeof body.key === "string" ? body.key : "";
  const content = typeof body.content === "string" ? body.content : null;
  if (!key || content === null) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Servono key e content (stringa)." },
      { status: 400 },
    );
  }

  try {
    await updateTemplateContent(key, content);
    return NextResponse.json<ApiResponse<{ key: string }>>({
      success: true,
      data: { key },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
