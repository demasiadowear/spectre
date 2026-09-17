import { NextResponse } from "next/server";
import {
  getProjectBySlug,
  logActivity,
  recordDemoView,
  setProjectStage,
} from "@/lib/factory/db";
import type { ApiResponse } from "@/types";

// ============================================================
// Ping pubblico "demo aperta". Endpoint scritto per essere esposto:
//  - accetta SOLO lo slug (che è già il segreto) e un device fra due
//    valori noti: nessun campo libero finisce sul DB;
//  - non restituisce NULLA del progetto, così non diventa un oracolo
//    per indovinare slug (risposta identica in ogni caso);
//  - promuove la fase a `viewed` solo se il lead era a `sent`.
// ============================================================

export const dynamic = "force-dynamic";

/** Risposta unica: un chiamante non distingue slug valido da invalido. */
const ok = () =>
  NextResponse.json<ApiResponse<{ ok: true }>>({ success: true, data: { ok: true } });

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const slug = typeof (body as { slug?: unknown })?.slug === "string"
      ? (body as { slug: string }).slug
      : "";
    const rawDevice = typeof (body as { device?: unknown })?.device === "string"
      ? (body as { device: string }).device
      : "";
    const device = rawDevice === "mobile" ? "mobile" : "desktop";

    if (!/^[A-Za-z0-9_-]{22}$/.test(slug)) return ok();

    const project = await getProjectBySlug(slug);
    if (!project) return ok();

    await recordDemoView({
      forge_project_id: project.id,
      lead_id: project.lead_id,
      device,
    });
    await logActivity({
      lead_id: project.lead_id,
      forge_project_id: project.id,
      type: "demo_viewed",
      subject: "Demo aperta dal prospect",
      body: `Apertura da ${device}.`,
      metadata: { device },
      created_by: "system",
    });
    // Solo `sent` → `viewed`: non si torna indietro da una trattativa
    // già avviata perché il titolare ha riaperto il link.
    if (project.stage === "sent") await setProjectStage(project.id, "viewed");

    return ok();
  } catch {
    // Anche in errore la risposta è identica: nessuna informazione
    // trapela da questo endpoint pubblico.
    return ok();
  }
}
