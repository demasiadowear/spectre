import { NextResponse } from "next/server";
import { createLead, type NewLead } from "@/lib/data";
import type { ApiResponse, LeadSource, LeadStatus } from "@/types";

// POST /api/leads/import — bulk-insert hunted leads into the pipeline.
// Body: { leads: ImportItem[] } or a single lead object.

const SOURCES: LeadSource[] = ["maps", "linkedin", "referral", "cold"];
const STATUSES: LeadStatus[] = [
  "todo",
  "step1_sent",
  "replied",
  "step2_sent",
  "preview_sent",
  "negotiating",
  "closed",
  "lost",
];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toNewLead(raw: unknown): NewLead | null {
  if (!raw || typeof raw !== "object") return null;
  const it = raw as Record<string, unknown>;
  const name = str(it.name).trim();
  if (!name) return null;
  const company = str(it.company).trim() || name;
  const source = SOURCES.includes(it.source as LeadSource)
    ? (it.source as LeadSource)
    : "maps";
  const status = STATUSES.includes(it.status as LeadStatus)
    ? (it.status as LeadStatus)
    : "todo";
  return {
    name,
    company,
    email: str(it.email),
    phone: str(it.phone),
    source,
    status,
    value: num(it.value, 0),
    probability: Math.max(0, Math.min(100, num(it.probability, 20))),
    last_contact: str(it.last_contact) || new Date().toISOString(),
    next_action: str(it.next_action) || "Cold call — script pronto",
    notes: str(it.notes),
    tags: Array.isArray(it.tags)
      ? (it.tags.filter((t) => typeof t === "string") as string[])
      : [],
  };
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

  const items: unknown[] = Array.isArray(body.leads) ? body.leads : [body];
  const inputs = items.map(toNewLead).filter((x): x is NewLead => x !== null);

  if (inputs.length === 0) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Nessun lead valido (serve almeno 'name')." },
      { status: 400 },
    );
  }

  try {
    const ids: string[] = [];
    for (const input of inputs) {
      const lead = await createLead(input);
      ids.push(lead.id);
    }
    return NextResponse.json<ApiResponse<{ imported: number; ids: string[] }>>(
      { success: true, data: { imported: ids.length, ids } },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
