import { createClient, type Client } from "@libsql/client";

// Trim guards against stray whitespace / a BOM that can sneak in when the
// value is set via a shell pipe — a leading BOM makes the URL invalid.
const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

/** True when Turso credentials are present; otherwise SPECTRE runs on mock data. */
export const isTursoConfigured = Boolean(url && authToken);

/**
 * Server-side Turso (libSQL) client. `null` when not configured or when the
 * config is malformed — a bad URL must degrade to mock (null), never crash
 * the build at module-collect time.
 */
function initTurso(): Client | null {
  if (!url || !authToken) return null;
  try {
    return createClient({ url, authToken });
  } catch (err) {
    console.error(
      "[turso] invalid config, falling back to mock:",
      (err as Error).message,
    );
    return null;
  }
}

export const turso: Client | null = initTurso();

export function isTursoConnected(): boolean {
  return turso !== null;
}
