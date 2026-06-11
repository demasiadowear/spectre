import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCaseBySlug } from "@/lib/detective/db";
import type { DetectiveScores } from "@/types/detective";

// ============================================================
// DETECTIVE — report pubblico /detective/[slug].
// Slug non indovinabile, NESSUN login (escluso dal middleware),
// noindex. Mobile-first: il titolare lo apre dal telefono.
// Brand AYROMEX: #FF6A00 su base dark.
// ============================================================

export const dynamic = "force-dynamic";

const ORANGE = "#FF6A00";

const SCORE_LABELS: { key: keyof DetectiveScores; label: string }[] = [
  { key: "visibilita", label: "Visibilità" },
  { key: "reattivita", label: "Reattività" },
  { key: "recupero_clienti", label: "Recupero clienti" },
  { key: "reputazione", label: "Reputazione" },
  { key: "prenotabilita", label: "Prenotabilità" },
];

export const metadata: Metadata = {
  title: "Analisi Detective — AYROMEX",
  robots: { index: false, follow: false },
};

function scoreColor(v: number): string {
  if (v >= 70) return "#4ADE80";
  if (v >= 45) return "#FACC15";
  return ORANGE;
}

/** Gauge circolare SVG, server-renderabile (zero JS client). */
function Gauge({ value, label }: { value: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const filled = (value / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`${label}: ${value} su 100`}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="#2A2A2E" strokeWidth="7" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={scoreColor(value)}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform="rotate(-90 36 36)"
        />
        <text x="36" y="41" textAnchor="middle" fill="#F5F5F4" fontSize="17" fontWeight="700">
          {value}
        </text>
      </svg>
      <span className="text-center text-[11px] leading-tight text-zinc-400">{label}</span>
    </div>
  );
}

export default async function DetectiveReportPage({
  params,
}: {
  params: { slug: string };
}) {
  const c = await getCaseBySlug(params.slug);
  if (!c || !c.analysis) notFound();
  const a = c.analysis;

  const waNumber = (process.env.AYROMEX_WA_NUMBER ?? "").replace(/\D/g, "");
  const waText = encodeURIComponent(
    `Ciao, ho visto l'analisi Detective di ${c.business_name}. Mi interessa l'audit approfondito gratuito.`,
  );
  const reportDate = new Date(
    c.updated_at.includes("T") ? c.updated_at : `${c.updated_at.replace(" ", "T")}Z`,
  ).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });

  const fmtEur = (n: number) => `€${n.toLocaleString("it-IT")}`;

  return (
    <main className="min-h-screen bg-[#0E0E10] px-5 py-8 text-zinc-100 antialiased">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        {/* 1. Header */}
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: ORANGE }}>
            AYROMEX · Detective
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">
            {c.business_name}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Analisi basata esclusivamente su dati pubblici · {reportDate}
          </p>
        </header>

        {/* 2. Score complessivo + 5 gauge */}
        <section className="rounded-2xl border border-zinc-800 bg-[#161618] p-5">
          <div className="flex items-center gap-4">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 text-3xl font-bold"
              style={{ borderColor: scoreColor(a.overall), color: scoreColor(a.overall) }}
            >
              {a.overall}
            </div>
            <div>
              <h2 className="text-lg font-semibold">Salute digitale</h2>
              <p className="text-sm text-zinc-400">
                Punteggio complessivo su 100, da {SCORE_LABELS.length} aree misurate.
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-3 gap-y-5 sm:grid-cols-5">
            {SCORE_LABELS.map(({ key, label }) => (
              <Gauge key={key} value={a.scores[key]} label={label} />
            ))}
          </div>
        </section>

        {/* 3. Dove stai perdendo soldi */}
        <section>
          <h2 className="text-xl font-bold">
            Dove stai perdendo soldi
          </h2>
          <div className="mt-4 flex flex-col gap-3">
            {a.losses.map((l, i) => (
              <article key={i} className="rounded-2xl border border-zinc-800 bg-[#161618] p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold leading-snug">{l.title}</h3>
                  <span className="shrink-0 text-sm font-bold" style={{ color: ORANGE }}>
                    {fmtEur(l.monthly_min)}–{fmtEur(l.monthly_max)}/mese
                  </span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{l.evidence}</p>
                <p className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-sm">
                  <span className="font-semibold" style={{ color: ORANGE }}>
                    {l.automation.name}
                  </span>{" "}
                  <span className="text-zinc-300">— {l.automation.benefit}</span>
                </p>
              </article>
            ))}
          </div>
        </section>

        {/* 4. Range totale + disclaimer assunzioni BEN visibile */}
        <section
          className="rounded-2xl border p-5"
          style={{ borderColor: ORANGE, background: "#1A120B" }}
        >
          <p className="text-sm uppercase tracking-widest text-zinc-400">
            Potenziale stimato non incassato
          </p>
          <p className="mt-1 text-3xl font-bold" style={{ color: ORANGE }}>
            {fmtEur(a.total_min)}–{fmtEur(a.total_max)}
            <span className="text-base font-medium text-zinc-300"> /mese</span>
          </p>
          <div className="mt-4 rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-zinc-400">
            <p className="font-semibold text-zinc-300">
              ⚠️ Si tratta di una STIMA a range, non di una promessa.
            </p>
            <p className="mt-1">
              Calcolata su benchmark di settore e sui soli dati pubblici osservati.
              Assunzioni:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {a.assumptions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. Cosa si può automatizzare (NO prezzi) */}
        <section>
          <h2 className="text-xl font-bold">Cosa si può automatizzare</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {Array.from(
              new Map(a.losses.map((l) => [l.automation.name, l.automation])).values(),
            ).map((auto) => (
              <li
                key={auto.name}
                className="rounded-xl border border-zinc-800 bg-[#161618] px-4 py-3 text-sm"
              >
                <span className="font-semibold">{auto.name}</span>
                <span className="text-zinc-400"> — {auto.benefit}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 6. CTA WhatsApp */}
        <section className="pb-6 text-center">
          <p className="text-sm text-zinc-400">
            Vuoi capire quanto di questo potenziale è recuperabile davvero?
          </p>
          {waNumber ? (
            <a
              href={`https://wa.me/${waNumber}?text=${waText}`}
              className="mt-3 inline-block w-full rounded-2xl px-6 py-4 text-base font-bold text-black sm:w-auto"
              style={{ background: ORANGE }}
            >
              💬 Audit approfondito gratuito su WhatsApp
            </a>
          ) : (
            <p className="mt-3 font-semibold" style={{ color: ORANGE }}>
              Rispondi al messaggio WhatsApp che hai ricevuto: l&apos;audit
              approfondito è gratuito.
            </p>
          )}
          <p className="mt-4 text-[11px] text-zinc-500">
            AYROMEX · analisi indipendente su fonti pubbliche · nessun accesso
            ai sistemi dell&apos;attività
          </p>
        </section>
      </div>
    </main>
  );
}
