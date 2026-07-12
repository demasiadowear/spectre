"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Nfc, Plus, Search, TrendingUp, UserPlus } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import ZoneClientSheet, {
  STATUS_CHIP,
  STATUS_LABEL,
} from "@/components/zone/ZoneClientSheet";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  ZoneCard,
  ZoneClient,
  ZoneClientStatus,
  ZoneLead,
} from "@/types/zone";

// ============================================================
// REGISTRO — il CRM del giro card NFC. Lista clienti filtrabile,
// ricerca per codice card (sostituzioni), aggiunta manuale via
// ricerca Google, scheda cliente in drawer.
// ============================================================

const FILTER_STATUSES: (ZoneClientStatus | "tutti")[] = [
  "tutti",
  "da_richiamare",
  "da_visitare",
  "visitato",
  "venduto",
  "non_interessato",
];

const inputCls =
  "rounded-sm border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text placeholder:text-text2/60 focus:border-accent focus:outline-none";

export default function ZoneRegistry() {
  const [clients, setClients] = useState<ZoneClient[]>([]);
  const [statusFilter, setStatusFilter] = useState<ZoneClientStatus | "tutti">("tutti");
  const [invoiceOnly, setInvoiceOnly] = useState(false);
  const [upsellOnly, setUpsellOnly] = useState(false);
  const [upsellMin, setUpsellMin] = useState(20);
  const [q, setQ] = useState("");
  const [cardCode, setCardCode] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // aggiunta manuale
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCity, setAddCity] = useState("Bari");
  const [addBusy, setAddBusy] = useState(false);
  const [candidates, setCandidates] = useState<ZoneLead[] | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "tutti") params.set("status", statusFilter);
    if (invoiceOnly) params.set("invoice", "richiesta");
    if (upsellOnly) params.set("upsell_min", String(upsellMin));
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await fetch(`/api/zone/clients?${params}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<ZoneClient[]>;
      if (json.success && json.data) setClients(json.data);
    } catch {
      /* rete: lo stato precedente resta visibile */
    }
  }, [statusFilter, q, invoiceOnly, upsellOnly, upsellMin]);

  useEffect(() => {
    const t = setTimeout(refresh, q ? 300 : 0); // debounce sulla ricerca
    return () => clearTimeout(t);
  }, [refresh, q]);

  async function lookupCard() {
    const code = cardCode.trim();
    if (!code) return;
    const res = await fetch(`/api/zone/cards?code=${encodeURIComponent(code)}`, {
      cache: "no-store",
    });
    const json = (await res.json()) as ApiResponse<{ card: ZoneCard; client: ZoneClient }>;
    if (json.success && json.data) {
      setOpenId(json.data.client.id);
      setCardCode("");
    } else {
      flash(json.error ?? "Card non trovata.");
    }
  }

  async function searchCandidates() {
    if (!addName.trim()) return;
    setAddBusy(true);
    setCandidates(null);
    try {
      const res = await fetch("/api/zone/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: addName.trim(), city: addCity.trim() }),
      });
      const json = (await res.json()) as ApiResponse<ZoneLead[]>;
      if (json.success && json.data) setCandidates(json.data);
      else flash(json.error ?? "Ricerca fallita.");
    } finally {
      setAddBusy(false);
    }
  }

  async function addCandidate(c: ZoneLead) {
    const res = await fetch("/api/zone/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: c.id,
        name: c.name,
        category: c.category,
        address: c.address,
        phone: c.phone,
        lat: c.lat,
        lng: c.lng,
        maps_url: c.maps_url,
        nfc_review_url: c.nfc_review_url ?? "",
        rating: c.rating,
        reviews: c.reviews,
      }),
    });
    const json = (await res.json()) as ApiResponse<ZoneClient>;
    if (json.success && json.data) {
      setAddOpen(false);
      setAddName("");
      setCandidates(null);
      await refresh();
      setOpenId(json.data.id);
    } else {
      flash(json.error ?? "Aggiunta fallita.");
    }
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of clients) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [clients]);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <GlassCard className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
                statusFilter === s
                  ? s === "tutti"
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : STATUS_CHIP[s]
                  : "border-border text-text2 hover:text-text",
              )}
            >
              {s === "tutti" ? `Tutti (${clients.length})` : STATUS_LABEL[s]}
              {s !== "tutti" && counts.get(s) ? ` (${counts.get(s)})` : ""}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setInvoiceOnly((v) => !v)}
            className={cn(
              "rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
              invoiceOnly
                ? "border-danger/50 bg-danger/15 text-danger"
                : "border-border text-text2 hover:text-text",
            )}
            title="Solo clienti con fattura da emettere"
          >
            📄 Richiesta fattura
          </button>
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setUpsellOnly((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
                upsellOnly
                  ? "border-success/50 bg-success/15 text-success"
                  : "border-border text-text2 hover:text-text",
              )}
              title="Clienti venduti con più recensioni guadagnate dalla vendita: da loro torni a vendere"
            >
              <TrendingUp className="h-3 w-3" /> Candidati upsell
            </button>
            {upsellOnly && (
              <label className="flex items-center gap-1 font-ui text-[10px] text-text2">
                ≥
                <input
                  type="number"
                  min={1}
                  value={upsellMin}
                  onChange={(e) => setUpsellMin(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 rounded-sm border border-border bg-surface px-1.5 py-0.5 font-ui text-[11px] text-text focus:border-accent focus:outline-none"
                  title="Soglia minima di recensioni guadagnate"
                />
              </label>
            )}
          </span>
          <a
            href="/api/zone/export?what=clients"
            className="ml-auto inline-flex items-center gap-1 font-ui text-[11px] text-text2 hover:text-text"
            title="Scarica registro CSV"
          >
            <Download className="h-3.5 w-3.5" /> CSV clienti
          </a>
          <a
            href="/api/zone/export?what=sales"
            className="inline-flex items-center gap-1 font-ui text-[11px] text-text2 hover:text-text"
            title="Scarica vendite CSV"
          >
            <Download className="h-3.5 w-3.5" /> CSV vendite
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text2" />
            <input
              placeholder="Cerca nome, indirizzo, referente, note…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={cn(inputCls, "w-full pl-7")}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Nfc className="h-3.5 w-3.5 text-text2" />
            <input
              placeholder="Codice card…"
              value={cardCode}
              onChange={(e) => setCardCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookupCard()}
              className={cn(inputCls, "w-32")}
              title="Ricerca inversa: da codice card al cliente"
            />
          </div>
          <NeonButton size="sm" onClick={() => setAddOpen((v) => !v)}>
            <UserPlus className="h-3.5 w-3.5" /> Aggiungi cliente
          </NeonButton>
        </div>
      </GlassCard>

      {toast && (
        <p className="font-ui text-xs text-accent" role="status">
          {toast}
        </p>
      )}

      {/* aggiunta manuale */}
      {addOpen && (
        <GlassCard className="space-y-2 px-4 py-3">
          <p className="font-ui text-[11px] text-text2">
            Cerca l&apos;attività su Google e aggiungila al registro (per chi ti
            contatta senza essere passato da uno scan).
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Nome attività (es. Bonega)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCandidates()}
              className={cn(inputCls, "flex-1")}
            />
            <input
              placeholder="Città"
              value={addCity}
              onChange={(e) => setAddCity(e.target.value)}
              className={cn(inputCls, "w-28")}
            />
            <NeonButton size="sm" onClick={searchCandidates} disabled={addBusy || !addName.trim()}>
              <Search className="h-3.5 w-3.5" /> {addBusy ? "Cerco…" : "Cerca"}
            </NeonButton>
          </div>
          {candidates && (
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 font-ui text-xs">
                    <span className="font-semibold text-text">{c.name}</span>{" "}
                    <span className="text-text2">
                      ★{c.rating} ({c.reviews}) · {c.address}
                    </span>
                    {!c.nfc_review_url && (
                      <span className="ml-1 text-danger">· link NFC non ricavabile</span>
                    )}
                  </div>
                  <NeonButton size="sm" variant="green" onClick={() => addCandidate(c)}>
                    <Plus className="h-3.5 w-3.5" /> Aggiungi
                  </NeonButton>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="font-ui text-xs text-text2">Nessun risultato.</li>
              )}
            </ul>
          )}
        </GlassCard>
      )}

      {/* lista clienti */}
      <GlassCard className="p-0">
        <ul className="divide-y divide-surface2">
          {clients.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface2"
              >
                <div className="min-w-0">
                  <p className="truncate font-ui text-sm font-semibold text-text">
                    {c.name}
                    {!c.nfc_review_url && (
                      <span
                        className="ml-1.5 align-middle font-ui text-[10px] text-danger"
                        title="Link NFC non ricavabile"
                      >
                        ⚠ NFC
                      </span>
                    )}
                  </p>
                  <p className="truncate font-ui text-[11px] text-text2">
                    {c.category && `${c.category} · `}
                    {c.zone_label || c.cap || "—"}
                    {c.referent && ` · ${c.referent}`}
                    {c.status === "da_richiamare" && c.callback_at && (
                      <span className="text-accent">
                        {" "}
                        · richiama {c.callback_at.slice(0, 10)}
                      </span>
                    )}
                    {c.reviews_at_sale != null && (
                      <span
                        className={cn(
                          c.reviews - c.reviews_at_sale > 0
                            ? "font-semibold text-success"
                            : "text-text2",
                        )}
                      >
                        {" "}
                        · 📈 {c.reviews - c.reviews_at_sale >= 0 ? "+" : ""}
                        {c.reviews - c.reviews_at_sale} rec ({c.reviews_at_sale}→{c.reviews})
                      </span>
                    )}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.invoice_status === "richiesta" && (
                    <span className="animate-pulse rounded-full border border-danger/50 bg-danger/15 px-2 py-0.5 font-ui text-[10px] font-bold text-danger">
                      📄 FATTURA
                    </span>
                  )}
                  {c.invoice_status === "fatturata" && (
                    <span className="rounded-full border border-success/40 px-2 py-0.5 font-ui text-[10px] text-success">
                      Fatturata
                    </span>
                  )}
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-ui text-[10px] font-semibold",
                      STATUS_CHIP[c.status],
                    )}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {clients.length === 0 && (
            <li className="px-4 py-6 text-center font-ui text-xs text-text2">
              Registro vuoto: salva un&apos;attività dalla Caccia o aggiungila a mano.
            </li>
          )}
        </ul>
      </GlassCard>

      {openId && (
        <ZoneClientSheet
          clientId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
