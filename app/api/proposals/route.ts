import { NextResponse } from "next/server";
import { createProposal, getProposals } from "@/lib/data";
import type { ApiResponse, Proposal, ProposalContent } from "@/types";

export async function GET(req: Request) {
  const leadId = new URL(req.url).searchParams.get("leadId") ?? undefined;
  const proposals = await getProposals(leadId);
  return NextResponse.json<ApiResponse<Proposal[]>>({
    success: true,
    data: proposals,
    meta: { total: proposals.length, page: 1, limit: proposals.length },
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
  const content = body.content as ProposalContent | undefined;
  if (!lead_id || !content || !content.title || !Array.isArray(content.pricing)) {
    return NextResponse.json<ApiResponse<never>>(
      {
        success: false,
        error: "Campi obbligatori: lead_id, content (title + pricing).",
      },
      { status: 400 },
    );
  }

  try {
    const proposal = await createProposal({ lead_id, content });
    return NextResponse.json<ApiResponse<Proposal>>(
      { success: true, data: proposal },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
