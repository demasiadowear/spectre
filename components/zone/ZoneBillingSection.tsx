"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, FileText, Loader2 } from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { validateBilling, type BillingFields } from "@/lib/zone/fiscal";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { ZoneClientDetail } from "@/types/zone";

// ============================================================
// Fattura e dati fiscali — dentro la scheda cliente. Flusso OCR:
// foto → Gemini estrae → checksum P.IVA/CF evidenzia i sospetti →
// Puccio verifica/corregge → SOLO il suo "Salva" scrive sul DB.
// ============================================================

const FIELD_META: { key: keyof BillingFields; label: string; wide?: boolean }[] = [
  { key: "fatt_ragione_sociale", label: "Ragione sociale", wide: true },
  { key: "fatt_piva", label: "Partita IVA" },
  { key: "fatt_cf", label: "Codice fiscale" },
  { key: "fatt_indirizzo", label: "Indirizzo sede legale", wide: true },
  { key: "fatt_cap", label: "CAP" },
  { key: "fatt_citta", label: "Città" },
  { key: "fatt_email", label: "Email" },
  { key: "fatt_pec", label: "PEC" },
  { key: "fatt_sdi", label: "Codice SDI" },
  { key: "fatt_telefono", label: "Telefono fatturazione" },
];

const INVOICE_OPTIONS = [
  { value: "" as const, label: "Nessuna" },
  { value: "richiesta" as const, label: "📄 Richiesta" },
  { value: "fatturata" as const, label: "✓ Fatturata" },
];

const inputCls =
  "w-full rounded-sm border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text placeholder:text-text2/60 focus:border-accent focus:outline-none";

/** Riduce la foto lato client (max 1600px, JPEG) prima dell'upload:
 *  foto da 12MP intere sono inutili per l'OCR e lente da caricare. */
async function compressImage(file: File): Promise<{ base64: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1], mime: "image/jpeg" };
}

interface Props {
  detail: ZoneClientDetail;
  busy: boolean;
  patch: (fields: Record<string, unknown>) => Promise<boolean>;
  flash: (msg: string) => void;
}

export default function ZoneBillingSection({ detail, busy, patch, flash }: Props) {
  const [fields, setFields] = useState<BillingFields>(() => pick(detail));
  const [scanning, setScanning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFields(pick(detail));
    setDirty(false);
  }, [detail]);

  function pick(d: ZoneClientDetail): BillingFields {
    return {
      fatt_ragione_sociale: d.fatt_ragione_sociale,
      fatt_piva: d.fatt_piva,
      fatt_cf: d.fatt_cf,
      fatt_indirizzo: d.fatt_indirizzo,
      fatt_cap: d.fatt_cap,
      fatt_citta: d.fatt_citta,
      fatt_email: d.fatt_email,
      fatt_pec: d.fatt_pec,
      fatt_sdi: d.fatt_sdi,
      fatt_telefono: d.fatt_telefono,
    };
  }

  // Validazione viva: checksum P.IVA/CF e formati, ricalcolati a ogni
  // tocco — stessa logica del server (funzioni pure condivise).
  const warnings = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of validateBilling(fields)) map.set(w.field, w.message);
    return map;
  }, [fields]);

  const set = (key: keyof BillingFields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  async function scan(file: File) {
    setScanning(true);
    try {
      const { base64, mime } = await compressImage(file);
      const res = await fetch("/api/zone/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mime }),
      });
      const json = (await res.json()) as ApiResponse<{
        fields: BillingFields;
        warnings: { field: string; message: string }[];
        found: number;
      }>;
      if (!json.success || !json.data) {
        flash(`Scansione fallita: ${json.error ?? "riprova"}`);
        return;
      }
      // Precompila SOLO i campi trovati: quelli già scritti a mano non
      // vengono svuotati da una foto parziale.
      setFields((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(json.data!.fields) as (keyof BillingFields)[]) {
          if (json.data!.fields[k]) next[k] = json.data!.fields[k];
        }
        return next;
      });
      setDirty(true);
      flash(
        json.data.warnings.length > 0
          ? `Estratti ${json.data.found} campi — ${json.data.warnings.length} da ricontrollare (in rosso). VERIFICA prima di salvare.`
          : `Estratti ${json.data.found} campi. Verifica e salva.`,
      );
    } catch {
      flash("Scansione fallita: riprova con più luce.");
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    const ok = await patch({ ...fields });
    if (ok) {
      setDirty(false);
      flash("Dati fatturazione salvati.");
    }
  }

  return (
    <section className="border-t border-surface2 px-5 py-4">
      <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
        Fattura e dati fiscali
      </h3>

      {/* stato fattura */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {INVOICE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={busy}
            onClick={() => patch({ invoice_status: o.value })}
            className={cn(
              "rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
              detail.invoice_status === o.value
                ? o.value === "richiesta"
                  ? "border-danger/50 bg-danger/15 text-danger"
                  : o.value === "fatturata"
                    ? "border-success/40 bg-success/15 text-success"
                    : "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text2 hover:text-text",
            )}
          >
            {detail.invoice_status === o.value && (
              <Check className="mr-1 inline h-3 w-3" />
            )}
            {o.label}
          </button>
        ))}
        {detail.invoice_status === "richiesta" && (
          <span className="font-ui text-[11px] text-danger">← fattura da emettere</span>
        )}
      </div>

      {/* scansione */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && scan(e.target.files[0])}
      />
      <NeonButton
        size="sm"
        variant="cyan"
        disabled={scanning || busy}
        onClick={() => fileRef.current?.click()}
      >
        {scanning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Camera className="h-3.5 w-3.5" />
        )}
        {scanning ? "Leggo la foto…" : "Scansiona biglietto/dati fiscali"}
      </NeonButton>
      <p className="mt-1 font-ui text-[10px] text-text2">
        I campi estratti restano modificabili: P.IVA e CF sono verificati col
        checksum, ma controlla sempre prima di salvare.
      </p>

      {/* campi */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {FIELD_META.map(({ key, label, wide }) => (
          <label
            key={key}
            className={cn("block font-ui text-[10px] text-text2", wide && "col-span-2")}
          >
            {label}
            <input
              value={fields[key]}
              onChange={(e) => set(key, e.target.value)}
              className={cn(
                inputCls,
                "mt-0.5",
                warnings.has(key) && "border-danger focus:border-danger",
              )}
            />
            {warnings.has(key) && (
              <span className="mt-0.5 block text-[10px] text-danger">
                ⚠ {warnings.get(key)}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <NeonButton size="sm" onClick={save} disabled={busy || !dirty}>
          <FileText className="h-3.5 w-3.5" /> Salva dati fatturazione
        </NeonButton>
        {dirty && (
          <span className="font-ui text-[10px] text-ochre">modifiche non salvate</span>
        )}
      </div>
    </section>
  );
}
