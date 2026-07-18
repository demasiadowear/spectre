"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  ExternalLink,
  Handshake,
  Nfc,
  Phone,
  Plus,
  RefreshCw,
  TrendingUp,
  X,
} from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import ZoneBillingSection from "@/components/zone/ZoneBillingSection";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  ZoneClientDetail,
  ZoneClientStatus,
  ZoneLead,
  ZoneProduct,
} from "@/types/zone";

// ============================================================
// Scheda cliente del Registro — quello che Puccio usa in negozio:
// link NFC "copia per NFC", stato rapido, vendite, card (assegna /
// sostituisci), referente e note.
// ============================================================

export const STATUS_LABEL: Record<ZoneClientStatus, string> = {
  da_visitare: "Da visitare",
  visitato: "Visitato",
  venduto: "Venduto",
  non_interessato: "Non interessato",
  da_richiamare: "Da richiamare",
};

export const STATUS_CHIP: Record<ZoneClientStatus, string> = {
  da_visitare: "bg-surface2 text-text2 border-border",
  visitato: "bg-ochre/15 text-ochre border-ochre/40",
  venduto: "bg-success/15 text-success border-success/40",
  non_interessato: "bg-surface2 text-text2 border-border opacity-70",
  da_richiamare: "bg-accent/15 text-accent border-accent/40",
};

const STATUSES: ZoneClientStatus[] = [
  "da_visitare",
  "visitato",
  "venduto",
  "non_interessato",
  "da_richiamare",
];

interface Props {
  clientId: string;
  /** Dati del risultato di scan: permette di aprire la scheda COMPLETA
   *  anche se il lead NON è in Registro. Il salvataggio avviene solo
   *  col bottone dedicato o alla prima azione (stato/vendita/…). */
  previewLead?: ZoneLead | null;
  onClose: () => void;
  /** Notifica il padre che il cliente è cambiato (per il refresh lista). */
  onChanged: () => void;
}

/** Scheda "vergine" costruita dal risultato scan (niente DB). */
function detailFromLead(l: ZoneLead): ZoneClientDetail {
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    address: l.address,
    cap: /\b(\d{5})\b/.exec(l.address)?.[1] ?? "",
    phone: l.phone,
    lat: l.lat,
    lng: l.lng,
    maps_url: l.maps_url,
    nfc_review_url: l.nfc_review_url ?? "",
    rating: l.rating,
    reviews: l.reviews,
    zone_label: "",
    status: "da_visitare",
    callback_at: null,
    referent: "",
    notes: "",
    fatt_ragione_sociale: "",
    fatt_piva: "",
    fatt_cf: "",
    fatt_indirizzo: "",
    fatt_cap: "",
    fatt_citta: "",
    fatt_email: "",
    fatt_pec: "",
    fatt_sdi: "",
    fatt_telefono: "",
    invoice_status: "",
    reviews_at_sale: null,
    reviews_updated_at: null,
    loan_status: "nessuno",
    loan_started_at: null,
    loan_due_at: null,
    reviews_at_loan: null,
    created_at: "",
    updated_at: "",
    sales: [],
    cards: [],
    snapshots: [],
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-surface2 px-5 py-4">
      <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls =
  "w-full rounded-sm border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text placeholder:text-text2/60 focus:border-accent focus:outline-none";

export default function ZoneClientSheet({ clientId, previewLead, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ZoneClientDetail | null>(null);
  const [inRegistry, setInRegistry] = useState(true);
  const [products, setProducts] = useState<ZoneProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // form scheda
  const [callback, setCallback] = useState("");
  const [referent, setReferent] = useState("");
  const [notes, setNotes] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  // form vendita
  const [saleProduct, setSaleProduct] = useState("");
  const [saleQty, setSaleQty] = useState(1);
  const [salePrice, setSalePrice] = useState("");
  const [saleCards, setSaleCards] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  // form comodato
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanProduct, setLoanProduct] = useState("");
  const [loanCards, setLoanCards] = useState("");
  const [loanDays, setLoanDays] = useState("15");
  // form card
  const [newCard, setNewCard] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceWith, setReplaceWith] = useState("");

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/zone/clients?id=${encodeURIComponent(clientId)}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as ApiResponse<ZoneClientDetail>;
    if (json.success && json.data) {
      setInRegistry(true);
      setDetail(json.data);
      setCallback(json.data.callback_at ? json.data.callback_at.slice(0, 10) : "");
      setReferent(json.data.referent);
      setNotes(json.data.notes);
      setZoneLabel(json.data.zone_label);
    } else if (previewLead) {
      // non in registro: scheda completa dai dati dello scan, il
      // salvataggio arriva dopo (bottone o prima azione)
      setInRegistry(false);
      setDetail(detailFromLead(previewLead));
      setCallback("");
      setReferent("");
      setNotes("");
      setZoneLabel("");
    }
  }, [clientId, previewLead]);

  useEffect(() => {
    setDetail(null);
    load();
    fetch("/api/zone/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: ApiResponse<ZoneProduct[]>) => {
        if (res.success && res.data) setProducts(res.data);
      })
      .catch(() => {});
  }, [clientId, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Salva il lead nel Registro dai dati dello scan (upsert). */
  const saveToRegistry = useCallback(async (): Promise<boolean> => {
    if (!previewLead) return false;
    const res = await fetch("/api/zone/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: previewLead.id,
        name: previewLead.name,
        category: previewLead.category,
        address: previewLead.address,
        phone: previewLead.phone,
        lat: previewLead.lat,
        lng: previewLead.lng,
        maps_url: previewLead.maps_url,
        nfc_review_url: previewLead.nfc_review_url ?? "",
        rating: previewLead.rating,
        reviews: previewLead.reviews,
      }),
    });
    const json = (await res.json()) as ApiResponse<unknown>;
    if (json.success) setInRegistry(true);
    return json.success;
  }, [previewLead]);

  async function api(
    url: string,
    method: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(true);
    try {
      // Scheda aperta da scan, lead non ancora salvato: la prima
      // azione concreta lo mette in Registro da sola.
      if (!inRegistry) {
        const saved = await saveToRegistry();
        if (!saved) {
          flash("Errore: salvataggio nel Registro fallito, riprova.");
          return false;
        }
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) {
        flash(`Errore: ${json.error ?? "operazione fallita"}`);
        return false;
      }
      await load();
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const patchClient = (fields: Record<string, unknown>) =>
    api("/api/zone/clients", "PATCH", { id: clientId, ...fields });

  const setStatus = (status: ZoneClientStatus) =>
    api("/api/zone/clients", "PATCH", {
      id: clientId,
      status,
      // il richiamo ha senso solo nel suo stato: altrove si azzera
      callback_at: status === "da_richiamare" ? callback || null : null,
    });

  const saveInfo = () =>
    api("/api/zone/clients", "PATCH", {
      id: clientId,
      referent,
      notes,
      zone_label: zoneLabel,
      callback_at: callback || null,
    }).then((ok) => ok && flash("Scheda salvata."));

  const refreshData = () => api("/api/zone/refresh", "POST", { id: clientId });

  async function loanStart() {
    if (!loanProduct) return flash("Scegli il prodotto lasciato in comodato.");
    const days = Math.min(365, Math.max(1, Math.round(Number(loanDays)) || 15));
    const ok = await api("/api/zone/loan", "POST", {
      client_id: clientId,
      action: "start",
      product_id: loanProduct,
      days,
      card_codes: loanCards.split(/[,\s]+/).filter(Boolean),
    });
    if (ok) {
      setLoanOpen(false);
      setLoanCards("");
      flash(`Comodato attivo: rivisita tra ${days} giorni (nel morning brief).`);
    }
  }

  const loanEnd = async (outcome: "ritirato" | "convertito") => {
    const ok = await api("/api/zone/loan", "POST", { client_id: clientId, action: outcome });
    if (ok) {
      flash(
        outcome === "ritirato"
          ? "Comodato ritirato: pezzo rientrato in giacenza."
          : "Convertito! Registra ora la vendita qui sotto.",
      );
    }
  };

  async function copyNfc() {
    if (!detail?.nfc_review_url) return;
    await navigator.clipboard.writeText(detail.nfc_review_url);
    flash("Link NFC copiato: incollalo su NFC Tools.");
  }

  async function addSale() {
    const product = products.find((p) => p.id === saleProduct);
    if (!product) return flash("Scegli un prodotto.");
    const price = Number(salePrice.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) return flash("Prezzo non valido.");
    const ok = await api("/api/zone/sales", "POST", {
      client_id: clientId,
      product_id: product.id,
      product_name: product.name,
      qty: saleQty,
      price,
      notes: saleNotes,
      card_codes: saleCards.split(/[,\s]+/).filter(Boolean),
    });
    if (ok) {
      setSaleQty(1);
      setSalePrice("");
      setSaleCards("");
      setSaleNotes("");
      flash("Vendita registrata ✓");
    }
  }

  const assignCard = async () => {
    if (!newCard.trim()) return;
    if (await api("/api/zone/cards", "POST", { code: newCard.trim(), client_id: clientId })) {
      setNewCard("");
      flash("Card assegnata.");
    }
  };

  const doReplace = async (oldCode: string) => {
    if (!replaceWith.trim()) return;
    if (
      await api("/api/zone/cards", "PATCH", {
        old_code: oldCode,
        new_code: replaceWith.trim(),
      })
    ) {
      setReplacing(null);
      setReplaceWith("");
      flash("Card sostituita, storia conservata.");
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold text-text">
              {detail?.name ?? "…"}
            </h2>
            {detail && (
              <p className="font-ui text-[11px] text-text2">
                {detail.category && `${detail.category} · `}★{detail.rating} (
                {detail.reviews}) {detail.cap && `· ${detail.cap}`}
                {detail.zone_label && ` · ${detail.zone_label}`}
              </p>
            )}
            {detail?.address && (
              <p className="mt-0.5 truncate font-ui text-[11px] text-text2">{detail.address}</p>
            )}
            <div className="mt-1.5 flex items-center gap-3 font-ui text-[11px]">
              {detail?.phone && (
                <a
                  href={`tel:${detail.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <Phone className="h-3 w-3" /> {detail.phone}
                </a>
              )}
              {detail?.maps_url && (
                <a
                  href={detail.maps_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-text2 hover:text-text hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Maps
                </a>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="rounded-sm border border-border p-1.5 text-text2 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {toast && (
          <p className="px-5 pb-2 font-ui text-xs text-accent" role="status">
            {toast}
          </p>
        )}

        {!inRegistry && (
          <div className="mx-5 mb-2 flex items-center justify-between gap-2 rounded-sm border border-ochre/40 bg-ochre/10 px-3 py-2">
            <p className="font-ui text-[11px] text-ochre">
              Non ancora nel Registro: si salva col bottone o alla prima azione.
            </p>
            <NeonButton
              size="sm"
              variant="amber"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await saveToRegistry();
                setBusy(false);
                if (ok) {
                  await load();
                  onChanged();
                  flash("Salvato nel Registro.");
                }
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Salva nel Registro
            </NeonButton>
          </div>
        )}

        {/* LINK NFC — il gesto principale in negozio */}
        <Section title="Link recensioni per NFC (un tap → form recensione)">
          {detail?.nfc_review_url ? (
            <div className="space-y-2">
              <p className="break-all rounded-sm border border-border bg-surface2 px-2 py-1.5 font-mono text-[11px] text-text">
                {detail.nfc_review_url}
              </p>
              <NeonButton size="sm" variant="green" onClick={copyNfc} disabled={busy}>
                <Nfc className="h-3.5 w-3.5" /> Copia per NFC
              </NeonButton>
            </div>
          ) : (
            <p className="font-ui text-xs text-danger">
              Link mancante per questa attività: riapri la scheda (la
              migrazione lo rigenera dal place_id) o segnalalo.
            </p>
          )}
        </Section>

        {/* effetto card: delta recensioni dalla prima vendita */}
        {detail && (
          <Section title="Effetto card (argomento upsell)">
            {detail.reviews_at_sale != null ? (
              <div className="space-y-1.5">
                <p className="font-ui text-sm font-bold text-success">
                  <TrendingUp className="mr-1 inline h-4 w-4" />
                  {detail.reviews - detail.reviews_at_sale >= 0 ? "+" : ""}
                  {detail.reviews - detail.reviews_at_sale} recensioni dalla vendita{" "}
                  <span className="font-ui text-xs font-normal text-text2">
                    ({detail.reviews_at_sale} → {detail.reviews})
                  </span>
                </p>
                <p className="font-ui text-[11px] text-text2">
                  {detail.sales.length > 0 &&
                    `prima vendita ${detail.sales[detail.sales.length - 1].sold_at.slice(0, 10)} · `}
                  conteggio aggiornato{" "}
                  {detail.reviews_updated_at
                    ? detail.reviews_updated_at.slice(0, 10)
                    : "mai"}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="font-ui text-xs text-text2">
                  Ancora nessuna baseline: si salva da sola alla prima vendita,
                  oppure fissala a oggi (per chi ha già la card da prima).
                </p>
                <NeonButton
                  size="sm"
                  variant="cyan"
                  disabled={busy}
                  onClick={() =>
                    patchClient({ set_baseline: true }).then(
                      (ok) => ok && flash(`Baseline fissata: ${detail.reviews} recensioni.`),
                    )
                  }
                >
                  <TrendingUp className="h-3.5 w-3.5" /> Imposta baseline a oggi (
                  {detail.reviews} rec)
                </NeonButton>
              </div>
            )}
            <div className="mt-2">
              <NeonButton size="sm" onClick={refreshData} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" /> Aggiorna dati da Google
              </NeonButton>
            </div>
            {detail.snapshots.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-surface2 pt-2">
                {detail.snapshots.map((sn) => (
                  <li key={sn.id} className="font-ui text-[11px] text-text2">
                    {sn.taken_at.slice(0, 10)} · <b className="text-text">{sn.reviews}</b> rec
                    {sn.rating > 0 && ` · ★${sn.rating}`}{" "}
                    <span className="opacity-60">({sn.source})</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* comodato */}
        {detail && (
          <Section title="Comodato (targhetta in prova)">
            {detail.loan_status === "attivo" ? (
              <div className="space-y-2">
                <p className="font-ui text-xs">
                  <span
                    className={cn(
                      "mr-2 rounded-full border px-2 py-0.5 font-semibold",
                      detail.loan_due_at &&
                        detail.loan_due_at.slice(0, 10) <=
                          new Date().toISOString().slice(0, 10)
                        ? "border-danger/50 bg-danger/15 text-danger"
                        : "border-ochre/40 bg-ochre/15 text-ochre",
                    )}
                  >
                    🏷 In comodato
                  </span>
                  <span className="text-text2">
                    dal {detail.loan_started_at?.slice(0, 10) ?? "?"} · rivisita{" "}
                    {detail.loan_due_at?.slice(0, 10) ?? "?"}
                  </span>
                </p>
                {detail.reviews_at_loan != null && (
                  <p className="font-ui text-xs font-semibold text-success">
                    <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
                    {detail.reviews - detail.reviews_at_loan >= 0 ? "+" : ""}
                    {detail.reviews - detail.reviews_at_loan} recensioni dal comodato (
                    {detail.reviews_at_loan} → {detail.reviews})
                  </p>
                )}
                <div className="flex gap-2">
                  <NeonButton size="sm" variant="green" disabled={busy} onClick={() => loanEnd("convertito")}>
                    <Check className="h-3.5 w-3.5" /> Convertito in vendita
                  </NeonButton>
                  <NeonButton size="sm" disabled={busy} onClick={() => loanEnd("ritirato")}>
                    Ritirato
                  </NeonButton>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {detail.loan_status !== "nessuno" && (
                  <p className="font-ui text-[11px] text-text2">
                    Ultimo comodato: {detail.loan_status}
                    {detail.reviews_at_loan != null &&
                      ` · resa ${detail.reviews - detail.reviews_at_loan >= 0 ? "+" : ""}${detail.reviews - detail.reviews_at_loan} recensioni`}
                  </p>
                )}
                {!loanOpen ? (
                  <NeonButton size="sm" variant="cyan" disabled={busy} onClick={() => setLoanOpen(true)}>
                    <Handshake className="h-3.5 w-3.5" /> Metti in comodato
                  </NeonButton>
                ) : (
                  <div className="space-y-2 rounded-sm border border-border p-2.5">
                    <select
                      value={loanProduct}
                      onChange={(e) => setLoanProduct(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Cosa lasci in prova…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 font-ui text-[11px] text-text2">
                      Rivisita tra
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={loanDays}
                        onChange={(e) => setLoanDays(e.target.value)}
                        className="w-16 rounded-sm border border-border bg-surface px-1.5 py-1 text-text focus:border-accent focus:outline-none"
                      />
                      giorni
                    </label>
                    <input
                      placeholder="Codici card lasciate (opzionale, separati da virgola)"
                      value={loanCards}
                      onChange={(e) => setLoanCards(e.target.value)}
                      className={inputCls}
                    />
                    <div className="flex gap-2">
                      <NeonButton size="sm" variant="cyan" disabled={busy} onClick={loanStart}>
                        <Handshake className="h-3.5 w-3.5" /> Avvia comodato
                      </NeonButton>
                      <NeonButton size="sm" disabled={busy} onClick={() => setLoanOpen(false)}>
                        Annulla
                      </NeonButton>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* stato */}
        <Section title="Stato">
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
                  detail?.status === s
                    ? STATUS_CHIP[s]
                    : "border-border text-text2 hover:text-text",
                )}
              >
                {detail?.status === s && <Check className="mr-1 inline h-3 w-3" />}
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {detail?.status === "da_richiamare" && (
            <label className="mt-2 block font-ui text-[11px] text-text2">
              Quando richiamare
              <input
                type="date"
                value={callback}
                onChange={(e) => setCallback(e.target.value)}
                onBlur={() =>
                  api("/api/zone/clients", "PATCH", {
                    id: clientId,
                    callback_at: callback || null,
                  })
                }
                className={cn(inputCls, "mt-1")}
              />
            </label>
          )}
        </Section>

        {/* vendite */}
        <Section title={`Vendite (${detail?.sales.length ?? 0})`}>
          <ul className="mb-3 space-y-1.5">
            {(detail?.sales ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-2 font-ui text-xs"
              >
                <span className="text-text">
                  {s.product_name}
                  {s.qty > 1 && ` ×${s.qty}`}
                  {s.notes && <span className="text-text2"> · {s.notes}</span>}
                </span>
                <span className="shrink-0 text-text2">
                  <b className="text-success">€{s.price}</b> · {s.sold_at.slice(0, 10)}
                </span>
              </li>
            ))}
            {detail?.sales.length === 0 && (
              <li className="font-ui text-xs text-text2">Nessuna vendita ancora.</li>
            )}
          </ul>
          <div className="space-y-2 rounded-sm border border-border p-2.5">
            <div className="flex gap-2">
              <select
                value={saleProduct}
                onChange={(e) => {
                  setSaleProduct(e.target.value);
                  const p = products.find((x) => x.id === e.target.value);
                  if (p && p.default_price > 0) setSalePrice(String(p.default_price));
                }}
                className={cn(inputCls, "flex-1")}
              >
                <option value="">Prodotto…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.default_price > 0 ? ` (€${p.default_price})` : ""}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={saleQty}
                onChange={(e) => setSaleQty(Math.max(1, Number(e.target.value)))}
                className={cn(inputCls, "w-16")}
                title="Quantità"
              />
              <input
                inputMode="decimal"
                placeholder="€ tot"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className={cn(inputCls, "w-20")}
                title="Incasso totale"
              />
            </div>
            <input
              placeholder="Codici card (separati da virgola) — opzionale"
              value={saleCards}
              onChange={(e) => setSaleCards(e.target.value)}
              className={inputCls}
            />
            <input
              placeholder="Note vendita — opzionale"
              value={saleNotes}
              onChange={(e) => setSaleNotes(e.target.value)}
              className={inputCls}
            />
            <NeonButton size="sm" variant="amber" onClick={addSale} disabled={busy}>
              <Plus className="h-3.5 w-3.5" /> Registra vendita
            </NeonButton>
          </div>
        </Section>

        {/* card */}
        <Section title={`Card assegnate (${detail?.cards.length ?? 0})`}>
          <ul className="mb-3 space-y-1.5">
            {(detail?.cards ?? []).map((c) => (
              <li key={c.code} className="font-ui text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "font-mono",
                      c.status === "attiva" ? "text-text" : "text-text2 line-through",
                    )}
                  >
                    {c.code}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        c.status === "attiva"
                          ? "border-success/40 text-success"
                          : "border-border text-text2",
                      )}
                    >
                      {c.status}
                    </span>
                    {c.status === "attiva" && (
                      <button
                        type="button"
                        title="Sostituisci card"
                        onClick={() => {
                          setReplacing(replacing === c.code ? null : c.code);
                          setReplaceWith("");
                        }}
                        className="text-text2 hover:text-text"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                {replacing === c.code && (
                  <div className="mt-1.5 flex gap-2">
                    <input
                      placeholder="Nuovo codice"
                      value={replaceWith}
                      onChange={(e) => setReplaceWith(e.target.value)}
                      className={cn(inputCls, "flex-1")}
                    />
                    <NeonButton size="sm" onClick={() => doReplace(c.code)} disabled={busy}>
                      Sostituisci
                    </NeonButton>
                  </div>
                )}
              </li>
            ))}
            {detail?.cards.length === 0 && (
              <li className="font-ui text-xs text-text2">Nessuna card assegnata.</li>
            )}
          </ul>
          <div className="flex gap-2">
            <input
              placeholder="Codice card da assegnare"
              value={newCard}
              onChange={(e) => setNewCard(e.target.value)}
              className={cn(inputCls, "flex-1")}
            />
            <NeonButton size="sm" onClick={assignCard} disabled={busy || !newCard.trim()}>
              <Plus className="h-3.5 w-3.5" /> Assegna
            </NeonButton>
          </div>
        </Section>

        {/* fattura e dati fiscali */}
        {detail && (
          <ZoneBillingSection
            detail={detail}
            busy={busy}
            patch={patchClient}
            flash={flash}
          />
        )}

        {/* scheda */}
        <Section title="Scheda">
          <div className="space-y-2">
            <input
              placeholder="Referente (es. Anna, la titolare)"
              value={referent}
              onChange={(e) => setReferent(e.target.value)}
              className={inputCls}
            />
            <input
              placeholder="Etichetta giro (es. Poggiofranco)"
              value={zoneLabel}
              onChange={(e) => setZoneLabel(e.target.value)}
              className={inputCls}
            />
            <textarea
              placeholder="Note (accordi, quando ripassare, problemi…)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
            />
            <NeonButton size="sm" onClick={saveInfo} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> Salva scheda
            </NeonButton>
          </div>
        </Section>
      </aside>
    </div>,
    document.body,
  );
}
