import { NextResponse } from "next/server";
import {
  getProjectByLead,
  listActivities,
  listDemoViews,
  listFacts,
  listFollowups,
  logActivity,
} from "@/lib/factory/db";
import { listJobs } from "@/lib/factory/queue";
import type { ApiResponse } from "@/types";
import type {
  Activity,
  ActivityType,
  AgentJob,
  ContactFact,
  DemoView,
  Followup,
  ForgeProject,
} from "@/types/factory";

// ============================================================
// Scheda Factory di un lead: progetto, timeline, fatti con evidenza,
// promemoria, coda e aperture della demo. Tutto in una chiamata: la
// scheda si apre da mobile, in strada, e non regge tre round trip.
// ============================================================

export const dynamic = "force-dynamic";

const VALID_TYPES: ActivityType[] = [
  "note",
  "call",
  "visit",
  "email",
  "whatsapp",
  "meeting",
  "task",
  "stage_change",
  "research",
  "demo_generated",
  "qa",
  "ai_action",
  "demo_viewed",
];

export interface FactoryLeadView {
  project: ForgeProject | null;
  activities: Activity[];
  facts: ContactFact[];
  followups: Followup[];
  jobs: AgentJob[];
  demo_views: DemoView[];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const leadId = params.id;
    const project = await getProjectByLead(leadId);
    const [activities, facts, followups, jobs, demoViews] = await Promise.all([
      listActivities(leadId),
      listFacts(leadId),
      listFollowups({ leadId }),
      listJobs({ leadId }),
      project ? listDemoViews(project.id) : Promise.resolve([]),
    ]);
    return NextResponse.json<ApiResponse<FactoryLeadView>>({
      success: true,
      data: { project, activities, facts, followups, jobs, demo_views: demoViews },
    });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

/** Nota manuale in timeline. Firmata 'puccio': quello che scrive una
 *  persona non deve confondersi con quello che scrive l'automazione. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body ?? {}) as Record<string, unknown>;
    const subject = typeof raw.subject === "string" ? raw.subject.trim().slice(0, 300) : "";
    if (!subject) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "subject obbligatorio" },
        { status: 400 },
      );
    }
    const type = VALID_TYPES.includes(raw.type as ActivityType)
      ? (raw.type as ActivityType)
      : "note";
    const id = await logActivity({
      lead_id: params.id,
      type,
      subject,
      body: typeof raw.body === "string" ? raw.body.slice(0, 5000) : "",
      created_by: "puccio",
    });
    return NextResponse.json<ApiResponse<{ id: string }>>({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
