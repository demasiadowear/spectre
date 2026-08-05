"use client";

import { useEffect, useState } from "react";
import { Copy, PackagePlus, Phone, RefreshCw } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { ZoneProduct, ZoneStats } from "@/types/zone";

// ============================================================
// ANALISI — i numeri dal registro: fatturato, conversione, zone
// che rendono, fatture in sospeso via Registro, da richiamare.
// Solo lettura: le azioni si fanno dal Registro.
// ============================================================

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <GlassCard className="min-w-0 px-4 py-3">
      <p className="font-ui text-[10px] uppercase tracking-widest text-text2">{label}</p>
      {/* nowrap + tabular-nums: l'importo resta su una riga e non viene
          troncato; se lo spazio è poco rimpicciolisce invece di tagliare. */}
      <p
        className={cn(
          "font-display text-xl font-bold tabular-nums text-text sm:text-2xl [overflow-wrap:anywhere]",
          accent,
        )}
      >
        {value}
      </p>
    </GlassCard>
  );
}

export default function ZoneAnalytics() {
  const [stats, setStats] = useState<ZoneStats | null>(null);
  const [products, setProducts] = useState<ZoneProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // form movimenti (un prodotto alla volta)
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [moveQty, setMoveQty] = useState("");
  const [moveMotivo, setMoveMotivo] = useState<"carico" | "rettifica">("carico");
  const [sogliaFor, setSogliaFor] = useState<string | null>(null);
  const [sogliaVal, setSogliaVal] = useState("");
  const [costFor, setCostFor] = useState<string | null>(null);
  const [costVal, setCostVal] = useState("");

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const load = () => {
    fetch("/api/zone/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: ApiResponse<ZoneStats>) => {
        if (res.success && res.data) {
          setStats(res.data);
          setError(null);
        } else {
          setError(res.error ?? "Analisi non disponibile.");
        }
      })
      .catch(() => setError("Errore di rete."));
    fetch("/api/zone/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((res: ApiResponse<ZoneProduct[]>) => {
        if (res.success && res.data) setProducts(res.data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  async function saveSoglia(productId: string) {
    const v = Math.max(0, Math.round(Number(sogliaVal)));
    if (!Number.isFinite(v)) return flash("Soglia non valida.");
    const res = await fetch("/api/zone/stock", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, stock_soglia: v }),
    });
    const json = (await res.json()) as ApiResponse<ZoneProduct[]>;
    if (json.success && json.data) {
      setProducts(json.data);
      setSogliaFor(null);
      flash(v > 0 ? `Soglia alert: ${v} pezzi.` : "Alert disattivato per questo prodotto.");
    } else {
      flash(json.error ?? "Salvataggio soglia fallito.");
    }
  }

  async function saveCost(productId: string) {
    const v = Math.round(Number(costVal.replace(",", ".")) * 100) / 100;
    if (!Number.isFinite(v) || v < 0) return flash("Costo non valido.");
    const res = await fetch("/api/zone/stock", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, unit_cost: v }),
    });
    const json = (await res.json()) as ApiResponse<ZoneProduct[]>;
    if (json.success && json.data) {
      setProducts(json.data);
      setCostFor(null);
      flash(`Costo aggiornato: €${v.toLocaleString("it-IT", { minimumFractionDigits: 2 })}. Le vendite passate mantengono il costo di allora.`);
    } else {
      flash(json.error ?? "Salvataggio costo fallito.");
    }
  }

  async function saveMove(productId: string) {
    const qty = Math.round(Number(moveQty.replace(",", ".")));
    if (!Number.isFinite(qty) || qty === 0) return flash("Quantità non valida.");
    // carico = sempre positivo; rettifica = col segno che scrivi
    const delta = moveMotivo === "carico" ? Math.abs(qty) : qty;
    const res = await fetch("/api/zone/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: productId, delta, motivo: moveMotivo }),
    });
    const json = (await res.json()) as ApiResponse<ZoneProduct[]>;
    if (json.success && json.data) {
      setProducts(json.data);
      setMoveFor(null);
      setMoveQty("");
      flash(`${moveMotivo === "carico" ? "Carico" : "Rettifica"} registrato.`);
    } else {
      flash(json.error ?? "Movimento fallito.");
    }
  }

  if (error) {
    return (
      <p className="font-ui text-xs text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!stats) {
    return <p className="font-ui text-xs text-text2">Carico i numeri…</p>;
  }

  const fmtEuro = (n: number) => `€${n.toLocaleString("it-IT")}`;
  const fmtEuro2 = (n: number) =>
    `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-ui text-xs text-text2">
          Dal registro: {stats.clients_total} clienti · {stats.sales_count} vendite
        </p>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 font-ui text-[11px] text-text2 hover:text-text"
        >
          <RefreshCw className="h-3 w-3" /> aggiorna
        </button>
      </div>

      {/* KPI economici: fatturato · costi · utile reale. Su mobile a
          piena larghezza (1 colonna) così l'importo non viene mai
          troncato; da sm in su tornano affiancati. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Fatturato" value={fmtEuro2(stats.revenue_total)} accent="text-success" />
        <Tile label="Costi (omaggi inclusi)" value={fmtEuro2(stats.cost_total)} accent="text-danger" />
        <Tile
          label={`Utile reale · ${stats.margin_pct}%`}
          value={fmtEuro2(stats.profit_total)}
          accent={stats.profit_total >= 0 ? "text-accent" : "text-danger"}
        />
      </div>

      {/* KPI operativi */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Conversione visite → vendite" value={`${stats.conversion_pct}%`} />
        <Tile label="Card consegnate (in giro)" value={String(stats.cards_active)} />
        <Tile label="Da richiamare" value={String(stats.by_status.da_richiamare)} accent={stats.by_status.da_richiamare > 0 ? "text-accent" : undefined} />
      </div>

      {toast && (
        <p className="font-ui text-xs text-accent" role="status">
          {toast}
        </p>
      )}

      {/* giacenza */}
      <GlassCard className="p-4">
        <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
          Giacenza (alert sotto soglia)
        </h3>
        <ul className="space-y-2">
          {products.map((p) => {
            const low = p.stock_soglia > 0 && p.stock_qty <= p.stock_soglia;
            return (
              <li key={p.id} className="font-ui text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-text">
                    {p.name}
                    {p.fornitore && (
                      <span className="text-text2"> · {p.fornitore}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-bold",
                        low
                          ? "border-danger/50 bg-danger/15 text-danger"
                          : "border-success/40 text-success",
                      )}
                    >
                      {p.stock_qty} pz
                    </span>
                    {sogliaFor === p.id ? (
                      <span className="flex items-center gap-1">
                        <input
                          inputMode="numeric"
                          value={sogliaVal}
                          onChange={(e) => setSogliaVal(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveSoglia(p.id)}
                          className="w-14 rounded-sm border border-accent bg-surface px-1.5 py-0.5 font-ui text-[11px] text-text focus:outline-none"
                          autoFocus
                        />
                        <NeonButton size="sm" onClick={() => saveSoglia(p.id)}>ok</NeonButton>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSogliaFor(p.id);
                          setSogliaVal(String(p.stock_soglia));
                        }}
                        className="text-text2 underline decoration-dotted hover:text-text"
                        title="Cambia soglia alert"
                      >
                        soglia {p.stock_soglia}
                      </button>
                    )}
                    <button
                      type="button"
                      title="Carico / rettifica"
                      onClick={() => {
                        setMoveFor(moveFor === p.id ? null : p.id);
                        setMoveQty("");
                        setMoveMotivo("carico");
                      }}
                      className="text-text2 hover:text-text"
                    >
                      <PackagePlus className="h-4 w-4" />
                    </button>
                  </span>
                </div>
                {/* costo unitario (anagrafica) */}
                <div className="mt-0.5 flex items-center gap-1 font-ui text-[10px] text-text2">
                  <span>costo unitario:</span>
                  {costFor === p.id ? (
                    <span className="flex items-center gap-1">
                      <span>€</span>
                      <input
                        inputMode="decimal"
                        value={costVal}
                        onChange={(e) => setCostVal(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveCost(p.id)}
                        className="w-16 rounded-sm border border-accent bg-surface px-1.5 py-0.5 text-[11px] text-text focus:outline-none"
                        autoFocus
                      />
                      <NeonButton size="sm" onClick={() => saveCost(p.id)}>ok</NeonButton>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCostFor(p.id);
                        setCostVal(p.unit_cost ? String(p.unit_cost) : "");
                      }}
                      className="font-semibold text-text underline decoration-dotted hover:text-accent"
                      title="Modifica il costo unitario (le vendite passate restano invariate)"
                    >
                      {p.unit_cost > 0 ? fmtEuro2(p.unit_cost) : "— imposta"}
                    </button>
                  )}
                </div>
                {low && (
                  <p className="mt-0.5 font-ui text-[10px] font-semibold text-danger">
                    ⚠ sotto soglia{p.fornitore ? ` — ordina da ${p.fornitore}` : ""}
                  </p>
                )}
                {moveFor === p.id && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <select
                      value={moveMotivo}
                      onChange={(e) => setMoveMotivo(e.target.value as "carico" | "rettifica")}
                      className="rounded-sm border border-border bg-surface px-1.5 py-1 font-ui text-[11px] text-text focus:border-accent focus:outline-none"
                    >
                      <option value="carico">Carico (arrivo ordine)</option>
                      <option value="rettifica">Rettifica (±)</option>
                    </select>
                    <input
                      inputMode="numeric"
                      placeholder={moveMotivo === "carico" ? "quanti pezzi" : "es. -3 o 5"}
                      value={moveQty}
                      onChange={(e) => setMoveQty(e.target.value)}
                      className="w-24 rounded-sm border border-border bg-surface px-1.5 py-1 font-ui text-[11px] text-text focus:border-accent focus:outline-none"
                    />
                    <NeonButton size="sm" onClick={() => saveMove(p.id)}>
                      Salva
                    </NeonButton>
                  </div>
                )}
              </li>
            );
          })}
          {products.length === 0 && (
            <li className="font-ui text-xs text-text2">Listino vuoto.</li>
          )}
        </ul>
      </GlassCard>

      {/* zone che rendono */}
      <GlassCard className="p-4">
        <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
          Zone che rendono (per CAP o etichetta giro)
        </h3>
        {stats.by_zone.length === 0 ? (
          <p className="font-ui text-xs text-text2">Ancora nessun dato: importa e vendi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-ui text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-text2">
                  <th className="pb-1.5 pr-3">Zona</th>
                  <th className="pb-1.5 pr-3 text-right">Clienti</th>
                  <th className="pb-1.5 pr-3 text-right">Venduti</th>
                  <th className="pb-1.5 pr-3 text-right">Conversione</th>
                  <th className="pb-1.5 text-right">Fatturato</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_zone.map((z) => (
                  <tr key={z.zone} className="border-t border-surface2 text-text">
                    <td className="py-1.5 pr-3">{z.zone}</td>
                    <td className="py-1.5 pr-3 text-right">{z.clients}</td>
                    <td className="py-1.5 pr-3 text-right">{z.sold}</td>
                    <td className="py-1.5 pr-3 text-right">{z.conversion_pct}%</td>
                    <td className="py-1.5 text-right font-semibold text-success">
                      {fmtEuro(z.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* classifica recensioni/giorno (AyroStar) — casi reali per la trattativa */}
      <GlassCard className="p-4">
        <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
          Classifica recensioni/giorno (casi per la trattativa)
        </h3>
        {stats.daily_reviews.length === 0 ? (
          <p className="font-ui text-xs text-text2">
            Ancora nessun caso: servono clienti venduti con recensioni guadagnate dalla vendita.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full font-ui text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-text2">
                  <th className="pb-1.5 pr-3">Cliente</th>
                  <th className="pb-1.5 pr-3">Categoria</th>
                  <th className="pb-1.5 pr-3">Zona</th>
                  <th className="pb-1.5 pr-3 text-right">Δ rec</th>
                  <th className="pb-1.5 pr-3 text-right">Giorni</th>
                  <th className="pb-1.5 pr-3 text-right">Rec/giorno</th>
                  <th className="pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {stats.daily_reviews.map((d) => {
                  const caseText = `${d.name}${d.zone ? `, ${d.zone}` : ""}: +${d.delta} recensioni in ${d.days} giorni`;
                  return (
                    <tr key={d.id} className="border-t border-surface2 text-text">
                      <td className="py-1.5 pr-3 font-semibold">{d.name}</td>
                      <td className="py-1.5 pr-3 text-text2">{d.category || "—"}</td>
                      <td className="py-1.5 pr-3 text-text2">{d.zone || "—"}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-success">+{d.delta}</td>
                      <td className="py-1.5 pr-3 text-right">{d.days}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-accent">
                        {d.per_day.toLocaleString("it-IT", { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          title="Copia il caso come testo"
                          onClick={() => {
                            navigator.clipboard?.writeText(caseText);
                            flash(`Copiato: ${caseText}`);
                          }}
                          className="text-text2 hover:text-text"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* da richiamare */}
      <GlassCard className="p-4">
        <h3 className="mb-2 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
          Da richiamare (scaduti prima)
        </h3>
        {stats.callbacks.length === 0 ? (
          <p className="font-ui text-xs text-text2">Nessun richiamo in agenda.</p>
        ) : (
          <ul className="space-y-1.5">
            {stats.callbacks.map((c) => {
              const overdue =
                c.callback_at && c.callback_at.slice(0, 10) <= new Date().toISOString().slice(0, 10);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 font-ui text-xs">
                  <span className="min-w-0">
                    <span className="font-semibold text-text">{c.name}</span>
                    {c.notes && <span className="text-text2"> · {c.notes}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <Phone className="h-3 w-3" /> {c.phone}
                      </a>
                    )}
                    <span className={cn(overdue ? "font-bold text-danger" : "text-text2")}>
                      {c.callback_at ? c.callback_at.slice(0, 10) : "senza data"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
