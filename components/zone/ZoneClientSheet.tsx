"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  ExternalLink,
  Handshake,
  MessageCircle,
  Nfc,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import NeonButton from "@/components/ui/spectre/NeonButton";
import ZoneBillingSection from "@/components/zone/ZoneBillingSection";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  ZoneAgent,
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

/** Euro con decimali solo se servono: €90, €15,34. */
const eur = (n: number): string =>
  `€${n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Numero pronto per wa.me: solo cifre, con prefisso internazionale.
 *  Un cellulare IT nazionale sono 10 cifre che iniziano per 3 (anche
 *  "39x…", quindi va gestito PRIMA del prefisso paese 39): prende il
 *  39. I numeri già col prefisso (39…, 00…, altri paesi) restano. */
function waDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) return `39${d}`; // cellulare IT nazionale
  if (d.startsWith("39")) return d; // già col prefisso paese
  if (d.startsWith("3") || d.startsWith("0")) return `39${d}`; // altro numero IT nazionale
  return d; // altro paese, già col suo prefisso
}

/** Data italiana GG/MM/AAAA da un timestamp ISO/SQL. */
function itDate(iso: string): string {
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

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
    whatsapp: l.phone,
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
    rating_at_sale: null,
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
  // report recensioni WhatsApp
  const [waNumber, setWaNumber] = useState("");
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  // form vendita multi-riga: prodotto × qty × prezzo manuale + omaggio
  type SaleRow = { product_id: string; qty: string; price: string; omaggio: boolean; priceEdited: boolean };
  const emptyRow = (): SaleRow => ({ product_id: "", qty: "1", price: "", omaggio: false, priceEdited: false });
  const [saleRows, setSaleRows] = useState<SaleRow[]>([emptyRow()]);
  const [saleCards, setSaleCards] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [saleAgent, setSaleAgent] = useState("");
  const [agents, setAgents] = useState<ZoneAgent[]>([]);
  // form comodato
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanProduct, setLoanProduct] = useState("");
  const [loanCards, setLoanCards] = useState("");
  const [loanDays, setLoanDays] = useState("15");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      // WhatsApp: usa il numero dedicato o, se vuoto, precompila dal
      // telefono Maps (lo confermo/aggiusto e si salva alla prima azione).
      setWaNumber(json.data.whatsapp || json.data.phone || "");
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
    // Agenti attivi per il select vendita (i disattivati non compaiono).
    fetch("/api/zone/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: ApiResponse<ZoneAgent[]>) => {
        if (res.success && res.data) setAgents(res.data);
      })
      .catch(() => {});
  }, [clientId, load]);

  // Nel form vendita solo i prodotti FISICI (la quantità sostituisce
  // i pacchetti fissi): card, forex, plexi.
  const PHYSICAL = ["prod-card", "prod-targhetta", "prod-plexi"];
  const saleProducts = products.filter((p) => PHYSICAL.includes(p.id));

  // Righe vendita raggruppate per group_id (le vendite vecchie a riga
  // singola hanno group_id vuoto: ognuna resta un gruppo a sé).
  const groupedSales = (() => {
    const order: string[] = [];
    const map = new Map<string, ZoneClientDetail["sales"]>();
    for (const row of detail?.sales ?? []) {
      const key = row.group_id || row.id;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(row);
    }
    return order.map((key) => {
      const rows = map.get(key)!;
      const total = rows.reduce((sum, r) => sum + (r.omaggio ? 0 : r.price), 0);
      // Costo = costo unitario storicizzato × qty (anche gli omaggi
      // pesano). Utile = ricavo − costo del gruppo.
      const cost = rows.reduce((sum, r) => sum + r.unit_cost * r.qty, 0);
      return {
        key,
        rows,
        sold_at: rows[0].sold_at,
        notes: rows.find((r) => r.notes)?.notes ?? "",
        total,
        cost,
        profit: total - cost,
      };
    });
  })();

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

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/zone/clients?id=${encodeURIComponent(clientId)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) {
        flash(`Errore: ${json.error ?? "eliminazione fallita"}`);
        return;
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

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

  // Report recensioni WhatsApp: aggiorna i dati Google, calcola il
  // delta dalla PRIMA vendita e genera il messaggio precompilato (poi
  // editabile). Se il delta è <= 0 avvisa prima di generare.
  async function buildWaReport() {
    if (!detail) return;
    if (!waDigits(waNumber)) {
      flash("Inserisci il numero WhatsApp del cliente.");
      return;
    }
    if (detail.reviews_at_sale == null) {
      flash("Nessuna baseline: registra la prima vendita o imposta la baseline a oggi.");
      return;
    }
    if (detail.sales.length === 0) {
      flash("Nessuna vendita registrata: non c'è una data d'acquisto per il report.");
      return;
    }
    setWaBusy(true);
    try {
      // Refresh dati Google del singolo cliente (recensioni + rating).
      const res = await fetch("/api/zone/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: clientId }),
      });
      const json = (await res.json()) as ApiResponse<{ reviews: number; rating: number }>;
      if (!json.success || !json.data) {
        flash(`Refresh Google fallito: ${json.error ?? "riprova"}`);
        return;
      }
      const baseline = detail.reviews_at_sale;
      const current = json.data.reviews;
      const rating = json.data.rating;
      const delta = current - baseline;
      // Data della PRIMA vendita (le vendite arrivano ordinate desc).
      const firstSale = detail.sales[detail.sales.length - 1].sold_at;

      if (delta <= 0) {
        const ok = window.confirm(
          `Attenzione: il delta recensioni è ${delta} (da ${baseline} a ${current}). ` +
            `Nessuna crescita da mostrare. Vuoi generare comunque il messaggio?`,
        );
        if (!ok) return;
      }

      const ratingTxt = rating > 0 ? rating.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "n/d";
      const sign = delta >= 0 ? "+" : "";
      const msg =
        `Ciao ${detail.name}! Da AYROMEX, il report delle tue recensioni Google ` +
        `da quando usi le nostre card: sei passato da ${baseline} a ${current} recensioni ` +
        `(${sign}${delta}) dal ${itDate(firstSale)}. Valutazione media: ${ratingTxt}★. Continua così!`;
      setWaMsg(msg);

      // Salva il numero WhatsApp se cambiato + ricarica i dati freschi.
      if (waNumber.trim() && waNumber.trim() !== (detail.whatsapp || "")) {
        await patchClient({ whatsapp: waNumber.trim() });
      } else {
        await load();
      }
    } catch {
      flash("Errore di rete durante il report.");
    } finally {
      setWaBusy(false);
    }
  }

  function openWa() {
    if (!waMsg) return;
    const url = `https://wa.me/${waDigits(waNumber)}?text=${encodeURIComponent(waMsg)}`;
    window.open(url, "_blank", "noopener");
  }

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

  // Prezzo suggerito = prezzo di listino UNITARIO × quantità: un
  // TOTALE coerente (non il prezzo di 1 pezzo). Resta modificabile e
  // si ferma di aggiornarsi appena l'utente scrive il totale a mano.
  const suggestPrice = (productId: string, qty: string): string => {
    const prod = saleProducts.find((x) => x.id === productId);
    const q = Math.max(1, Math.round(Number(qty) || 1));
    return prod && prod.default_price > 0 ? String(prod.default_price * q) : "";
  };
  const setRow = (i: number, patch: Partial<SaleRow>) =>
    setSaleRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Correzione di una riga già salvata (prezzo/quantità).
  const [editSaleId, setEditSaleId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [editQty, setEditQty] = useState("1");
  async function saveSaleEdit(rowId: string, omaggio: boolean) {
    const body: Record<string, unknown> = { id: rowId, qty: Math.max(1, Math.round(Number(editQty) || 1)) };
    if (!omaggio) {
      const price = Number(editPrice.replace(",", "."));
      if (!Number.isFinite(price) || price < 0) return flash("Prezzo non valido.");
      body.price = price;
    }
    if (await api("/api/zone/sales", "PATCH", body)) {
      setEditSaleId(null);
      flash("Vendita corretta ✓");
    }
  }
  async function deleteSaleRow(rowId: string) {
    if (await api(`/api/zone/sales?id=${encodeURIComponent(rowId)}`, "DELETE", {})) {
      setEditSaleId(null);
      flash("Riga vendita annullata.");
    }
  }
  const addRow = () => setSaleRows((rows) => [...rows, emptyRow()]);
  const removeRow = (i: number) =>
    setSaleRows((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : rows));

  // Totale live (gli omaggi pesano 0).
  const saleTotal = saleRows.reduce((sum, r) => {
    if (r.omaggio) return sum;
    const p = Number(r.price.replace(",", "."));
    return sum + (Number.isFinite(p) ? p : 0);
  }, 0);

  async function addSale() {
    const lines = saleRows
      .filter((r) => r.product_id)
      .map((r) => {
        const prod = products.find((p) => p.id === r.product_id);
        const qty = Math.max(1, Math.round(Number(r.qty) || 1));
        const price = r.omaggio ? 0 : Number(r.price.replace(",", "."));
        return { product_id: r.product_id, product_name: prod?.name ?? "", qty, price, omaggio: r.omaggio };
      });
    if (lines.length === 0) return flash("Aggiungi almeno un prodotto.");
    for (const l of lines) {
      if (!l.omaggio && (!Number.isFinite(l.price) || l.price < 0)) {
        return flash(`Prezzo non valido per "${l.product_name}".`);
      }
    }
    const ok = await api("/api/zone/sales", "POST", {
      client_id: clientId,
      lines,
      notes: saleNotes,
      card_codes: saleCards.split(/[,\s]+/).filter(Boolean),
      agent_id: saleAgent || undefined,
    });
    if (ok) {
      setSaleRows([emptyRow()]);
      setSaleCards("");
      setSaleNotes("");
      setSaleAgent("");
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
        className="flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl sm:max-w-md"
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
                {/* delta rating: solo se positivo (formato ★ +0,1 (4.3 → 4.4)) */}
                {(() => {
                  if (detail.rating_at_sale == null) return null;
                  const d = Math.round((detail.rating - detail.rating_at_sale) * 10) / 10;
                  if (d <= 0) return null;
                  return (
                    <p className="font-ui text-sm font-bold text-ochre">
                      ★ +{d.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{" "}
                      <span className="font-ui text-xs font-normal text-text2">
                        ({detail.rating_at_sale} → {detail.rating})
                      </span>
                    </p>
                  );
                })()}
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

            {/* Report recensioni via WhatsApp (aggancio upsell) */}
            <div className="mt-3 space-y-2 border-t border-surface2 pt-3">
              <label className="block font-ui text-[11px] text-text2">
                WhatsApp cliente
                <input
                  inputMode="tel"
                  placeholder="es. 391 234 5678"
                  value={waNumber}
                  onChange={(e) => setWaNumber(e.target.value)}
                  className={cn(inputCls, "mt-1")}
                />
              </label>
              <NeonButton size="sm" variant="green" onClick={buildWaReport} disabled={waBusy || busy}>
                <MessageCircle className="h-3.5 w-3.5" />
                {waBusy ? "Aggiorno da Google…" : "Invia report WhatsApp"}
              </NeonButton>
              {waMsg !== null && (
                <div className="space-y-2 rounded-sm border border-success/40 bg-success/5 p-2">
                  <p className="font-ui text-[10px] uppercase tracking-widest text-text2">
                    Messaggio (modificalo prima di inviare)
                  </p>
                  <textarea
                    value={waMsg}
                    onChange={(e) => setWaMsg(e.target.value)}
                    rows={5}
                    className={cn(inputCls, "text-xs leading-relaxed")}
                  />
                  <div className="flex items-center gap-2">
                    <NeonButton size="sm" variant="green" onClick={openWa} disabled={!waDigits(waNumber)}>
                      <MessageCircle className="h-3.5 w-3.5" /> Apri WhatsApp
                    </NeonButton>
                    <button
                      type="button"
                      onClick={() => setWaMsg(null)}
                      className="font-ui text-[11px] text-text2 hover:text-text"
                    >
                      chiudi
                    </button>
                  </div>
                  <p className="font-ui text-[10px] text-text2">
                    Si apre WhatsApp col testo già pronto: l&apos;invio lo premi tu.
                  </p>
                </div>
              )}
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
          <div className="mb-3 space-y-2">
            {groupedSales.map((g) => (
              <div key={g.key} className="rounded-sm border border-surface2 p-2">
                <div className="mb-1 flex items-center justify-between font-ui text-[10px] text-text2">
                  <span>{g.sold_at.slice(0, 10)}</span>
                  <span className="flex items-center gap-2">
                    <span>
                      Totale <b className="text-success">{eur(g.total)}</b>
                    </span>
                    <span>
                      costo <b className="text-danger">{eur(g.cost)}</b>
                    </span>
                    <span>
                      utile{" "}
                      <b className={g.profit >= 0 ? "text-accent" : "text-danger"}>{eur(g.profit)}</b>
                    </span>
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {g.rows.map((s) => (
                    <li key={s.id} className="font-ui text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text">
                          {s.product_name}
                          {s.qty > 1 && ` ×${s.qty}`}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-text2">
                          {s.omaggio ? (
                            <span className="rounded-full border border-ochre/50 bg-ochre/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ochre">
                              Omaggio
                            </span>
                          ) : (
                            <b className="text-success">{eur(s.price)}</b>
                          )}
                          <button
                            type="button"
                            title="Correggi"
                            onClick={() => {
                              setEditSaleId(editSaleId === s.id ? null : s.id);
                              setEditPrice(String(s.price));
                              setEditQty(String(s.qty));
                            }}
                            className="text-text2 hover:text-text"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </span>
                      </div>
                      {/* costo storicizzato + margine reale della riga */}
                      {(() => {
                        const rowCost = s.unit_cost * s.qty;
                        const rowMargin = (s.omaggio ? 0 : s.price) - rowCost;
                        const rowRev = s.omaggio ? 0 : s.price;
                        const marginPct = rowRev > 0 ? Math.round((rowMargin / rowRev) * 100) : null;
                        return (
                          <div className="mt-0.5 flex flex-wrap gap-x-2 font-ui text-[10px] text-text2">
                            <span>costo {eur(rowCost)}</span>
                            <span>
                              margine{" "}
                              <b className={rowMargin >= 0 ? "text-accent" : "text-danger"}>
                                {eur(rowMargin)}
                              </b>
                              {marginPct !== null && ` (${marginPct}%)`}
                            </span>
                          </div>
                        );
                      })()}
                      {editSaleId === s.id && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-sm border border-accent/40 bg-accent/5 p-2">
                          <label className="flex items-center gap-1 text-[11px] text-text2">
                            qty
                            <input
                              type="number"
                              min={1}
                              value={editQty}
                              onChange={(e) => setEditQty(e.target.value)}
                              className={cn(inputCls, "min-h-[40px] w-14 text-sm")}
                            />
                          </label>
                          {!s.omaggio && (
                            <label className="flex flex-1 items-center gap-1 text-[11px] text-text2">
                              € tot
                              <input
                                inputMode="decimal"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                className={cn(inputCls, "min-h-[40px] flex-1 text-sm")}
                              />
                            </label>
                          )}
                          <NeonButton size="sm" onClick={() => saveSaleEdit(s.id, s.omaggio)} disabled={busy}>
                            Salva
                          </NeonButton>
                          <button
                            type="button"
                            onClick={() => deleteSaleRow(s.id)}
                            disabled={busy}
                            className="min-h-[40px] rounded-sm border border-danger/40 px-2 text-[11px] font-semibold text-danger hover:bg-danger/10"
                          >
                            Annulla riga
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {g.notes && (
                  <p className="mt-1 font-ui text-[10px] text-text2">{g.notes}</p>
                )}
              </div>
            ))}
            {detail?.sales.length === 0 && (
              <p className="font-ui text-xs text-text2">Nessuna vendita ancora.</p>
            )}
          </div>
          <div className="space-y-2 rounded-sm border border-border p-2.5">
            {saleRows.map((row, i) => (
              <div key={i} className="space-y-1.5 rounded-sm bg-surface2/40 p-2">
                <div className="flex gap-2">
                  <select
                    value={row.product_id}
                    onChange={(e) => {
                      setRow(i, {
                        product_id: e.target.value,
                        // prefill = totale suggerito (unità × qty), finché
                        // non scrivi tu il totale (priceEdited).
                        price:
                          !row.omaggio && !row.priceEdited
                            ? suggestPrice(e.target.value, row.qty)
                            : row.price,
                      });
                    }}
                    className={cn(inputCls, "min-h-[44px] flex-1 text-sm")}
                  >
                    <option value="">Prodotto…</option>
                    {saleProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {saleRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="min-h-[44px] rounded-sm border border-border px-2 text-text2 hover:text-danger"
                      title="Togli riga"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) =>
                      setRow(i, {
                        qty: e.target.value,
                        price:
                          !row.omaggio && !row.priceEdited
                            ? suggestPrice(row.product_id, e.target.value)
                            : row.price,
                      })
                    }
                    className={cn(inputCls, "min-h-[44px] w-16 text-sm")}
                    title="Quantità"
                  />
                  <input
                    inputMode="decimal"
                    placeholder={row.omaggio ? "omaggio (€0)" : "€ totale riga"}
                    value={row.omaggio ? "" : row.price}
                    disabled={row.omaggio}
                    onChange={(e) => setRow(i, { price: e.target.value, priceEdited: true })}
                    className={cn(inputCls, "min-h-[44px] flex-1 text-sm disabled:opacity-40")}
                    title="Totale della riga — lo decidi tu, ha sempre priorità sul listino"
                  />
                  <label className="flex min-h-[44px] shrink-0 items-center gap-1 font-ui text-[11px] text-text2">
                    <input
                      type="checkbox"
                      checked={row.omaggio}
                      onChange={(e) => setRow(i, { omaggio: e.target.checked })}
                      className="h-4 w-4 accent-ochre"
                    />
                    omaggio
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-sm border border-border px-3 py-2 font-ui text-xs font-semibold text-text2 hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" /> Aggiungi prodotto
            </button>
            <input
              placeholder="Codici card (separati da virgola) — opzionale"
              value={saleCards}
              onChange={(e) => setSaleCards(e.target.value)}
              className={cn(inputCls, "min-h-[44px] text-sm")}
            />
            <input
              placeholder="Note vendita — opzionale"
              value={saleNotes}
              onChange={(e) => setSaleNotes(e.target.value)}
              className={cn(inputCls, "min-h-[44px] text-sm")}
            />
            {/* agente/segnalatore: opzionale, vuoto = vendita diretta */}
            <label className="block font-ui text-[11px] text-text2">
              Agente / segnalatore — opzionale
              <select
                value={saleAgent}
                onChange={(e) => setSaleAgent(e.target.value)}
                className={cn(inputCls, "mt-1 min-h-[44px] text-sm")}
              >
                <option value="">Vendita diretta (nessuna provvigione)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome} · {a.commission_pct}%
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between gap-2 font-ui text-xs">
              <span className="text-text2">
                Totale vendita: <b className="text-success">€{saleTotal.toLocaleString("it-IT")}</b>
              </span>
            </div>
            <NeonButton size="sm" variant="amber" onClick={addSale} disabled={busy} className="min-h-[44px] w-full justify-center">
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

        {/* elimina dal registro */}
        {inRegistry && detail && (
          <section className="border-t border-surface2 px-5 py-4">
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm border border-danger/40 px-3 py-2 font-ui text-xs font-semibold text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Elimina dal Registro
              </button>
            ) : (
              <div className="space-y-2 rounded-sm border border-danger/50 bg-danger/10 p-3">
                <p className="font-ui text-xs font-semibold text-danger">
                  Sicuro? Questa azione è irreversibile.
                </p>
                <p className="font-ui text-[11px] text-text2">
                  Elimini <b className="text-text">{detail.name}</b> e tutto il
                  collegato:
                  {detail.sales.length > 0 || detail.cards.length > 0 ? (
                    <>
                      {" "}
                      {detail.sales.length > 0 && (
                        <b className="text-text">{detail.sales.length} vendite</b>
                      )}
                      {detail.sales.length > 0 && detail.cards.length > 0 && " e "}
                      {detail.cards.length > 0 && (
                        <b className="text-text">
                          {detail.cards.length} card (i codici non saranno più
                          rintracciabili)
                        </b>
                      )}
                      .
                    </>
                  ) : (
                    " nessuna vendita o card associata."
                  )}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={doDelete}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-sm border border-danger bg-danger/20 px-3 py-2 font-ui text-xs font-bold text-danger hover:bg-danger/30"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Elimina definitivamente
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[44px] rounded-sm border border-border px-3 py-2 font-ui text-xs font-semibold text-text2 hover:text-text"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </aside>
    </div>,
    document.body,
  );
}
