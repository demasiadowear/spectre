import { NextResponse } from "next/server";
import { COMPLEX_MODEL, gemini } from "@/lib/gemini";
import {
  validateBilling,
  type BillingFields,
  type FieldWarning,
} from "@/lib/zone/fiscal";
import type { ApiResponse } from "@/types";

// POST /api/zone/ocr — foto di biglietto da visita / documento coi
// dati fiscali → Gemini (multimodale) estrae i campi fatturazione →
// checksum P.IVA/CF + validazioni formali → risposta con campi e
// avvisi. NIENTE viene salvato qui: i campi tornano alla scheda,
// dove Puccio verifica, corregge e conferma. La foto non si conserva.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ~6MB di base64 ≈ 4.5MB di immagine: oltre, meglio rifare la foto. */
const MAX_BASE64_LENGTH = 6 * 1024 * 1024;

const EXTRACT_PROMPT = `Sei un estrattore di dati fiscali italiani. Nell'immagine c'è un biglietto da visita, carta intestata o documento con dati aziendali.

Estrai ESATTAMENTE questi campi e rispondi SOLO con un oggetto JSON:
{
  "fatt_ragione_sociale": "ragione sociale / nome azienda",
  "fatt_piva": "partita IVA (solo le 11 cifre, senza prefisso IT)",
  "fatt_cf": "codice fiscale (16 caratteri, o 11 cifre se numerico)",
  "fatt_indirizzo": "indirizzo sede legale (via e civico)",
  "fatt_cap": "CAP (5 cifre)",
  "fatt_citta": "città (ed eventuale provincia)",
  "fatt_email": "email ordinaria",
  "fatt_pec": "indirizzo PEC (email certificata)",
  "fatt_sdi": "codice destinatario SDI (7 caratteri alfanumerici)",
  "fatt_telefono": "telefono"
}

REGOLE FERREE:
- Campo non presente o illeggibile → stringa vuota "". NON inventare MAI.
- Non confondere P.IVA (11 cifre) e codice fiscale (16 caratteri alfanumerici); se c'è un solo numero di 11 cifre etichettato "P.IVA/C.F." mettilo in entrambi.
- La PEC spesso contiene "pec" nel dominio (es. @pec.it, @legalmail.it): non scambiarla con l'email ordinaria.
- Trascrivi i numeri con la massima attenzione, cifra per cifra.`;

const FIELD_KEYS: (keyof BillingFields)[] = [
  "fatt_ragione_sociale",
  "fatt_piva",
  "fatt_cf",
  "fatt_indirizzo",
  "fatt_cap",
  "fatt_citta",
  "fatt_email",
  "fatt_pec",
  "fatt_sdi",
  "fatt_telefono",
];

function sanitize(fields: Record<string, unknown>): BillingFields {
  const out = {} as BillingFields;
  for (const k of FIELD_KEYS) {
    let v = typeof fields[k] === "string" ? (fields[k] as string).trim() : "";
    if (k === "fatt_piva") v = v.replace(/^IT\s*/i, "").replace(/[\s.]/g, "");
    if (k === "fatt_cf" || k === "fatt_sdi") v = v.replace(/\s/g, "").toUpperCase();
    if (k === "fatt_cap") v = v.replace(/\D/g, "").slice(0, 5);
    out[k] = v;
  }
  return out;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Body JSON non valido." },
      { status: 400 },
    );
  }
  const image = typeof body.image === "string" ? body.image : "";
  const mime = typeof body.mime === "string" ? body.mime : "image/jpeg";
  if (!image) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Campo obbligatorio: image (base64)." },
      { status: 400 },
    );
  }
  if (image.length > MAX_BASE64_LENGTH) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Foto troppo pesante: rifalla o riducila (max ~4MB)." },
      { status: 413 },
    );
  }
  if (!gemini) {
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "GEMINI_API_KEY mancante: la scansione richiede Gemini." },
      { status: 500 },
    );
  }

  try {
    const model = gemini.getGenerativeModel({
      model: COMPLEX_MODEL,
      generationConfig: {
        temperature: 0, // trascrizione, non creatività
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });
    const res = await model.generateContent([
      { inlineData: { mimeType: mime, data: image } },
      EXTRACT_PROMPT,
    ]);
    const text = res.response.text();
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const fields = sanitize(parsed);
    const warnings = validateBilling(fields);
    const found = FIELD_KEYS.filter((k) => fields[k] !== "").length;
    return NextResponse.json<
      ApiResponse<{ fields: BillingFields; warnings: FieldWarning[]; found: number }>
    >({ success: true, data: { fields, warnings, found } });
  } catch (err) {
    console.error("[zone/ocr]", (err as Error).message);
    return NextResponse.json<ApiResponse<never>>(
      { success: false, error: "Estrazione fallita: rifai la foto (più luce, più dritta)." },
      { status: 502 },
    );
  }
}
