import type { Fact, SiteSection, SiteSpec } from "@/types/factory";

// ============================================================
// Renderer deterministico della SiteSpec.
//
// REGOLA PORTANTE: il modello non produce MAI markup. Produce solo
// dati (SiteSpec), e questo componente — che vive nel repository ed
// è l'unico autorizzato a stampare HTML — li rende. Nessun
// dangerouslySetInnerHTML, nessun eval, nessun componente generato:
// una SiteSpec malevola può solo inserire TESTO, che React escapa.
//
// Server-renderizzabile, zero JS client (a parte il ping di view).
// Mobile-first: il titolare apre la demo dal telefono.
// ============================================================

const factValue = <T,>(f: Fact<T> | undefined): T | null => (f ? f.value : null);

/** Solo schemi sicuri negli href: niente javascript:, data:, vbscript:. */
function safeHref(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^(?:tel:|mailto:|https:\/\/|http:\/\/)/i.test(v)) return v;
  return "";
}

function ctaHref(kind: string, target: string): string {
  if (!target) return "";
  if (kind === "call") return safeHref(`tel:${target.replace(/[^\d+]/g, "")}`);
  if (kind === "whatsapp") {
    const digits = target.replace(/[^\d]/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  }
  if (kind === "email") return safeHref(`mailto:${target}`);
  return safeHref(target);
}

/** Segnaposto geometrico generato dal renderer: nessun asset di terzi
 *  e nessuna foto altrui pubblicata senza permesso. */
function Placeholder({ label, palette }: { label: string; palette: SiteSpec["palette"] }) {
  return (
    <div
      className="flex h-44 w-full items-center justify-center rounded-xl border sm:h-56"
      style={{ borderColor: `${palette.primary}33`, background: `${palette.primary}0F` }}
      role="img"
      aria-label={label}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <rect x="6" y="10" width="36" height="28" rx="3" fill="none" stroke={palette.primary} strokeWidth="2" />
        <circle cx="17" cy="20" r="3.5" fill={palette.primary} opacity="0.7" />
        <path d="M11 34l9-9 6 6 5-5 6 8z" fill={palette.primary} opacity="0.5" />
      </svg>
    </div>
  );
}

function Section({ section, palette }: { section: SiteSection; palette: SiteSpec["palette"] }) {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-7">
      <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
        {section.title}
      </h2>
      {section.body ? (
        <p className="mt-2 text-sm leading-relaxed opacity-85 sm:text-base">{section.body}</p>
      ) : null}
    </section>
  );
}

export interface SiteRendererProps {
  spec: SiteSpec;
  /** true = mostra il pannello provenienza (anteprima interna).
   *  Sulla demo inviata al cliente resta nascosto. */
  showProvenance?: boolean;
}

export function SiteRenderer({ spec, showProvenance = false }: SiteRendererProps) {
  const { palette } = spec;
  const name = factValue(spec.business.name) ?? "";
  const category = factValue(spec.business.category) ?? "";
  const address = factValue(spec.business.address);
  const phone = factValue(spec.business.phone);
  const email = factValue(spec.business.email);
  const hours = factValue(spec.business.hours);
  const maps = factValue(spec.business.maps_url);
  const href = ctaHref(spec.cta.kind, spec.cta.target);
  const hero = spec.images[0];

  return (
    <main
      className="min-h-screen"
      style={{ background: palette.bg, color: palette.fg, fontFamily: "system-ui, sans-serif" }}
    >
      {/* ----- Hero ----- */}
      <header className="mx-auto w-full max-w-3xl px-4 pb-6 pt-10">
        <p className="text-xs uppercase tracking-[0.2em] opacity-60">{category}</p>
        <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-4xl">{name}</h1>
        <p className="mt-3 text-base opacity-85 sm:text-lg">{spec.copy.hero_title}</p>
        <p className="mt-1 text-sm opacity-70 sm:text-base">{spec.copy.hero_subtitle}</p>

        {href ? (
          <a
            href={href}
            className="mt-5 inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold"
            style={{ background: palette.primary, color: palette.bg }}
            rel="nofollow noopener"
          >
            {spec.cta.label}
          </a>
        ) : (
          <p className="mt-5 text-sm opacity-60">{spec.cta.label}</p>
        )}

        <div className="mt-6">
          {hero && !hero.placeholder && safeHref(hero.url) ? (
            // eslint-disable-next-line @next/next/no-img-element -- demo statica: nessun loader Next sui domini dei terzi
            <img
              src={hero.url}
              alt={hero.alt}
              className="h-44 w-full rounded-xl object-cover sm:h-56"
              loading="lazy"
            />
          ) : (
            <Placeholder label={hero?.alt || name} palette={palette} />
          )}
        </div>
      </header>

      {/* ----- Sezioni nell'ORDINE deciso dal template verticale -----
          Una pizzeria mette il locale prima dei piatti, un salone i
          trattamenti prima di sé: l'ordine è parte del mestiere, non
          un dettaglio estetico. Il renderer non ne sceglie nessuno,
          esegue quello che la spec dichiara. */}
      {spec.sections.map((section, i) => {
        const key = `${section.kind}-${i}`;

        if (section.kind === "services") {
          if (spec.services.length === 0) return null;
          return (
            <section key={key} className="mx-auto w-full max-w-3xl px-4 py-7">
              <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
                {section.title}
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {spec.services.map((s, j) => (
                  <li
                    key={`${s.value}-${j}`}
                    className="rounded-lg border px-3 py-2.5 text-sm leading-snug"
                    style={{ borderColor: `${palette.primary}26`, background: `${palette.primary}08` }}
                  >
                    {s.value}
                  </li>
                ))}
              </ul>
            </section>
          );
        }

        if (section.kind === "reviews") {
          if (!spec.reviews) return null;
          return (
            <section key={key} className="mx-auto w-full max-w-3xl px-4 py-7">
              <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
                {section.title}
              </h2>
              <p className="mt-2 text-sm opacity-85 sm:text-base">
                {spec.reviews.rating.value.toFixed(1)} su 5 · {spec.reviews.count.value} recensioni
              </p>
            </section>
          );
        }

        if (section.kind === "hours") {
          if (!hours || hours.length === 0) return null;
          return (
            <section key={key} className="mx-auto w-full max-w-3xl px-4 py-7">
              <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
                {section.title}
              </h2>
              <ul className="mt-3 space-y-1 text-sm opacity-85">
                {hours.map((h, j) => (
                  <li key={`${h}-${j}`} className="border-b py-1 last:border-0" style={{ borderColor: `${palette.primary}1A` }}>
                    {h}
                  </li>
                ))}
              </ul>
            </section>
          );
        }

        if (section.kind === "contact") {
          return (
            <section key={key} className="mx-auto w-full max-w-3xl px-4 py-7">
              <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
                {section.title}
              </h2>
              <ul className="mt-3 space-y-2 text-sm opacity-90 sm:text-base">
                {phone ? (
                  <li>
                    <a
                      href={safeHref(`tel:${phone.replace(/[^\d+]/g, "")}`)}
                      rel="nofollow noopener"
                      className="underline decoration-1 underline-offset-4"
                    >
                      {phone}
                    </a>
                  </li>
                ) : null}
                {email ? (
                  <li>
                    <a
                      href={safeHref(`mailto:${email}`)}
                      rel="nofollow noopener"
                      className="underline decoration-1 underline-offset-4"
                    >
                      {email}
                    </a>
                  </li>
                ) : null}
                {address ? <li className="opacity-80">{address}</li> : null}
              </ul>
              {href ? (
                <a
                  href={href}
                  className="mt-4 inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold"
                  style={{ background: palette.primary, color: palette.bg }}
                  rel="nofollow noopener"
                >
                  {spec.cta.label}
                </a>
              ) : null}
            </section>
          );
        }

        if (section.kind === "map") {
          if (!maps || !safeHref(maps)) return null;
          return (
            <section key={key} className="mx-auto w-full max-w-3xl px-4 py-7">
              <h2 className="text-lg font-semibold sm:text-xl" style={{ color: palette.primary }}>
                {section.title}
              </h2>
              {address ? <p className="mt-2 text-sm opacity-85">{address}</p> : null}
              <a
                href={safeHref(maps)}
                rel="nofollow noopener"
                target="_blank"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm"
                style={{ borderColor: `${palette.primary}55`, color: palette.primary }}
              >
                Apri su Google Maps
              </a>
            </section>
          );
        }

        // about e qualsiasi altra sezione testuale.
        return <Section key={key} section={section} palette={palette} />;
      })}

      <footer className="mx-auto w-full max-w-3xl px-4 pb-12 pt-4 text-xs opacity-50">
        <p>Anteprima realizzata da AYROMEX. Contenuti da verificare con il titolare.</p>
      </footer>

      {/* ----- Provenienza: solo in anteprima interna ----- */}
      {showProvenance ? (
        <aside className="mx-auto w-full max-w-3xl px-4 pb-12 text-xs opacity-70">
          <h3 className="font-semibold uppercase tracking-wider">Provenienza dati</h3>
          <ul className="mt-2 space-y-1">
            {spec.sources.map((s) => (
              <li key={s}>· {s}</li>
            ))}
          </ul>
          {spec.incomplete.length > 0 ? (
            <>
              <h3 className="mt-4 font-semibold uppercase tracking-wider">Campi incompleti</h3>
              <ul className="mt-2 space-y-1">
                {spec.incomplete.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}

export default SiteRenderer;
