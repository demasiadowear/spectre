import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { authState, corpo503, segretoDiFirma } from "@/lib/auth-mode";

// ============================================================
// Il cancello. Tre esiti, e nessuno di questi e "lascio passare
// perche non so".
//
//  1. `not_configured` -> 503 e basta. Prima questo caso APRIVA
//     l'applicazione: `AUTH_DISABLED = !process.env.SPECTRE_PASSWORD`
//     significava che su Vercel, senza il segreto, chiunque avesse
//     l'URL entrava. Su un deployment pubblico non e una comodita di
//     sviluppo, e un fail-open.
//  2. `dev_open` -> passa, ma solo con ALLOW_DEV_NO_AUTH=1, fuori da
//     Vercel e fuori da produzione.
//  3. `enforced` -> serve un JWT valido.
//
// Il calcolo sta in lib/auth-mode.ts, che non tocca la rete e si
// testa da solo. Qui si applica soltanto.
// ============================================================

const STATO = authState();

/** Bypass dei cron: bearer CRON_SECRET su un elenco chiuso di rotte.
 *  Vale solo in `enforced`: se l'autenticazione non e configurata, non
 *  esiste nemmeno un cron autorizzato. */
const CRON_PATHS = [
  "/api/autopilot/scout",
  "/api/autopilot/study",
  "/api/intent/scout",
  "/api/intent/aste",
  "/api/brief",
  "/api/factory/run",
];

export async function middleware(req: NextRequest) {
  if (STATO.mode === "not_configured") {
    // Si chiude tutto: dashboard e API. Il corpo dice cosa manca per
    // nome, cosi si sistema senza doverlo indovinare, e non contiene
    // nessun valore.
    return NextResponse.json(corpo503(STATO), {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (STATO.mode === "dev_open") return NextResponse.next();

  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    CRON_PATHS.includes(req.nextUrl.pathname) &&
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: segretoDiFirma() });
  if (token) return NextResponse.next();

  const login = new URL("/login", req.url);
  login.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Protegge tutto tranne la pagina di login, l'API di NextAuth, i
  // report Detective pubblici — SOLO /detective/<slug>, col trailing
  // slash, cosi la dashboard /detective e le API /api/detective/*
  // restano dietro il JWT — gli interni di Next e gli asset statici.
  //
  // api/telegram resta fuori: Telegram non ha una sessione, il webhook
  // si difende da solo (secret token + whitelist chat_id nella route).
  //
  // preview/ e api/factory/demo-view: demo aperte dal prospect, che non
  // ha sessione. Lo slug a 22 caratteri da crypto.randomBytes E la
  // credenziale, e il ping risponde identico a slug validi e non validi
  // cosi non diventa un oracolo di enumerazione.
  //
  // `login` e `api/auth` restano fuori anche quando l'autenticazione
  // non e configurata: la pagina di login si spiega da sola (mostra il
  // 503 che riceve dalle API) e `authorize()` in lib/auth.ts rifiuta
  // comunque ogni credenziale in quella modalita, quindi da li non si
  // entra.
  matcher: [
    "/((?!login|api/auth|api/telegram|api/factory/demo-view|detective/|preview/|_next/static|_next/image|favicon.ico|fonts).*)",
  ],
};
