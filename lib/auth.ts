import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

// ============================================================
// AYRO SPECTRE — single-tenant auth (NextAuth v4, Credentials).
// One operator. Username + password live in env. When no password
// is configured the whole app runs OPEN (dev bypass + banner) so
// SPECTRE never blocks a zero-config demo. JWT sessions, no DB.
// ============================================================

export const SPECTRE_USER = process.env.SPECTRE_USER || "puccio";
const SPECTRE_PASSWORD = process.env.SPECTRE_PASSWORD ?? "";

/** Dev fallback so the app boots even without NEXTAUTH_SECRET (demo mode). */
export const AUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "spectre-dev-secret-not-for-production";

/** True when no password is set → auth is bypassed and the DEV banner shows. */
export const AUTH_DISABLED = SPECTRE_PASSWORD.length === 0;

export const authOptions: NextAuthOptions = {
  secret: AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "SPECTRE",
      credentials: {
        username: { label: "Operatore", type: "text" },
        password: { label: "Codice", type: "password" },
      },
      authorize(credentials) {
        // No password configured → accept the operator unconditionally.
        if (AUTH_DISABLED) {
          return { id: "spectre", name: SPECTRE_USER };
        }
        if (
          credentials?.username === SPECTRE_USER &&
          credentials?.password === SPECTRE_PASSWORD
        ) {
          return { id: "spectre", name: SPECTRE_USER };
        }
        return null;
      },
    }),
  ],
};
