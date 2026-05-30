import { NextResponse } from "next/server";
import { createLead, getLeads, type NewLead } from "@/lib/data";
import type { ApiResponse, Lead, LeadSource, LeadStatus } from "@/types";

const SOURCES: LeadSource[] = ["maps", "linkedin", "referral", "cold"];
const STATUSES: LeadStatus[] = [
  "cold",
  "warm",
  "hot",
  "proposal",
  "negotiation",
  "closed",
  "lost",
];

export async function GET() {
  const leads = await getLeads();
  return NextResponse.json<ApiResponse<Lead[]>>({
    success: true,
    data: leads,
    meta: { total: leads.length, page: 1, limit: leads.length },
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim() : "";
  if (!name || !company) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campi obbligatori: name, company." },
      { status: 400 },
    );
  }

  const source = SOURCES.includes(body.source as LeadSource)
    ? (body.source as LeadSource)
    : "cold";
  const status = STATUSES.includes(body.status as LeadStatus)
    ? (body.status as LeadStatus)
    : "cold";

  const input: NewLead = {
    name,
    company,
    email: typeof body.email === "string" ? body.email : "",
    phone: typeof body.phone === "string" ? body.phone : "",
    source,
    status,
    value: Number.isFinite(body.value) ? Number(body.value) : 0,
    probability: Number.isFinite(body.probability)
      ? Number(body.probability)
      : 25,
    last_contact:
      typeof body.last_contact === "string"
        ? body.last_contact
        : new Date().toISOString(),
    next_action: typeof body.next_action === "string" ? body.next_action : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
  };

  try {
    const lead = await createLead(input);
    return NextResponse.json<ApiResponse<Lead>>(
      { success: true, data: lead },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
