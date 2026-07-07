// ============================================================
// Enrichment contatti via Serper (google.serper.dev) — portato
// dal predecessore agenti-01 e ristretto al caso utile a SPECTRE:
// i lead con SOLO numero fisso non sono raggiungibili su WhatsApp,
// qui si prova a recuperare un'EMAIL (canale alternativo alla
// chiamata) dagli snippet Google. Senza SERPER_API_KEY: no-op.
// Non lancia mai: un fallimento di enrichment non ferma lo study.
// ============================================================

export interface SerperContact {
  email?: string;
  website?: string;
}

/** Cerca email (e sito, bonus) di un'attività su Google via Serper.
 *  Torna {} se la key manca, la ricerca fallisce o non trova nulla. */
export async function findContactWithSerper(
  company: string,
  city: string,
): Promise<SerperContact> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key || !company) return {};
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({
        q: `"${company}" ${city} email contatti`,
        num: 5,
        gl: "it",
        hl: "it",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error("[enrich/serper] HTTP", res.status);
      return {};
    }
    const data = await res.json();

    let email: string | undefined;
    let website: string | undefined;

    const kg = data.knowledgeGraph;
    if (typeof kg?.website === "string") website = kg.website;

    const organic: Array<{ snippet?: string; title?: string; link?: string }> =
      Array.isArray(data.organic) ? data.organic : [];
    for (const r of organic.slice(0, 5)) {
      const text = `${r.snippet ?? ""} ${r.title ?? ""}`;
      if (!email) {
        // Email negli snippet; esclusi i domini "esempio" delle piattaforme.
        const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (m && !/@(example|sentry|wixpress)\./i.test(m[0])) email = m[0].toLowerCase();
      }
      if (
        !website &&
        r.link &&
        !/google\.|facebook\.|instagram\.|tripadvisor\.|paginegialle\./i.test(r.link)
      ) {
        website = r.link;
      }
    }
    return { email, website };
  } catch (err) {
    console.error("[enrich/serper] fallito:", (err as Error).message);
    return {};
  }
}
