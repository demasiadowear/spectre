// Finestre di invio e ritmo: lun-SAB 9:00-20:00 Europe/Rome
// (solo domenica esclusa), delay random 60-240s tra messaggi.

export const SEND_WINDOWS = [{ from: 9, to: 20 }];
export const SEND_DELAY_MIN_S = 60;
export const SEND_DELAY_MAX_S = 240;
export const FOLLOWUP_1_DAYS = 3;
export const FOLLOWUP_2_DAYS = 7;
export const ARCHIVE_AFTER_DAYS = 10;

function romeParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour), weekday: parts.weekday };
}

/** true se ora è una finestra valida di invio (lun-sab, 9-20). */
export function inSendWindow(date = new Date()) {
  const { hour, weekday } = romeParts(date);
  if (weekday === "dom") return false;
  return SEND_WINDOWS.some((w) => hour >= w.from && hour < w.to);
}

export function randomDelayMs() {
  const s =
    SEND_DELAY_MIN_S +
    Math.random() * (SEND_DELAY_MAX_S - SEND_DELAY_MIN_S);
  return Math.round(s * 1000);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Giorni interi trascorsi da un timestamp ISO/SQLite. */
export function daysSince(iso) {
  if (!iso) return 0;
  const t = new Date(iso.includes("T") ? iso : `${iso}Z`).getTime();
  return (Date.now() - t) / 86_400_000;
}
