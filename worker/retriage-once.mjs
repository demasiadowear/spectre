// One-off: ri-smista i lead fermi in "risposto_manuale" il cui ultimo
// messaggio umano è stato processato dal worker PRE-triage (recupero
// sync del 12/06 11:07). Stessa logica e soglie del worker. SOLO
// catalogazione: nessun messaggio parte verso i lead.
//   node retriage-once.mjs          # dry-run (mostra cosa farebbe)
//   node retriage-once.mjs --apply  # applica
import "dotenv/config";
import {
  addAlert,
  chatHistory,
  db,
  pipelineByStage,
  updateLeadStatus,
  updatePipeline,
} from "./lib/db.mjs";
import { geminiJSON } from "./lib/gemini.mjs";
import { TRIAGE_SYSTEM_PROMPT } from "./lib/prompts.mjs";

const APPLY = process.argv.includes("--apply");
const MAP = {
  demo_richiesta: "demo_richiesta",
  da_chiamare: "da_chiamare",
  richiesta_prezzo: "richiesta_prezzo",
  tiepido: "tiepido",
  perso: "perso",
  da_rispondere: "risposto_manuale",
};

function leadStatusFor(stage) {
  if (stage === "perso") return "lost";
  if (stage === "da_chiamare" || stage === "richiesta_prezzo") return "negotiating";
  return "replied";
}

const leads = await pipelineByStage("risposto_manuale", 50);
console.log(`${leads.length} lead in "da rispondere" da ri-valutare${APPLY ? "" : " (DRY RUN)"}.\n`);

for (const lead of leads) {
  const leadId = String(lead.lead_id);
  const history = await chatHistory(leadId, 10);
  const lastHuman = [...history].reverse().find((m) => m.direction === "in");
  if (!lastHuman) continue;

  const transcript = history
    .map((m) => `${m.direction === "out" ? "NOI" : "CLIENTE"}: ${m.body}`)
    .join("\n");
  const nowRome = new Date().toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const v = await geminiJSON(
    TRIAGE_SYSTEM_PROMPT,
    `Attività: ${lead.company} (${lead.category}, ${lead.city})\n` +
      `Ora attuale (Europe/Rome): ${nowRome}\n\nCHAT FINORA:\n${transcript}\n\n` +
      `ULTIMO MESSAGGIO DEL CLIENTE:\n${lastHuman.body}`,
    0.2,
  );
  if (!v) {
    console.log(`- ${lead.company}: Gemini KO, resta da rispondere`);
    continue;
  }
  let stage = MAP[v.stage] ?? "risposto_manuale";
  const conf = Number(v.confidence) || 0;
  if (stage === "perso" && conf < 0.75) stage = "risposto_manuale";
  else if (stage !== "risposto_manuale" && conf < 0.6) stage = "risposto_manuale";
  const cb =
    typeof v.callback_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.callback_at)
      ? v.callback_at
      : "";

  console.log(
    `- ${lead.company}: "${String(lastHuman.body).slice(0, 50)}" -> ${stage}` +
      `${cb ? ` (quando: ${cb})` : ""}${v.lost_reason ? ` (motivo: ${v.lost_reason})` : ""} [conf ${conf}]`,
  );

  if (!APPLY || stage === "risposto_manuale") continue;
  const fields = { stage, bot_paused: 1 };
  if (cb) fields.next_action_at = cb;
  if (v.next_action) fields.next_action = String(v.next_action).slice(0, 120);
  if (stage === "perso" && v.lost_reason) fields.lost_reason = String(v.lost_reason).slice(0, 120);
  await updatePipeline(leadId, fields);
  await updateLeadStatus(leadId, leadStatusFor(stage));
  await addAlert("info", `${lead.company} ri-smistato dal triage: ${stage}`, leadId);
}
console.log("\nFatto.");
db.close?.();
process.exit(0);
