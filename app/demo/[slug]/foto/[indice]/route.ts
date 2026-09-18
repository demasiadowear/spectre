import { NextResponse } from "next/server";
import { ENV_GOOGLE } from "@/lib/collector/capability";
import { urlMediaProvider } from "@/lib/collector/places";
import { leggiDossier } from "@/lib/collector/db";
import { getProjectBySlug } from "@/lib/factory/db";
import { riferimentoPerIndice } from "@/lib/demo/foto";

// ============================================================
// Le fotografie della demo, senza che la demo diventi un proxy.
//
// Questa rotta si apre SENZA login — deve, altrimenti il prospect non
// vede le immagini. Il che la rende l'unico punto del sistema in cui
// una richiesta non autenticata fa usare la nostra chiave Google.
//
// L'ingresso non e un URL e non e un riferimento del provider: e un
// INDICE, e lo si risolve dentro il manifest del progetto identificato
// dallo slug. Non esiste un input che possa denotare una fotografia
// fuori da quel dossier — non c'e un URL da validare ne un riferimento
// da filtrare, perche l'insieme di cio che si puo chiedere E l'insieme
// di cio che si puo mostrare.
//
// Verso l'esterno i rifiuti collassano tutti in 404. Distinguere
// «indice malformato» da «fuori intervallo» da «non mostrabile»
// direbbe a chi prova quante fotografie ha il dossier e quali sono
// state approvate: e un oracolo, e non serve a nessuno che abbia il
// diritto di guardare questa pagina.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LARGHEZZE = [400, 800, 1200, 1600];
const SLUG = /^[A-Za-z0-9_-]{22}$/;

/** Progetti la cui demo e visibile. Stesso elenco della pagina: una
 *  demo non ancora pronta non deve servire nemmeno le fotografie. */
const VISIBILI = new Set([
  "ready", "outreach_ready", "sent", "viewed", "replied",
  "appointment", "negotiating", "won", "client_approved",
]);

/** Una sola forma di rifiuto, per non diventare un oracolo. */
const nonTrovata = () =>
  new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  _req: Request,
  { params }: { params: { slug: string; indice: string } },
) {
  if (!SLUG.test(params.slug || "")) return nonTrovata();

  const progetto = await getProjectBySlug(params.slug);
  if (!progetto || !VISIBILI.has(progetto.stage)) return nonTrovata();

  const salvato = await leggiDossier(progetto.lead_id);
  const esito = riferimentoPerIndice(salvato?.dossier ?? null, params.indice || "");
  if (!esito.ok) return nonTrovata();

  const chiave = (process.env[ENV_GOOGLE] ?? "").trim();
  // Senza chiave non si puo rendere: 503, non 404. La differenza conta
  // per chi guarda i log — una configurazione mancante non e una
  // fotografia che non esiste.
  if (!chiave) return new NextResponse(null, { status: 503, headers: { "Cache-Control": "no-store" } });

  const url = new URL(_req.url);
  const w = Number(url.searchParams.get("w") ?? 1200);
  const larghezza = LARGHEZZE.indexOf(w) !== -1 ? w : 1200;

  try {
    const res = await fetch(urlMediaProvider(esito.riferimento, larghezza, chiave), {
      redirect: "follow",
    });
    if (!res.ok || !/^image\//i.test(res.headers.get("content-type") ?? "")) {
      // Anche il riferimento scaduto diventa 404: verso il prospect e
      // «questa immagine non c'e», e il pannello operatore ha gia il
      // suo 410 dalla rotta interna.
      return nonTrovata();
    }

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Non si conserva: ne da noi, ne in una cache condivisa. I byte
        // passano e basta. `private` tiene fuori la CDN; il browser puo
        // riusarli per pochi minuti, il che evita di ripagare la stessa
        // fotografia a ogni scroll senza farne una copia nostra.
        "Cache-Control": "private, max-age=300",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
        "X-Image-Source": "Google Maps",
      },
    });
  } catch {
    // Il messaggio del provider puo contenere l'URL con la chiave in
    // query: non esce di qui, nemmeno come dettaglio.
    return nonTrovata();
  }
}
