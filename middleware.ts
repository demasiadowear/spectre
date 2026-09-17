import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ============================================================
// Gate every protected route behind a valid JWT. When no
// SPECTRE_PASSWORD is set the gate is open (dev bypass — the
// DevModeBanner makes this visible). Env is re-read here rather
// than imported from lib/auth so the edge bundle stays tiny.
// ============================================================

const AUTH_DISABLED = !process.env.SPECTRE_PASSWORD;
const AUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "spectre-dev-secret-not-for-production";

export async function middleware(req: NextRequest) {
  if (AUTH_DISABLED) return NextResponse.next();

  // I cron (scout/study Autopilot + Intent Scout, quest'ultimo via
  // cron-job.org o Vercel Cron) si autenticano con il bearer
  // CRON_SECRET, non con la sessione. Bypass limitato ai SOLI
  // endpoint cron: tutte le altre API restano dietro il JWT.
  const cronSecret = process.env.CRON_SECRET;
  const CRON_PATHS = [
    "/api/autopilot/scout",
    "/api/autopilot/study",
    "/api/intent/scout",
    "/api/intent/aste",
    "/api/brief",
    // Worker Factory (cron feriale 07:00 UTC). Senza questa riga la
    // chiamata autenticata col bearer finirebbe redirezionata su /login.
    "/api/factory/run",
  ];
  if (
    cronSecret &&
    CRON_PATHS.includes(req.nextUrl.pathname) &&
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: AUTH_SECRET });
  if (token) return NextResponse.next();

  const login = new URL("/login", req.url);
  login.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Protect everything except the login page, the auth API, the public
  // Detective reports — SOLO /detective/<slug> ("detective/" col trailing
  // slash: la dashboard /detective e le API /api/detective/* restano
  // dietro il JWT) — Next internals and static assets.
  // api/telegram resta fuori dal matcher: Telegram non ha sessione JWT,
  // il webhook si difende da solo (X-Telegram-Bot-Api-Secret-Token +
  // whitelist chat_id nella route).
  // preview/ e api/factory/demo-view: demo Forge aperte dal prospect,
  // che non ha sessione. Lo slug a 22 caratteri da crypto.randomBytes È
  // la credenziale; il ping risponde identico a slug validi e non validi
  // (vedi la route) così non diventa un oracolo di enumerazione. Come
  // per detective, "preview/" ha il trailing slash: la dashboard
  // /api/factory/* resta dietro il JWT.
  matcher: [
    "/((?!login|api/auth|api/telegram|api/factory/demo-view|detective/|preview/|_next/static|_next/image|favicon.ico|fonts).*)",
  ],
};
