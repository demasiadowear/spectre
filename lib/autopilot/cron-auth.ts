// Guard per gli endpoint cron Autopilot. Vercel Cron invia
// `Authorization: Bearer ${CRON_SECRET}` quando la env CRON_SECRET è
// impostata sul progetto; lo stesso header lo usa il worker per i
// trigger manuali. Senza CRON_SECRET configurato i cron sono chiusi.
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
