"use client";

import { useEffect, useState } from "react";
import { Phone, RefreshCw } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { ZoneStats } from "@/types/zone";

// ============================================================
// ANALISI — i numeri dal registro: fatturato, conversione, zone
// che rendono, fatture in sospeso via Registro, da richiamare.
// Solo lettura: le azioni si fanno dal Registro.
// ============================================================

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <GlassCard className="px-4 py-3">
      <p className="font-ui text-[10px] uppercase tracking-widest text-text2">{label}</p>
      <p className={cn("font-display text-2xl font-bold text-text", accent)}>{value}</p>
    </GlassCard>
  );
}

export default function ZoneAnalytics() {
  const [stats, setStats] = useState<ZoneStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
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

  useEffect(() => {
    load();
  }, []);

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

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Fatturato" value={fmtEuro(stats.revenue_total)} accent="text-success" />
        <Tile label="Conversione visite → vendite" value={`${stats.conversion_pct}%`} />
        <Tile label="Card attive in giro" value={String(stats.cards_active)} />
        <Tile label="Da richiamare" value={String(stats.by_status.da_richiamare)} accent={stats.by_status.da_richiamare > 0 ? "text-accent" : undefined} />
      </div>

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
