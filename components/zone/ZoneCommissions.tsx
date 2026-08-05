"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, Download, Pencil, Plus, Power, Trophy } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { CommissionReport, ZoneAgent } from "@/types/zone";

// ============================================================
// AGENTI / PROVVIGIONI — anagrafica agenti (CRUD), provvigioni per
// periodo + classifica. Single-user: nessun ruolo/login, gli agenti
// sono solo riferimenti. Un solo importo, nessuno scorporo fiscale.
// ============================================================

const inputCls =
  "rounded-sm border border-border bg-surface px-2 py-1.5 font-ui text-xs text-text placeholder:text-text2/60 focus:border-accent focus:outline-none";

function monthDefaults(): { start: string; end: string } {
  const n = new Date();
  const start = new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(n.getFullYear(), n.getMonth() + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const eur = (n: number) =>
  `€${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type AgentForm = { id?: string; nome: string; telefono: string; commission_pct: string; note: string; attivo: boolean };
const emptyForm = (): AgentForm => ({ nome: "", telefono: "", commission_pct: "25", note: "", attivo: true });

export default function ZoneCommissions() {
  const [agents, setAgents] = useState<ZoneAgent[]>([]);
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // filtri provvigioni
  const def = monthDefaults();
  const [start, setStart] = useState(def.start);
  const [end, setEnd] = useState(def.end);
  const [agentFilter, setAgentFilter] = useState("");
  // form agente
  const [form, setForm] = useState<AgentForm | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  }

  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/zone/agents?all=1", { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<ZoneAgent[]>;
    if (json.success && json.data) setAgents(json.data);
  }, []);

  const loadReport = useCallback(async () => {
    const p = new URLSearchParams({ start, end });
    if (agentFilter) p.set("agent", agentFilter);
    const res = await fetch(`/api/zone/commissions?${p}`, { cache: "no-store" });
    const json = (await res.json()) as ApiResponse<CommissionReport>;
    if (json.success && json.data) setReport(json.data);
  }, [start, end, agentFilter]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);
  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function saveAgent() {
    if (!form || !form.nome.trim()) return flash("Il nome è obbligatorio.");
    const res = await fetch("/api/zone/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id,
        nome: form.nome.trim(),
        telefono: form.telefono.trim(),
        commission_pct: Number(form.commission_pct.replace(",", ".")) || 0,
        note: form.note.trim(),
        attivo: form.attivo,
      }),
    });
    const json = (await res.json()) as ApiResponse<ZoneAgent[]>;
    if (json.success && json.data) {
      setAgents(json.data);
      setForm(null);
      flash(form.id ? "Agente aggiornato ✓" : "Agente creato ✓");
    } else {
      flash(json.error ?? "Salvataggio agente fallito.");
    }
  }

  async function toggleActive(a: ZoneAgent) {
    if (a.attivo) {
      const res = await fetch(`/api/zone/agents?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<ZoneAgent[]>;
      if (json.success && json.data) {
        setAgents(json.data);
        flash(`${a.nome} disattivato (resta nello storico).`);
      }
    } else {
      // riattiva: upsert con attivo true
      const res = await fetch("/api/zone/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id, nome: a.nome, telefono: a.telefono, commission_pct: a.commission_pct, note: a.note, attivo: true }),
      });
      const json = (await res.json()) as ApiResponse<ZoneAgent[]>;
      if (json.success && json.data) {
        setAgents(json.data);
        flash(`${a.nome} riattivato.`);
      }
    }
  }

  async function markPaid(agentId: string, importo: number) {
    const res = await fetch("/api/zone/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, start, end, importo }),
    });
    const json = (await res.json()) as ApiResponse<CommissionReport>;
    if (json.success && json.data) {
      setReport(json.data);
      flash("Provvigione segnata come pagata ✓");
    } else {
      flash(json.error ?? "Operazione fallita.");
    }
  }

  const exportHref = `/api/zone/export?what=commissions&start=${start}&end=${end}${agentFilter ? `&agent=${agentFilter}` : ""}`;

  return (
    <div className="space-y-4">
      {toast && (
        <p className="font-ui text-xs text-accent" role="status">
          {toast}
        </p>
      )}

      {/* Anagrafica agenti (CRUD) */}
      <GlassCard className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
            Agenti / segnalatori
          </h3>
          <NeonButton size="sm" onClick={() => setForm(emptyForm())}>
            <Plus className="h-3.5 w-3.5" /> Nuovo
          </NeonButton>
        </div>

        {form && (
          <div className="mb-3 space-y-2 rounded-sm border border-accent/40 bg-accent/5 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Nome *"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className={cn(inputCls, "min-h-[40px]")}
              />
              <input
                placeholder="Telefono"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                className={cn(inputCls, "min-h-[40px]")}
              />
              <label className="flex items-center gap-1 text-[11px] text-text2">
                Provvigione %
                <input
                  inputMode="decimal"
                  value={form.commission_pct}
                  onChange={(e) => setForm({ ...form, commission_pct: e.target.value })}
                  className={cn(inputCls, "min-h-[40px] w-20")}
                />
              </label>
              <input
                placeholder="Note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className={cn(inputCls, "min-h-[40px]")}
              />
            </div>
            <div className="flex items-center gap-2">
              <NeonButton size="sm" variant="green" onClick={saveAgent}>
                Salva
              </NeonButton>
              <button type="button" onClick={() => setForm(null)} className="font-ui text-[11px] text-text2 hover:text-text">
                Annulla
              </button>
            </div>
          </div>
        )}

        <ul className="space-y-1">
          {agents.map((a) => (
            <li
              key={a.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-sm border p-2 font-ui text-xs",
                a.attivo ? "border-surface2" : "border-border bg-surface2/40 opacity-70",
              )}
            >
              <span className="min-w-0 flex-1">
                <b className="text-text">{a.nome}</b>
                {a.telefono && <span className="text-text2"> · {a.telefono}</span>}
                <span className="text-accent"> · {a.commission_pct}%</span>
                {!a.attivo && <span className="text-text2"> · disattivato</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  title="Modifica"
                  onClick={() =>
                    setForm({ id: a.id, nome: a.nome, telefono: a.telefono, commission_pct: String(a.commission_pct), note: a.note, attivo: a.attivo })
                  }
                  className="text-text2 hover:text-text"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={a.attivo ? "Disattiva" : "Riattiva"}
                  onClick={() => toggleActive(a)}
                  className={cn("hover:opacity-80", a.attivo ? "text-danger" : "text-success")}
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
          {agents.length === 0 && <li className="font-ui text-xs text-text2">Nessun agente.</li>}
        </ul>
      </GlassCard>

      {/* Provvigioni + classifica */}
      <GlassCard className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 font-ui text-[10px] uppercase tracking-[0.18em] text-text2">
            <Trophy className="h-3.5 w-3.5" /> Provvigioni · classifica (ordinati per venduto)
          </h3>
          <a
            href={exportHref}
            className="inline-flex items-center gap-1 font-ui text-[11px] text-text2 hover:text-text"
          >
            <Download className="h-3.5 w-3.5" /> CSV provvigioni
          </a>
        </div>

        {/* filtri periodo + agente */}
        <div className="mb-3 flex flex-wrap items-end gap-2 font-ui text-[11px] text-text2">
          <label className="flex flex-col gap-1">
            Dal
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={cn(inputCls, "min-h-[36px]")} />
          </label>
          <label className="flex flex-col gap-1">
            Al
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={cn(inputCls, "min-h-[36px]")} />
          </label>
          <label className="flex flex-col gap-1">
            Agente
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className={cn(inputCls, "min-h-[36px]")}>
              <option value="">Tutti</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!report || report.agents.length === 0 ? (
          <p className="font-ui text-xs text-text2">Nessuna provvigione nel periodo selezionato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] font-ui text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-text2">
                  <th className="pb-1.5 pr-3">Agente</th>
                  <th className="pb-1.5 pr-3 text-right">Vendite</th>
                  <th className="pb-1.5 pr-3 text-right">Pezzi</th>
                  <th className="pb-1.5 pr-3 text-right">Venduto</th>
                  <th className="pb-1.5 pr-3 text-right">Media/vend.</th>
                  <th className="pb-1.5 pr-3 text-right">Provvigione</th>
                  <th className="pb-1.5 pr-3 text-right">Omaggi</th>
                  <th className="pb-1.5 pr-3">Stato</th>
                  <th className="pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="border-t border-surface2 text-text">
                      <td className="py-1.5 pr-3 font-semibold">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                          className="inline-flex items-center gap-1 hover:text-accent"
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded === a.id && "rotate-180")} />
                          {a.nome}
                        </button>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{a.n_vendite}</td>
                      <td className="py-1.5 pr-3 text-right">{a.pezzi}</td>
                      <td className="py-1.5 pr-3 text-right">{eur(a.totale_venduto)}</td>
                      <td className="py-1.5 pr-3 text-right text-text2">{eur(a.media_per_vendita)}</td>
                      <td className="py-1.5 pr-3 text-right font-bold text-success">{eur(a.provvigione)}</td>
                      <td className="py-1.5 pr-3 text-right text-text2">{a.omaggi}</td>
                      <td className="py-1.5 pr-3">
                        {a.pagata ? (
                          <span className="rounded-full border border-success/40 px-2 py-0.5 text-[9px] font-bold uppercase text-success">
                            pagata
                          </span>
                        ) : (
                          <span className="rounded-full border border-ochre/40 px-2 py-0.5 text-[9px] font-bold uppercase text-ochre">
                            da pagare
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {!a.pagata && a.provvigione > 0 && (
                          <NeonButton size="sm" variant="green" onClick={() => markPaid(a.id, a.provvigione)}>
                            Segna pagata
                          </NeonButton>
                        )}
                      </td>
                    </tr>
                    {expanded === a.id && (
                      <tr className="border-t border-surface2/50 bg-surface2/30">
                        <td colSpan={9} className="p-2">
                          <table className="w-full font-ui text-[11px]">
                            <thead>
                              <tr className="text-left text-[9px] uppercase tracking-widest text-text2">
                                <th className="pb-1 pr-2">Data</th>
                                <th className="pb-1 pr-2">Cliente</th>
                                <th className="pb-1 pr-2">Prodotto</th>
                                <th className="pb-1 pr-2 text-right">Qty</th>
                                <th className="pb-1 pr-2 text-right">Prezzo</th>
                                <th className="pb-1 pr-2 text-right">%</th>
                                <th className="pb-1 text-right">Provv.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.sales.map((s, i) => (
                                <tr key={i} className="text-text2">
                                  <td className="py-0.5 pr-2">{s.sold_at.slice(0, 10)}</td>
                                  <td className="py-0.5 pr-2 text-text">{s.client_name || "—"}</td>
                                  <td className="py-0.5 pr-2">
                                    {s.product_name}
                                    {s.omaggio && <span className="ml-1 text-ochre">(omaggio)</span>}
                                  </td>
                                  <td className="py-0.5 pr-2 text-right">{s.qty}</td>
                                  <td className="py-0.5 pr-2 text-right">{s.omaggio ? "—" : eur(s.price)}</td>
                                  <td className="py-0.5 pr-2 text-right">{s.omaggio ? "—" : `${s.commission_pct}%`}</td>
                                  <td className="py-0.5 text-right font-semibold text-success">
                                    {s.commission_amount > 0 ? eur(s.commission_amount) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
