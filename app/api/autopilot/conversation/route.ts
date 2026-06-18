import { NextResponse } from "next/server";
import {
  addAlert,
  getPipelineLead,
  getWaMessages,
  logWaMessage,
  markContacted,
  markDemoSent,
  updateDeal,
} from "@/lib/autopilot/db";
import { triageInbound } from "@/lib/autopilot/triage";
import { suggestReply, type SuggestedReply } from "@/lib/autopilot/reply";
import type { ApiResponse } from "@/types";
import type { AutopilotLead, AutopilotStage } from "@/types/autopilot";

// ============================================================
// Conversazione manuale (copilota). SPECTRE non manda né legge
// WhatsApp: Puccio invia da wa.me e incolla qui le risposte.
// - log_outbound : registra un nostro messaggio (e segna "contattato"
//   se è il primo); il testo lo manda Puccio a mano.
// - log_inbound  : registra la risposta del cliente, la TRIAGE Gemini
//   smista lo stato e PREPARA la risposta suggerita.
// - suggest      : rigenera solo la risposta suggerita.
// - mark_demo_sent : segna la demo inviata (link incollato a mano).
// ============================================================

export const dynamic = "force-dynamic";

/** Stati trattativa attivi: una risposta vaga qui NON deve declassare
 *  lo stage (lo gestisce Puccio); il triage lo lascia com'è. */
const NEGOTIATION_STAGES = new Set<AutopilotStage>([
  "da_chiamare",
  "demo_richiesta",
  "demo_inviata",
  "richiesta_prezzo",
  "in_trattativa",
  "tiepido",
  "vinto",
]);

interface ConversationPayload {
  lead: AutopilotLead;
  suggested?: SuggestedReply | null;
  triage?: { stage: AutopilotStage; label: string };
}

function bad(error: string, status = 400) {
  return NextResponse.json<ApiResponse<never>>({ success: false, error }, { status });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Body JSON non valido.");
  }

  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!leadId) return bad("Serve lead_id.");

  const lead = await getPipelineLead(leadId);
  if (!lead) return bad("Lead non trovato in pipeline.", 404);

  try {
    if (action === "log_outbound") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) return bad("Serve il testo del messaggio inviato.");
      await logWaMessage({ leadId, direction: "out", body: text });
      // Primo contatto: la pipeline avanza a "contattato".
      if (lead.stage === "nuovo" || lead.stage === "studiato") {
        await markContacted(leadId);
      }
      const fresh = (await getPipelineLead(leadId)) ?? lead;
      return NextResponse.json<ApiResponse<ConversationPayload>>({
        success: true,
        data: { lead: fresh },
      });
    }

    if (action === "log_inbound") {
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) return bad("Serve il testo della risposta del cliente.");

      const history = await getWaMessages(leadId);
      await logWaMessage({ leadId, direction: "in", body: text });

      // Triage Gemini: cataloga lo stato di trattativa (mai risponde).
      const triage = await triageInbound(lead, text, history);

      // In trattativa attiva una risposta vaga non declassa lo stage.
      const keepStage =
        NEGOTIATION_STAGES.has(lead.stage) && triage.stage === "risposto_manuale";
      await updateDeal(leadId, {
        ...(keepStage ? {} : { stage: triage.stage }),
        ...(triage.next_action ? { next_action: triage.next_action } : {}),
        ...(triage.callback_at ? { next_action_at: triage.callback_at } : {}),
        ...(triage.lost_reason ? { lost_reason: triage.lost_reason } : {}),
      });

      const extra = [
        triage.callback_at ? `quando: ${triage.callback_at.replace("T", " ")}` : "",
        triage.lost_reason ? `motivo: ${triage.lost_reason}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      await addAlert(
        "human_reply",
        `${lead.company} → ${triage.label}${extra ? ` (${extra})` : ""}: "${text.slice(0, 140)}"`,
        leadId,
      );

      // Risposta suggerita sulla conversazione aggiornata.
      const fresh = (await getPipelineLead(leadId)) ?? lead;
      const fullHistory = await getWaMessages(leadId);
      const suggested = await suggestReply(fresh, fullHistory);

      return NextResponse.json<ApiResponse<ConversationPayload>>({
        success: true,
        data: {
          lead: fresh,
          suggested,
          triage: { stage: keepStage ? lead.stage : triage.stage, label: triage.label },
        },
      });
    }

    if (action === "suggest") {
      const history = await getWaMessages(leadId);
      const suggested = await suggestReply(lead, history);
      return NextResponse.json<ApiResponse<ConversationPayload>>({
        success: true,
        data: { lead, suggested },
      });
    }

    if (action === "mark_demo_sent") {
      const demoUrl = typeof body.demo_url === "string" ? body.demo_url.trim() : "";
      if (demoUrl && !/^https?:\/\/\S+$/.test(demoUrl)) {
        return bad("demo_url non valido: serve un link http(s).");
      }
      // Tiene traccia dell'invio anche nella chat (link mandato a mano).
      if (demoUrl) {
        await logWaMessage({ leadId, direction: "out", body: `📎 Demo: ${demoUrl}` });
      }
      await markDemoSent(leadId, demoUrl || undefined);
      const fresh = (await getPipelineLead(leadId)) ?? lead;
      return NextResponse.json<ApiResponse<ConversationPayload>>({
        success: true,
        data: { lead: fresh },
      });
    }

    return bad(
      "action deve essere log_outbound | log_inbound | suggest | mark_demo_sent.",
    );
  } catch (err) {
    return bad((err as Error).message, 500);
  }
}
