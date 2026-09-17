import { AUTH_MODE } from "@/lib/auth";

/**
 * Avviso di modalita aperta.
 *
 * Compare SOLO in `dev_open`, cioe con `ALLOW_DEV_NO_AUTH=1`, fuori da
 * Vercel e fuori da produzione. Prima compariva ogni volta che mancava
 * la password — anche su un deployment pubblico, dove non era un
 * avviso ma la conferma di un fail-open.
 *
 * In `not_configured` non serve nessun banner: il middleware risponde
 * 503 e la dashboard non viene nemmeno servita.
 *
 * Server component: legge la modalita calcolata una volta all'avvio.
 * pointer-events-none cosi non intercetta mai un clic.
 */
export default function DevModeBanner() {
  if (AUTH_MODE !== "dev_open") return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-sm border border-spectre-amber/50 bg-scrim/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.3em] text-spectre-amber shadow-neon-amber backdrop-blur">
        <span className="inline-block h-1.5 w-1.5 animate-blink rounded-full bg-spectre-amber" />
        LOCALE — ALLOW_DEV_NO_AUTH
      </div>
    </div>
  );
}
