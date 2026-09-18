import { NextResponse } from "next/server";
import { ENV_GOOGLE } from "@/lib/collector/capability";
import { RIFERIMENTO_FOTO, urlMediaProvider } from "@/lib/collector/places";
import type { ApiResponse } from "@/types";

// ============================================================
// Mostra una fotografia di Google Places, senza copiarla e senza
// esporre la chiave.
//
// Perche esiste: l'endpoint del provider vuole la chiave API, e una
// chiave in una pagina e una chiave pubblica. Quindi la fotografia
// passa di qui: il browser chiede un riferimento opaco, il server
// aggiunge la chiave, e i byte tornano indietro senza sostare da
// nessuna parte.
//
// Tre regole che questa rotta fa rispettare:
//
//  1. NIENTE COPIA. `Cache-Control: no-store`, nessuna scrittura su
//     disco, nessun passaggio dallo storage. La fotografia non e
//     nostra e non la si tiene.
//  2. NIENTE CHIAVE AL BROWSER. La chiave sta solo qui dentro, e non
//     compare mai in una risposta, nemmeno in un messaggio d'errore.
//  3. NIENTE URL ARBITRARI. L'ingresso e un riferimento Places nella
//     forma `places/<id>/photos/<id>`, verificata con un'espressione
//     regolare stretta. Se accettasse un URL, questa rotta sarebbe un
//     proxy aperto: chiunque abbia una sessione potrebbe farsi
//     scaricare qualunque cosa dal nostro server.
//
// Quando il riferimento scade — Places li ruota — il provider risponde
// 4xx e qui si restituisce 410, cosi il pannello sa che deve rifare la
// raccolta invece di mostrare un riquadro rotto.
// ============================================================

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Larghezze ammesse: un elenco chiuso, non un numero libero. Un
 *  parametro numerico aperto diventa una leva per far scaricare al
 *  nostro server immagini enormi a ripetizione. */
const LARGHEZZE = [400, 800, 1200, 1600];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const riferimento = (url.searchParams.get("ref") ?? "").trim();
  const larghezza = Number(url.searchParams.get("w") ?? 1200);

  if (!RIFERIMENTO_FOTO.test(riferimento)) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "riferimento non valido: serve un nome di fotografia Places" },
      { status: 422 },
    );
  }
  const w = LARGHEZZE.indexOf(larghezza) !== -1 ? larghezza : 1200;

  const chiave = (process.env[ENV_GOOGLE] ?? "").trim();
  if (!chiave) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: `${ENV_GOOGLE} non configurata: la fotografia non puo essere resa` },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(urlMediaProvider(riferimento, w, chiave), {
      // Il provider risponde con un redirect verso la sua CDN: lo si
      // segue qui, sul server, cosi il browser non vede mai la chiave.
      redirect: "follow",
    });

    if (!res.ok) {
      // Un riferimento ruotato o scaduto: non e un guasto nostro, ed e
      // un'informazione che il pannello puo usare.
      const scaduto = res.status === 400 || res.status === 403 || res.status === 404;
      return NextResponse.json<ApiResponse<never>>(
        {
          success: false,
          error: scaduto
            ? "riferimento non piu valido: rifare la raccolta per aggiornare i riferimenti fotografici"
            : `il provider ha risposto ${res.status}`,
        },
        { status: scaduto ? 410 : 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    const tipo = res.headers.get("content-type") ?? "image/jpeg";
    if (!/^image\//i.test(tipo)) {
      return NextResponse.json<ApiResponse<never>>(
        { success: false, error: "il provider non ha restituito un'immagine" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": tipo,
        // Non si conserva: ne da noi, ne nella cache del browser, ne in
        // quella di Vercel. E il senso di `do_not_store`.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-Robots-Tag": "noindex",
        // L'attribuzione viaggia col contenuto, non solo nel pannello.
        "X-Image-Source": "Google Maps",
      },
    });
  } catch {
    // Il messaggio del provider puo contenere l'URL con la chiave in
    // query: non esce di qui, nemmeno come dettaglio.
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "fotografia non recuperabile dal provider" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
