"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Search,
  Sparkles,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { DetectiveCase, DetectiveStatus } from "@/types/detective";

// ============================================================
// DETECTIVE board — funnel dedicato (separato dal web agency
// funnel): scouted → investigated → report_ready → sent →
// interested → pilot → archived. Trigger manuali: scout audit,
// indaga singolo/batch, copia messaggio WA, avanza stato.
// ============================================================

const STATUSES: { id: DetectiveStatus; label: string; accent: string }[] = [
  { id: "scouted", label: "Scouted", accent: "text-text2 border-border" },
  { id: "investigated", label: "Investigated", accent: "text-ochre border-ochre/40" },
  { id: "report_ready", label: "Report pronto", accent: "text-accent border-accent/40" },
  { id: "sent", label: "Inviato", accent: "text-fn-replied border-fn-replied/40" },
  { id: "interested", label: "Interessato", accent: "text-success border-success/40" },
  { id: "pilot", label: "Pilota", accent: "text-success border-success/60" },
  { id: "archived", label: "Archiviato", accent: "text-fn-lost border-border" },
];

/** Stato successivo proponibile dalla card (avanzamento manuale). */
const NEXT_STATUS: Partial<Record<DetectiveStatus, { to: DetectiveStatus; label: string }>> = {
  report_ready: { to: "sent", label: "Segna inviato" },
  sent: { to: "interested", label: "Interessato" },
  interested: { to: "pilot", label: "→ Pilota" },
};

function fmtRange(c: DetectiveCase): string | null {
  if (!c.analysis) return null;
  const f = (n: number) => `€${n.toLocaleString("it-IT")}`;
  return `${f(c.analysis.total_min)}–${f(c.analysis.total_max)}/mese`;
}

export default function DetectiveBoard() {
  const [cases, setCases] = useState<DetectiveCase[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/detective/cases", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<DetectiveCase[]>;
      if (json.success && json.data) setCases(json.data);
      setError(json.success ? null : (json.error ?? null));
    } catch {
      setError("Errore di rete.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function post(url: string, body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    try {
      const res = await fetch(url, {
        method: url.endsWith("cases") ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) flash(`Errore: ${json.error ?? "operazione fallita"}`);
      await refresh();
      return json;
    } finally {
      setBusy(null);
    }
  }

  const runScout = async () => {
    flash("Scout audit in corso… (può richiedere 1-2 minuti)");
    const res = await post("/api/detective/scout", { limit: 20 }, "scout");
    const d = res?.data as { inserted?: number; skipped_duplicates?: number } | undefined;
    if (d) flash(`Scout: ${d.inserted ?? 0} nuovi casi, ${d.skipped_duplicates ?? 0} duplicati esclusi.`);
  };

  const investigate = (id: string) =>
    post("/api/detective/investigate", { case_id: id }, id);

  const investigateBatch = async () => {
    flash("Indagine batch in corso…");
    await post("/api/detective/investigate", { all_scouted: true, limit: 5 }, "batch");
    flash("Batch completato.");
  };

  const advance = (c: DetectiveCase) => {
    const next = NEXT_STATUS[c.status];
    if (next) post("/api/detective/cases", { case_id: c.id, status: next.to }, c.id);
  };

  const archive = (c: DetectiveCase) =>
    post("/api/detective/cases", { case_id: c.id, status: "archived" }, c.id);

  async function copyMessage(c: DetectiveCase) {
    if (!c.wa_message) return;
    await navigator.clipboard.writeText(c.wa_message);
    flash(`Messaggio WA per ${c.business_name} copiato.`);
  }

  const byStatus = useMemo(() => {
    const map = new Map<DetectiveStatus, DetectiveCase[]>(
      STATUSES.map((s) => [s.id, []]),
    );
    for (const c of cases) map.get(c.status)?.push(c);
    return map;
  }, [cases]);

  const scoutedCount = byStatus.get("scouted")?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* trigger manuali */}
      <GlassCard className="flex flex-wrap items-center gap-3 px-4 py-3">
        <NeonButton size="sm" disabled={busy === "scout"} onClick={runScout}>
          <Search className="h-3.5 w-3.5" /> Scout audit (con sito)
        </NeonButton>
        <NeonButton
          size="sm"
          variant="amber"
          disabled={busy === "batch" || scoutedCount === 0}
          onClick={investigateBatch}
        >
          <Sparkles className="h-3.5 w-3.5" /> Indaga batch ({Math.min(scoutedCount, 5)})
        </NeonButton>
        <p className="ml-auto font-ui text-xs text-text2">
          {cases.length} casi · funnel separato, invio sempre manuale
        </p>
      </GlassCard>

      {toast && (
        <p className="font-ui text-xs text-accent" role="status">
          {toast}
        </p>
      )}
      {error && (
        <p className="font-ui text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      {/* kanban */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {STATUSES.map(({ id, label, accent }) => {
          const items = byStatus.get(id) ?? [];
          return (
            <GlassCard key={id} className="flex flex-col p-3">
              <div className={cn("mb-2 flex items-center justify-between border-b pb-2", accent)}>
                <span className="font-ui text-[10px] uppercase tracking-widest">{label}</span>
                <span className="font-display text-sm font-bold">{items.length}</span>
              </div>
              <ul className="space-y-2">
                {items.length === 0 && (
                  <li className="font-ui text-[11px] text-text2">
                    {id === "scouted"
                      ? "Nessun caso: lancia lo scout audit."
                      : "—"}
                  </li>
                )}
                {items.map((c) => {
                  const range = fmtRange(c);
                  const next = NEXT_STATUS[c.status];
                  return (
                    <li
                      key={c.id}
                      className="rounded-sm border border-surface2 bg-bg p-2"
                    >
                      <p className="truncate font-ui text-xs font-semibold text-text">
                        {c.business_name}
                      </p>
                      <p className="truncate font-ui text-[10px] text-text2">
                        {c.city} · {c.category}
                      </p>

                      {c.analysis && (
                        <p className="mt-1 font-ui text-[11px]">
                          <b
                            className={cn(
                              c.analysis.overall >= 70
                                ? "text-success"
                                : c.analysis.overall >= 45
                                  ? "text-ochre"
                                  : "text-danger",
                            )}
                          >
                            {c.analysis.overall}/100
                          </b>
                          {range && <span className="ml-1.5 text-accent">{range}</span>}
                        </p>
                      )}
                      {c.error && (
                        <p className="mt-1 truncate font-ui text-[10px] text-danger" title={c.error}>
                          ⚠ {c.error}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.status === "scouted" && (
                          <button
                            type="button"
                            disabled={busy === c.id}
                            onClick={() => investigate(c.id)}
                            className="rounded-sm border border-accent/50 px-1.5 py-0.5 font-ui text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40"
                          >
                            {busy === c.id ? "Indago…" : "Indaga"}
                          </button>
                        )}
                        {c.status === "investigated" && c.error && (
                          <button
                            type="button"
                            disabled={busy === c.id}
                            onClick={() => investigate(c.id)}
                            className="rounded-sm border border-ochre/50 px-1.5 py-0.5 font-ui text-[10px] text-ochre hover:bg-ochre/10 disabled:opacity-40"
                          >
                            Riprova
                          </button>
                        )}
                        {c.report_slug && c.status !== "scouted" && c.analysis && (
                          <a
                            href={`/detective/${c.report_slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-0.5 rounded-sm border border-border px-1.5 py-0.5 font-ui text-[10px] text-text hover:bg-surface2"
                          >
                            <ExternalLink className="h-2.5 w-2.5" /> Report
                          </a>
                        )}
                        {c.wa_message && (
                          <button
                            type="button"
                            onClick={() => copyMessage(c)}
                            className="flex items-center gap-0.5 rounded-sm border border-success/50 px-1.5 py-0.5 font-ui text-[10px] text-success hover:bg-success/10"
                          >
                            <Copy className="h-2.5 w-2.5" /> Msg WA
                          </button>
                        )}
                        {next && (
                          <button
                            type="button"
                            disabled={busy === c.id}
                            onClick={() => advance(c)}
                            className="flex items-center gap-0.5 rounded-sm border border-border px-1.5 py-0.5 font-ui text-[10px] text-text2 hover:text-text disabled:opacity-40"
                          >
                            <Check className="h-2.5 w-2.5" /> {next.label}
                          </button>
                        )}
                        {c.status !== "archived" && c.status !== "pilot" && (
                          <button
                            type="button"
                            disabled={busy === c.id}
                            onClick={() => archive(c)}
                            className="rounded-sm border border-border px-1.5 py-0.5 font-ui text-[10px] text-text2 hover:text-danger disabled:opacity-40"
                          >
                            Archivia
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
