import { NextResponse } from "next/server";
import { createLead, type NewLead } from "@/lib/data";
import { addLeadsToPipeline } from "@/lib/autopilot/import";
import type { ApiResponse, Lead, LeadSource, LeadStatus } from "@/types";

// POST /api/leads/import — bulk-insert hunted leads (Hunter). Body:
// { leads: ImportItem[] } o un singolo lead object. I lead creati con
// status "todo" (il caso normale — "lost" lo usa solo lo scarto
// dell'Hunter) entrano SUBITO anche in pipeline se eleggibili (mobile,
// non duplicati): da quando "Visor" non esiste più come pagina a sé,
// un secondo passo manuale per farli comparire da qualche parte li
// faceva solo sembrare spariti.

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
    meta:
      it.meta && typeof it.meta === "object"
        ? (it.meta as NewLead["meta"])
        : {},
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
    const created: Lead[] = [];
    for (const input of inputs) {
      created.push(await createLead(input));
    }

    // Solo i "todo" appena creati sono candidati pipeline: lo scarto
    // dell'Hunter (handleDiscard) passa da qui con status "lost" e non
    // deve mai finire in pipeline.
    const toAttach = created.filter((l) => l.status === "todo");
    const pipelineResult = await addLeadsToPipeline(toAttach);

    return NextResponse.json<
      ApiResponse<{
        imported: number;
        ids: string[];
        added_to_pipeline: number;
        skipped_fisso: number;
        skipped_no_phone: number;
        skipped_duplicate: number;
      }>
    >(
      {
        success: true,
        data: {
          imported: created.length,
          ids: created.map((l) => l.id),
          added_to_pipeline: pipelineResult.added,
          skipped_fisso: pipelineResult.skipped_fisso,
          skipped_no_phone: pipelineResult.skipped_no_phone,
          skipped_duplicate: pipelineResult.skipped_duplicate,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
