import { createClient, type Client } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

/** True when Turso credentials are present; otherwise SPECTRE runs on mock data. */
export const isTursoConfigured = Boolean(url && authToken);

/** Server-side Turso (libSQL) client. `null` when not configured (demo / mock mode). */
export const turso: Client | null = isTursoConfigured
  ? createClient({ url: url as string, authToken: authToken as string })
  : null;

export function isTursoConnected(): boolean {
  return turso !== null;
}
