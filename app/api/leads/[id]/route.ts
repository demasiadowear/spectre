import { NextResponse } from "next/server";
import { deleteLead, getLeadById, updateLead } from "@/lib/data";
import type { ApiResponse, Lead } from "@/types";

interface Ctx {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Ctx) {
  const lead = await getLeadById(params.id);
  if (!lead) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Lead non trovato." },
      { status: 404 },
    );
  }
  return NextResponse.json<ApiResponse<Lead>>({ success: true, data: lead });
}

export async function PATCH(req: Request, { params }: Ctx) {
  let patch: Partial<Lead>;
  try {
    patch = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }
  // Never allow id / timestamps to be overwritten from the client.
  delete (patch as Record<string, unknown>).id;
  delete (patch as Record<string, unknown>).created_at;

  try {
    const lead = await updateLead(params.id, patch);
    if (!lead) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Lead non trovato." },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<Lead>>({ success: true, data: lead });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ok = await deleteLead(params.id);
    if (!ok) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "Lead non trovato." },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResponse<{ id: string }>>({
      success: true,
      data: { id: params.id },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
