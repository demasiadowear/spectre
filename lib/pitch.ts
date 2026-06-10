import type { Lead, LeadStatus } from "@/types";

// ============================================================
// SPECTRE PITCH ENGINE — ported from the AYROMEX pitch-tracker.
// Category-aware WhatsApp message generation, phone utilities,
// next-best-action, stale detection and first-come tier pricing.
// Pure functions: no DOM, no storage. The UI persists results to Turso.
// ============================================================

// ---------- Phone ----------

/** Italian mobile (has WhatsApp): starts with 3, 9-10 digits. */
export function isMobilePhone(raw: string): boolean {
  if (!raw) return false;
  const clean = raw.replace(/\s+/g, "").replace(/^\+/, "");
  return /^3\d{8,9}$/.test(clean) || /^393\d{8,9}$/.test(clean);
}

/** Normalize to wa.me form: digits only, leading 39. */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const clean = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (clean.startsWith("39")) return clean;
  return `39${clean}`;
}

export function waUrl(phone: string, message: string): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(message)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/\s+/g, "")}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[àáâã]/g, "a")
    .replace(/[èéê]/g, "e")
    .replace(/[ìí]/g, "i")
    .replace(/[òóô]/g, "o")
    .replace(/[ùú]/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ---------- Contact links ----------

export function mapsUrl(lead: Lead): string {
  if (lead.meta.maps_url) return lead.meta.maps_url;
  const q = `${lead.name} ${lead.meta.address ?? ""}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function igUrl(lead: Lead): string | null {
  return lead.meta.ig ? `https://instagram.com/${lead.meta.ig.replace("@", "")}` : null;
}

export function fbUrl(lead: Lead): string | null {
  return lead.meta.fb ? `https://facebook.com/${lead.meta.fb}` : null;
}

/** Core del "Cerca": ricerca Google nome + città. Riusato da Visor
 *  (via googleSearchUrl) e dalla dashboard Autopilot. */
export function googleSearchHref(name: string, city?: string): string {
  const q = !city || city === "zona" ? name : `${name} ${city}`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function googleSearchUrl(lead: Lead): string {
  return googleSearchHref(lead.name, cityOf(lead));
}

// ---------- Activity type (category-aware copy) ----------

interface Activity {
  sing: string;
  plur: string;
}

export function activityType(lead: Lead): Activity {
  const hay = `${lead.meta.category ?? ""} ${lead.name}`.toLowerCase();
  if (/barber|barbier/.test(hay)) return { sing: "barbiere", plur: "barbieri" };
  if (/estetic|beauty|nail|spa|benessere/.test(hay))
    return { sing: "centro estetico", plur: "centri estetici" };
  if (/parrucchier|hair|salon|coiffeur/.test(hay))
    return { sing: "salone", plur: "saloni" };
  if (/ristorant|trattoria|pizzeri|osteria|braceria|cucina|gastronom/.test(hay))
    return { sing: "ristorante", plur: "ristoranti" };
  if (/\bbar\b|caff|enoteca|pasticc|gelat/.test(hay))
    return { sing: "locale", plur: "locali" };
  if (/dentist|studio|avvocat|fisio|medic/.test(hay))
    return { sing: "studio", plur: "studi professionali" };
  return { sing: "attività", plur: "attività" };
}

export function cityOf(lead: Lead): string {
  const addr = lead.meta.address ?? "";
  // "Via X, 12, 70122 Bari BA, Italia" → "Bari"
  const m = addr.match(/\b\d{5}\s+([A-Za-zÀ-ù'\s]+?)\s+[A-Z]{2}\b/);
  if (m) return m[1].trim();
  const parts = addr.split(",");
  if (parts.length > 1) return parts[parts.length - 2].trim().replace(/^\d+\s+/, "");
  return "zona";
}

// ---------- Message generation ----------
// No auto-pricing, tiers or promos: the price shown is the one the operator
// sets manually on the lead (lead.value). If unset, the price line is omitted.

function compliment(lead: Lead): string {
  const rating = lead.meta.rating ?? 0;
  const rev = lead.meta.reviews ?? 0;
  if (rating === 5 && rev >= 100) return `${rev} recensioni 5.0 su Google`;
  if (rating === 5) return `5.0 su Google con ${rev} recensioni`;
  if (rating >= 4.9 && rev >= 200) return `${rev} recensioni a ${rating}★`;
  if (rating && rev) return `${rating}★ con ${rev} recensioni su Google`;
  return "numeri importanti su Google";
}

export function generateStep1(lead: Lead): string {
  if (lead.meta.custom_step1) return lead.meta.custom_step1;
  const a = activityType(lead);
  return `Ciao, sono Christian di AYROMEX. Creiamo siti web per ${a.plur} in Puglia.
Ho visto che su Google avete ${compliment(lead)}, ma non avete un sito vostro diretto.
SENZA IMPEGNO vi creo il vostro sito con il vostro materiale già online, così vedete come vi presenteremmo. Che ne dite?`;
}

export function generateStep2(lead: Lead): string {
  if (lead.meta.custom_step2) return lead.meta.custom_step2;
  const a = activityType(lead);
  return `Perfetto.
La preparo usando solo materiale già pubblico del vostro ${a.sing}: foto, recensioni Google, indirizzo, WhatsApp — così vi faccio vedere direttamente come può venire la vostra attività online.
Vi scrivo appena è pronta (entro 24-48h). Se vi piace ne parliamo, se no amici come prima. Zero impegno.`;
}

export function generateStep3(lead: Lead): string {
  if (lead.meta.custom_step3) return lead.meta.custom_step3;
  const previewUrl =
    lead.meta.preview_url || `https://${slugify(lead.name)}-ayromex.vercel.app`;
  // Price = whatever the operator set on the lead. Nothing auto-suggested.
  const priceLine =
    lead.value > 0
      ? `\nPrezzo: €${lead.value.toLocaleString("it-IT")}, tutto incluso — dominio, hosting, setup e SEO.\n`
      : "";
  return `Ciao, pronta:
${previewUrl}

L'ho pensata per trasformare meglio chi vi cerca su Google in contatti WhatsApp e prenotazioni — non solo "per fare bello".

Se vi piace lo stile, la versione completa va online in 2 giorni con dominio + hosting + setup + SEO incluso. Possiamo fare piccole modifiche (foto o testi) se serve.
${priceLine}
Cosa ne pensate del risultato?`;
}

// ---------- Funnel timing / stale detection ----------

export function stageDate(lead: Lead): string | null {
  const m = lead.meta;
  switch (lead.status) {
    case "step1_sent": return m.step1_at ?? null;
    case "replied": return m.replied_at ?? null;
    case "step2_sent": return m.step2_at ?? null;
    case "preview_sent": return m.preview_at ?? null;
    default: return null;
  }
}

export function waitingHours(lead: Lead): number {
  const d = stageDate(lead);
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 3_600_000);
}

/** Lead waiting too long in its current stage → needs attention. */
export function isStale(lead: Lead): boolean {
  const h = waitingHours(lead);
  if (lead.status === "replied" && h > 6) return true;
  if (lead.status === "step2_sent" && h > 24) return true;
  if (lead.status === "preview_sent" && h > 72) return true;
  if (lead.status === "step1_sent" && h > 72) return true;
  return false;
}

// ---------- Next best action ----------

export type PitchActionKind =
  | "open_step1"
  | "set_replied"
  | "open_step2"
  | "open_step3"
  | "mark_closed"
  | "set_negotiating"
  | "mark_lost"
  | "reopen"
  | null;

export interface NextAction {
  title: string;
  desc: string;
  cta: string | null;
  kind: PitchActionKind;
  urgent: boolean;
}

export function nextBestAction(lead: Lead): NextAction {
  const s: LeadStatus = lead.status;
  const stale = isStale(lead);

  if (s === "todo")
    return {
      title: "👋 Manda il messaggio Step 1",
      desc: "Primo contatto + richiesta consenso per la preview gratuita.",
      cta: "Apri WhatsApp con Step 1",
      kind: "open_step1",
      urgent: false,
    };

  if (s === "step1_sent")
    return stale
      ? {
          title: "⏰ Nessuna risposta da 3+ giorni",
          desc: "Probabilmente non interessato. Marca Lost o aspetta ancora.",
          cta: "Marca come Lost",
          kind: "mark_lost",
          urgent: true,
        }
      : {
          title: "📨 In attesa di risposta",
          desc: "Quando rispondono, segna 'Ha risposto' e manda lo Step 2.",
          cta: "Hanno risposto",
          kind: "set_replied",
          urgent: false,
        };

  if (s === "replied")
    return {
      title: stale ? "🔥 URGENTE: ha risposto, rispondi ORA" : "💬 Ha risposto — manda Step 2",
      desc: "Conferma che prepari la preview personalizzata gratuita.",
      cta: "Apri WhatsApp con Step 2",
      kind: "open_step2",
      urgent: stale,
    };

  if (s === "step2_sent")
    return {
      title: stale ? "🔥 PREPARA LA PREVIEW (promessa 24-48h)" : "⚙️ Prepara la preview",
      desc: "Genera il sito personalizzato e mandalo con lo Step 3.",
      cta: "Preview pronta → Step 3",
      kind: "open_step3",
      urgent: stale,
    };

  if (s === "preview_sent")
    return stale
      ? {
          title: "⏰ Preview inviata da 3+ giorni",
          desc: "Follow-up gentile o sposta in trattativa.",
          cta: "Sta valutando",
          kind: "set_negotiating",
          urgent: true,
        }
      : {
          title: "🎯 Preview consegnata — aspetta feedback",
          desc: "Se dicono sì → chiudi. Se temporeggiano → trattativa.",
          cta: "Hanno detto SÌ → Chiudi",
          kind: "mark_closed",
          urgent: false,
        };

  if (s === "negotiating")
    return {
      title: "⌛ In trattativa",
      desc: "Stanno valutando. Aspetta o fai un follow-up gentile.",
      cta: "Hanno detto SÌ → Chiudi",
      kind: "mark_closed",
      urgent: false,
    };

  if (s === "closed")
    return {
      title: `✅ Cliente acquisito${lead.meta.closed_price ? ` (€${lead.meta.closed_price})` : ""}`,
      desc: "Procedi con onboarding e produzione del sito definitivo.",
      cta: null,
      kind: null,
      urgent: false,
    };

  // lost
  return {
    title: "❌ Non interessato",
    desc: lead.meta.lost_reason || "Lead chiuso senza vendita.",
    cta: "Riapri lead",
    kind: "reopen",
    urgent: false,
  };
}
