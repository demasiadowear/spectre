import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { turso } from "@/lib/turso";
import { ensureFactorySchema } from "@/lib/factory/db";
import { leggiDossier } from "@/lib/collector/db";
import { guardiaRichiesta } from "@/lib/guardia-richiesta";
import { briefDaDossier } from "@/lib/factory/brief";
import type { ApiResponse } from "@/types";

// ============================================================
// Crea l'anteprima privata di un lead gia raccolto.
//
// Sta dietro l'autenticazione operatore e la guardia di origine: e la
// rotta che DECIDE che un dossier diventa una pagina apribile da fuori,
// e quella decisione la prende una persona.
//
// Lo slug e 16 byte da `randomBytes` in base64url: 128 bit, non
// enumerabili. E la credenziale della demo, quindi non si deriva dal
// lead_id ne da niente di indovinabile.
//
// Idempotente: se il lead ha gia un'anteprima si restituisce quella.
// Premere due volte non deve produrre due URL, o il primo resterebbe
// in giro senza che nessuno sappia di averlo dato a qualcuno.
// ============================================================

export const dynamic = "force-dynamic";

interface Creata { slug: string; url: string; creata: boolean; }

export async function GET() {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: "metodo GET non ammesso: questa rotta crea una risorsa" },
    { status: 405 },
  );
}

export async function POST(req: Request) {
  const g = guardiaRichiesta(req);
  if (!g.ok) {
    return NextResponse.json<ApiResponse<never>>({ success: false, error: g.error }, { status: g.status });
  }
  if (!turso) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "database non disponibile" }, { status: 503 },
    );
  }

  const raw = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const leadId = typeof raw.lead_id === "string" ? raw.lead_id.trim() : "";
  if (!leadId) {
    return NextResponse.json<ApiResponse<never>>({ success: false, error: "serve lead_id" }, { status: 422 });
  }

  await ensureFactorySchema();

  // Senza dossier non c'e niente da mostrare, e senza nome non c'e
  // pagina: meglio dirlo qui che produrre un URL che da 404.
  const salvato = await leggiDossier(leadId);
  if (!salvato?.dossier) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "nessun dossier per questo lead: esegui prima la raccolta" },
      { status: 409 },
    );
  }
  if (!briefDaDossier(salvato.dossier).nome) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "il dossier non ha un nome verificato: non si puo costruire una pagina" },
      { status: 409 },
    );
  }

  const gia = await turso.execute({
    sql: `select slug from forge_projects where lead_id = ? and template = 'dossier-di-lato' limit 1`,
    args: [leadId],
  });
  const esistente = gia.rows[0] as { slug?: string } | undefined;
  if (esistente?.slug) {
    return risposta(String(esistente.slug), false, req);
  }

  const slug = randomBytes(16).toString("base64url").slice(0, 22);
  await turso.execute({
    sql: `insert into forge_projects (id, lead_id, slug, stage, template, spec)
          values (?, ?, ?, 'ready', 'dossier-di-lato', '')`,
    args: [randomUUID(), leadId, slug],
  });
  return risposta(slug, true, req);
}

function risposta(slug: string, creata: boolean, req: Request) {
  // L'origine si legge dalla richiesta: cosi l'URL e giusto in locale,
  // in preview e in produzione senza una variabile in piu.
  const origine = new URL(req.url).origin;
  return NextResponse.json<ApiResponse<Creata>>({
    success: true,
    data: { slug, url: `${origine}/demo/${slug}`, creata },
  });
}
