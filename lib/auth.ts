import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authState, ENV_AUTH_SECRET } from "./auth-mode";

// ============================================================
// AYRO SPECTRE — autenticazione a operatore unico (NextAuth v4).
//
// La regola e in lib/auth-mode.ts e qui si applica soltanto. Due cose
// che prima erano sbagliate e ora non lo sono:
//
//  1. l'assenza della password NON apre piu l'applicazione. Apre solo
//     una opt-in esplicita, e solo in locale;
//  2. `NEXTAUTH_SECRET` non ha piu un valore di ripiego. Il ripiego era
//     una stringa fissa scritta in un repository pubblico: chiunque
//     l'avesse letta poteva firmarsi un token valido, anche con la
//     password configurata. In modalita `enforced` il segreto deve
//     esserci, e senza non si firma niente.
// ============================================================

export const SPECTRE_USER = process.env.SPECTRE_USER || "puccio";
const SPECTRE_PASSWORD = process.env.SPECTRE_PASSWORD ?? "";

const STATO = authState();

/** Vero SOLO in modalita sviluppo aperta, chiesta esplicitamente.
 *  `not_configured` non e "aperto": e chiuso, e risponde 503. */
export const AUTH_DISABLED = STATO.open;
export const AUTH_MODE = STATO.mode;
export const AUTH_STATE = STATO;

/** Il segreto di firma. In `dev_open` si usa un valore locale, che non
 *  protegge niente ma nemmeno pretende di farlo; altrove e quello
 *  configurato, e se manca la modalita e `not_configured` e nessuna
 *  richiesta arriva fin qui. */
export const AUTH_SECRET =
  process.env[ENV_AUTH_SECRET] || (STATO.open ? "spectre-dev-solo-locale" : "");

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
        // Senza configurazione non si entra: prima questo ramo
        // accettava chiunque ogni volta che la password mancava.
        if (STATO.mode === "not_configured") return null;

        if (STATO.open) {
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
