import { isPublishableFact, findBannedClaims, validateSiteSpec } from "./sitespec";
import type { QaCheck, QaReport, SiteSpec } from "@/types/factory";

// ============================================================
// QA della demo. Cancello, non decorazione: `ready` (e quindi la
// visibilità della preview) si raggiunge SOLO se tutti i controlli
// bloccanti passano. Meglio nessuna demo che una demo sbagliata
// mostrata a un titolare.
//
// I controlli sulla spec sono deterministici e senza rete, così sono
// testabili e non costano nulla. Lo screenshot è un extra: se il
// browser non parte (serverless capriccioso), il QA DEGRADA — segnala
// il controllo non bloccante come fallito e va avanti, senza
// trasformare un problema di infrastruttura in un lead perso.
// ============================================================

/** Punteggio minimo per considerare la demo presentabile. */
export const QA_PASS_SCORE = 80;

function check(
  code: string,
  label: string,
  passed: boolean,
  blocking: boolean,
  detail = "",
): QaCheck {
  return { code, label, passed, blocking, detail };
}

/** Controlli deterministici sulla SiteSpec. Nessuna rete, nessuna AI. */
export function runSpecChecks(input: SiteSpec | null): QaCheck[] {
  const checks: QaCheck[] = [];

  const parsed = validateSiteSpec(input);
  checks.push(
    check(
      "spec_valid",
      "La SiteSpec rispetta lo schema",
      parsed.ok,
      true,
      parsed.errors.join("; "),
    ),
  );
  if (!parsed.ok || !parsed.value) return checks;
  const spec = parsed.value;

  // --- Identità: senza nome e categoria non c'è niente da mostrare.
  checks.push(
    check(
      "name_sourced",
      "Nome attività con fonte verificata",
      isPublishableFact(spec.business.name),
      true,
      spec.business.name?.source ?? "",
    ),
  );
  checks.push(
    check(
      "category_sourced",
      "Categoria con fonte verificata",
      isPublishableFact(spec.business.category),
      true,
      spec.business.category?.source ?? "",
    ),
  );

  // --- Provenienza: nessun fatto pubblicato senza fonte. Bloccante:
  // è la promessa su cui si regge tutto il modulo.
  const unsourced: string[] = [];
  for (const [field, fact] of Object.entries(spec.business)) {
    if (fact !== undefined && !isPublishableFact(fact)) unsourced.push(`business.${field}`);
  }
  spec.services.forEach((s, i) => {
    if (!isPublishableFact(s)) unsourced.push(`services[${i}]`);
  });
  if (spec.reviews) {
    if (!isPublishableFact(spec.reviews.rating)) unsourced.push("reviews.rating");
    if (!isPublishableFact(spec.reviews.count)) unsourced.push("reviews.count");
  }
  checks.push(
    check(
      "all_facts_sourced",
      "Ogni dato commerciale ha una fonte",
      unsourced.length === 0,
      true,
      unsourced.join(", "),
    ),
  );

  // --- Copy: nessuna affermazione fattuale inventata. Bloccante.
  const claimHits: string[] = [];
  const texts: [string, string][] = [
    ["copy.hero_title", spec.copy.hero_title],
    ["copy.hero_subtitle", spec.copy.hero_subtitle],
    ["copy.about", spec.copy.about],
    ["seo.title", spec.seo.title],
    ["seo.description", spec.seo.description],
    ...spec.sections.flatMap((s, i): [string, string][] => [
      [`sections[${i}].title`, s.title],
      [`sections[${i}].body`, s.body ?? ""],
    ]),
  ];
  for (const [field, text] of texts) {
    const hits = findBannedClaims(text);
    if (hits.length) claimHits.push(`${field}: ${hits.join("/")}`);
  }
  checks.push(
    check(
      "no_invented_claims",
      "Nessuna affermazione inventata nel testo",
      claimHits.length === 0,
      true,
      claimHits.join(" · "),
    ),
  );

  // --- Immagini: nessun asset di terzi pubblicato senza permesso.
  const foreign = spec.images.filter((img) => !img.placeholder && !img.source);
  checks.push(
    check(
      "images_authorized",
      "Nessuna immagine di terzi senza fonte",
      foreign.length === 0,
      true,
      foreign.map((i) => i.url).join(", "),
    ),
  );

  // --- CTA raggiungibile: una demo senza modo di contattare non
  // vende niente, ma non è un difetto di correttezza.
  checks.push(
    check(
      "cta_actionable",
      "La call to action punta a un contatto reale",
      spec.cta.target.length > 0,
      false,
      spec.cta.kind,
    ),
  );

  // --- Contenuto minimo.
  checks.push(
    check("has_sections", "Almeno due sezioni di contenuto", spec.sections.length >= 2, false),
  );
  checks.push(
    check(
      "seo_present",
      "Titolo e descrizione SEO presenti",
      spec.seo.title.length > 0 && spec.seo.description.length > 0,
      false,
    ),
  );
  checks.push(
    check(
      "few_gaps",
      "Non troppi campi incompleti",
      spec.incomplete.length <= 3,
      false,
      spec.incomplete.join(", "),
    ),
  );

  return checks;
}

export function scoreChecks(checks: QaCheck[]): { passed: boolean; score: number } {
  if (checks.length === 0) return { passed: false, score: 0 };
  // Un solo controllo bloccante fallito = bocciata, qualunque sia il
  // punteggio: il punteggio serve a giudicare la qualità, non a
  // comprare il permesso di pubblicare.
  const blockingFailed = checks.some((c) => c.blocking && !c.passed);
  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  return { passed: !blockingFailed && score >= QA_PASS_SCORE, score };
}

export interface ScreenshotResult {
  desktop: string;
  mobile: string;
  error: string;
}

/** Screenshot desktop+mobile della preview. Mai fatale. */
export async function captureScreenshots(previewUrl: string): Promise<ScreenshotResult> {
  const out: ScreenshotResult = { desktop: "", mobile: "", error: "" };
  if (!previewUrl) {
    out.error = "nessun URL di preview";
    return out;
  }
  let browser: Awaited<ReturnType<typeof import("./browser-launch").launchFactoryBrowser>> | null =
    null;
  try {
    const { launchFactoryBrowser } = await import("./browser-launch");
    browser = await launchFactoryBrowser();
    for (const [key, viewport] of [
      ["desktop", { width: 1280, height: 800 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      const page = await browser.newPage({ viewport });
      try {
        await page.goto(previewUrl, { waitUntil: "load", timeout: 20_000 });
        const buf = await page.screenshot({ type: "jpeg", quality: 70 });
        out[key] = `data:image/jpeg;base64,${buf.toString("base64")}`;
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (err) {
    // Il browser serverless che non parte è un problema nostro, non del
    // lead: si annota e si va avanti.
    out.error = (err as Error).message;
  } finally {
    await browser?.close().catch(() => {});
  }
  return out;
}

/** QA completo. `screenshots` opzionale: senza browser il QA regge. */
export async function runQa(
  spec: SiteSpec | null,
  opts?: { previewUrl?: string; screenshots?: boolean },
): Promise<QaReport> {
  const checks = runSpecChecks(spec);

  let shots: ScreenshotResult = { desktop: "", mobile: "", error: "non richiesti" };
  if (opts?.screenshots && opts.previewUrl) {
    shots = await captureScreenshots(opts.previewUrl);
    checks.push(
      check(
        "screenshot_ok",
        "Anteprima catturata su desktop e mobile",
        Boolean(shots.desktop && shots.mobile),
        false,
        shots.error,
      ),
    );
  }

  const { passed, score } = scoreChecks(checks);
  return {
    passed,
    score,
    checks,
    checked_at: new Date().toISOString(),
    screenshots: { desktop: shots.desktop, mobile: shots.mobile },
  };
}

/** Sintesi leggibile per la timeline e per Telegram. */
export function qaSummary(report: QaReport): string {
  const failed = report.checks.filter((c) => !c.passed);
  if (failed.length === 0) return `QA superato (${report.score}/100), nessun rilievo.`;
  const blocking = failed.filter((c) => c.blocking);
  const parts = [`QA ${report.passed ? "superato" : "non superato"} (${report.score}/100)`];
  if (blocking.length) {
    parts.push(`bloccanti: ${blocking.map((c) => c.label).join("; ")}`);
  }
  const minor = failed.filter((c) => !c.blocking);
  if (minor.length) parts.push(`minori: ${minor.map((c) => c.label).join("; ")}`);
  return `${parts.join(" · ")}.`;
}
