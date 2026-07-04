import { createLead } from "@/lib/data";
import { isTursoConnected } from "@/lib/turso";
import { addAlert } from "@/lib/autopilot/db";
import type { RawIntentRequest, IntentScoutResult } from "@/types/intent";
import { INTENT_NOTIFY_MIN_SCORE } from "./constants";
import { launchIntentBrowser, INTENT_USER_AGENT } from "./browser";
import { scrapeAddlance } from "./scrapers/addlance";
import { scrapeFreelanceboard } from "./scrapers/freelanceboard";
import { matchesIntent, scoreIntent } from "./score";
import {
  deleteOrphanLead,
  ensureIntentSchema,
  getIntentLeadsMissingHook,
  insertIntentRow,
  intentKey,
  knownIntentKeys,
  knownIntentUrls,
  markIntentNotified,
  setIntentHook,
} from "./db";
import { generateHook } from "./study";
import { formatIntentNotification, sendTelegram } from "./notify";

// ============================================================
// INTENT SCOUT — trova aziende che hanno PUBBLICATO una richiesta
// per sito web / servizi digitali (AddLance + Freelanceboard),
// dedup contro il DB, scoring, gancio Gemini, notifica Telegram
// per score >= soglia. Invocato da /api/intent/scout (cron 2h).
//
// Hardening (review 04/07/2026): gli scraper lanciano un errore
// esplicito se il DOM interno cambia (mai uno "0 lead" silenzioso),
// ogni item è isolato in try/catch (un lead marcio non blocca la
// run né le successive), le run a zero scraped notificano Telegram,
// i ganci persi (run morta a metà) vengono recuperati a inizio run.
// ============================================================

const SCRAPERS = [
  { name: "addlance", run: scrapeAddlance },
  { name: "freelanceboard", run: scrapeFreelanceboard },
] as const;

/** addAlert che non maschera mai l'errore principale della run. */
async function safeAlert(
  type: string,
  message: string,
  leadId?: string,
): Promise<void> {
  try {
    await addAlert(type, message, leadId);
  } catch (err) {
    console.error("[intent/scout] addAlert fallito:", (err as Error).message);
  }
}

/** Backfill dei ganci mancanti (run precedente morta tra insert e
 *  Study). Bounded, non fatale: al peggio riprova alla run dopo. */
async function backfillMissingHooks(errors: string[]): Promise<void> {
  const missing = await getIntentLeadsMissingHook(10);
  for (const lead of missing) {
    try {
      const hook = await generateHook({
        platform: lead.platform,
        title: lead.title,
        body: lead.body,
        category: lead.category,
        zone: lead.zone,
        budget: lead.budget,
        published_at: lead.published_at,
        source_url: lead.source_url,
        contact: "",
      });
      await setIntentHook(lead.lead_id, hook);
    } catch (err) {
      errors.push(`backfill hook ${lead.lead_id}: ${(err as Error).message}`);
    }
  }
}

async function scrapeAll(
  result: IntentScoutResult,
): Promise<RawIntentRequest[]> {
  const raw: RawIntentRequest[] = [];
  const browser = await launchIntentBrowser();
  try {
    const ctx = await browser.newContext({
      userAgent: INTENT_USER_AGENT,
      locale: "it-IT",
    });
    const page = await ctx.newPage();
    for (const scraper of SCRAPERS) {
      try {
        const items = await scraper.run(page);
        raw.push(...items);
        console.log(`[intent/scout] ${scraper.name}: ${items.length} richieste`);
      } catch (err) {
        const msg = `${scraper.name}: ${(err as Error).message}`;
        result.errors.push(msg);
        console.error("[intent/scout] scraper fallito —", msg);
      }
    }
  } finally {
    // Un errore di close (browser già morto) non deve rimpiazzare
    // l'errore vero della run (finally-throws vince sullo stack).
    try {
      await browser.close();
    } catch (err) {
      console.error(
        "[intent/scout] browser.close fallito:",
        (err as Error).message,
      );
    }
  }
  return raw;
}

export async function runIntentScout(): Promise<IntentScoutResult> {
  if (!isTursoConnected()) {
    throw new Error("Turso non configurato: lo scout intent richiede il DB.");
  }
  await ensureIntentSchema();

  const result: IntentScoutResult = {
    scraped: 0,
    matched: 0,
    inserted: 0,
    skipped_duplicates: 0,
    notified: 0,
    errors: [],
  };

  // 0. Recupera i ganci persi da run precedenti interrotte.
  await backfillMissingHooks(result.errors);

  // 1. Scraping — una fonte che fallisce non ferma le altre.
  const raw = await scrapeAll(result);
  result.scraped = raw.length;

  // Zero richieste da TUTTE le fonti = scraper rotti o siti giù, mai
  // un giorno normale (le liste mostrano sempre gli ultimi ~20).
  // Alert dashboard + Telegram: un cron muto per settimane è il
  // failure mode peggiore di tutto il modulo.
  if (raw.length === 0) {
    const detail = result.errors.join(" · ") || "nessun errore riportato";
    const msg = `Intent scout: 0 richieste da tutte le fonti (${detail})`;
    await safeAlert("anomaly", msg);
    await sendTelegram(`⚠️ ${msg}`);
    throw new Error(msg);
  }

  // 2. Filtro keyword (siti web / servizi digitali).
  const matched = raw.filter(matchesIntent);
  result.matched = matched.length;

  // 3. Dedup contro tutto il DB (URL annuncio + piattaforma/titolo).
  const [urls, keys] = await Promise.all([knownIntentUrls(), knownIntentKeys()]);

  for (const req of matched) {
    if (urls.has(req.source_url) || keys.has(intentKey(req.platform, req.title))) {
      result.skipped_duplicates++;
      continue;
    }
    urls.add(req.source_url);
    keys.add(intentKey(req.platform, req.title));

    // Ogni item è isolato: un errore su questo lead viene tracciato e
    // si passa al prossimo. Senza isolamento un item marcio abortirebbe
    // la run E — non essendo stato inserito, quindi mai dedupato —
    // anche tutte le run successive.
    try {
      // 4. Scoring + insert (lead condiviso in `leads`, funnel dedicato).
      const score = scoreIntent(req);
      const lead = await createLead({
        name: req.contact || "—",
        company: req.title.slice(0, 120),
        email: "",
        phone: "",
        source: `intent_${req.platform}`,
        status: "todo",
        value: 0,
        last_contact: new Date().toISOString(),
        next_action: "Candidarsi alla richiesta (v. gancio)",
        notes: req.body,
        tags: ["intent", req.platform],
        meta: {
          source_url: req.source_url,
          zone: req.zone,
          budget: req.budget,
          published_at: req.published_at,
          intent_score: score,
        },
      });
      const inserted = await insertIntentRow({
        lead_id: lead.id,
        platform: req.platform,
        source_url: req.source_url,
        title: req.title,
        body: req.body,
        category: req.category,
        zone: req.zone,
        budget: req.budget,
        published_at: req.published_at,
        score,
      });
      if (!inserted) {
        // Race con una run sovrapposta: la pipeline esiste già, il
        // lead appena creato è orfano e va tolto dal CRM.
        await deleteOrphanLead(lead.id);
        result.skipped_duplicates++;
        continue;
      }
      result.inserted++;

      // 5. Study: gancio personalizzato (fallback deterministico senza
      //    Gemini; se fallisce, il backfill lo recupera alla run dopo).
      const hook = await generateHook(req);
      await setIntentHook(lead.id, hook);

      // 6. Notifica immediata per score alto (Telegram + alert dashboard).
      if (score >= INTENT_NOTIFY_MIN_SCORE) {
        await safeAlert(
          "escalation",
          `Lead intent score ${score}: ${req.title} (${req.platform}) — contattare entro 1 ora`,
          lead.id,
        );
        const sent = await sendTelegram(
          formatIntentNotification(req, score, hook),
        );
        if (sent) {
          await markIntentNotified(lead.id);
          result.notified++;
        }
      }
    } catch (err) {
      const msg = `item "${req.title.slice(0, 50)}": ${(err as Error).message}`;
      result.errors.push(msg);
      console.error("[intent/scout] item fallito —", msg);
    }
  }

  return result;
}
