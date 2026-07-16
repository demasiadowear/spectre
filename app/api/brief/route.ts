import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/autopilot/cron-auth";
import { buildMorningBrief } from "@/lib/brief";
import { sendTelegram } from "@/lib/telegram";

// ============================================================
// Morning brief — GET /api/brief (Bearer CRON_SECRET, stesso guard
// degli altri cron). Schedulato alle 7:00 Europe/Rome su
// cron-job.org (Hobby: i 2 cron Vercel sono già usati da
// scout/study). Trigger manuale: stessa chiamata con lo stesso
// header. Il digest arriva anche dal comando Telegram /brief.
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const brief = await buildMorningBrief();
    // Tutti i blocchi vuoti -> nessun messaggio (niente rumore alle 7).
    if (brief.empty) {
      return NextResponse.json({ success: true, sent: false, stats: brief.stats, text: "" });
    }
    const sent = await sendTelegram(brief.text);
    // text nel payload: la chiamata è già autenticata (CRON_SECRET) e
    // serve a verificare dal trigger manuale cosa è arrivato in chat.
    return NextResponse.json({ success: true, sent, stats: brief.stats, text: brief.text });
  } catch (err) {
    console.error("[api/brief]", (err as Error).message);
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
