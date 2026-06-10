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

  // I cron Vercel (scout/study Autopilot) si autenticano con il bearer
  // CRON_SECRET, non con la sessione: lasciali passare — la route fa
  // comunque la sua verifica via isCronAuthorized.
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    req.nextUrl.pathname.startsWith("/api/autopilot/") &&
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
  // Protect everything except the login page, the auth API, Next
  // internals and static assets.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|fonts).*)",
  ],
};
