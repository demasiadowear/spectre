// Verifica una-tantum: nessun worker WhatsApp vivo + quando è partito
// l'ULTIMO invio reale. I timestamp SQLite (created_at) sono UTC SENZA
// suffisso: vanno letti come UTC (append "Z"), altrimenti sembrano più
// recenti del vero (offset fuso).
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const now = Date.now();
// created_at SQLite = "YYYY-MM-DD HH:MM:SS" UTC → append Z. ISO con Z resta com'è.
const toMs = (v) => {
  if (!v) return NaN;
  const s = String(v);
  return new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`).getTime();
};
const ageStr = (v) => {
  const t = toMs(v);
  if (!Number.isFinite(t)) return "MAI / non valido";
  const min = Math.round((now - t) / 60000);
  if (min < 60) return `${min} min fa`;
  if (min < 1440) return `${(min / 60).toFixed(1)} ore fa`;
  return `${(min / 1440).toFixed(1)} giorni fa`;
};

const r = await db.execute("SELECT key, value FROM autopilot_settings");
const settings = new Map(r.rows.map((x) => [String(x.key), x.value == null ? null : String(x.value)]));
const hb = settings.get("worker_heartbeat") ?? null;

const last = await db.execute(
  "SELECT body, created_at FROM wa_messages WHERE direction='out' ORDER BY created_at DESC LIMIT 5",
);
const out24 = Number((await db.execute("SELECT COUNT(*) n FROM wa_messages WHERE direction='out' AND created_at >= datetime('now','-1 day')")).rows[0].n);

console.log("\n================ STATO WORKER ================");
console.log("worker_heartbeat    :", hb ?? "—", "→", ageStr(hb));
console.log("worker_wa_ready     :", settings.get("worker_wa_ready") ?? "—");
console.log("kill_switch         :", settings.get("kill_switch") ?? "—");
console.log("---------- ultimi 5 messaggi in USCITA (UTC) ----------");
for (const row of last.rows) {
  console.log(`  ${String(row.created_at)}  (${ageStr(row.created_at)})  "${String(row.body).slice(0, 50)}"`);
}
console.log("msg in uscita ultime 24h (UTC, DB-side):", out24);
console.log("=============================================");

const STALE_MS = 3 * 60 * 1000;
const hbT = toMs(hb);
const workerLive = Number.isFinite(hbT) && now - hbT < STALE_MS;
const newestOut = last.rows[0] ? toMs(last.rows[0].created_at) : 0;
const sentAfterHbDeath = newestOut && hbT && newestOut > hbT + STALE_MS;

console.log(workerLive ? "\n⚠️  HEARTBEAT FRESCO: worker forse vivo." : "\n✅ Heartbeat vecchio/assente: nessun processo worker attivo ora.");
if (sentAfterHbDeath) {
  console.log("⚠️  ATTENZIONE: l'ultimo invio è SUCCESSIVO alla morte dell'heartbeat → qualcosa ha inviato senza heartbeat. Indagare.");
} else {
  console.log("✅ Nessun invio successivo all'ultimo heartbeat: il worker ha smesso e da allora ZERO invii.");
}
process.exit(0);
