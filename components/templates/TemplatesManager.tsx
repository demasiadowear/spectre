"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, Save } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import {
  PLACEHOLDER_DOCS,
  PREVIEW_VARS,
  renderTemplate,
  type MessageTemplate,
} from "@/lib/templates/registry";
import type { ApiResponse } from "@/types";

// ============================================================
// TEMPLATE MANAGER — lista template, editor con anteprima live
// (placeholder risolti su un lead di esempio), salvataggio che
// vale subito ovunque: worker e Study leggono dal DB a ogni uso.
// ============================================================

export default function TemplatesManager() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<MessageTemplate[]>;
      if (json.success && json.data) {
        setTemplates(json.data);
        setError(null);
      } else {
        setError(json.error ?? "Errore caricamento template.");
      }
    } catch {
      setError("Errore di rete.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const current = useMemo(
    () => templates.find((t) => t.key === selected) ?? null,
    [templates, selected],
  );

  function open(t: MessageTemplate) {
    setSelected(t.key);
    setDraft(t.content);
    setSavedKey(null);
  }

  async function save() {
    if (!current) return;
    setBusy(true);
    try {
      const res = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: current.key, content: draft }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) {
        setError(json.error ?? "Salvataggio fallito.");
        return;
      }
      setError(null);
      setSavedKey(current.key);
      setTimeout(() => setSavedKey(null), 2500);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const preview = current ? renderTemplate(draft, PREVIEW_VARS) : "";
  const dirty = current !== null && draft !== current.content;

  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      {/* lista template */}
      <GlassCard className="self-start p-3">
        <p className="mb-2 border-b border-border pb-2 font-ui text-[10px] uppercase tracking-widest text-text2">
          Template ({templates.length})
        </p>
        {error && (
          <p className="mb-2 font-ui text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <ul className="space-y-1">
          {templates.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => open(t)}
                className={cn(
                  "w-full rounded-sm border px-2 py-1.5 text-left transition-colors",
                  t.key === selected
                    ? "border-accent/50 bg-accent/10"
                    : "border-transparent hover:border-border",
                )}
              >
                <span className="block truncate font-ui text-xs font-semibold text-text">
                  {t.label}
                </span>
                <span className="block font-ui text-[10px] text-text2">
                  {t.key}
                  {!t.content.trim() && (
                    <b className="ml-1.5 text-ochre">vuoto</b>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </GlassCard>

      {/* editor + anteprima */}
      {!current ? (
        <GlassCard className="flex min-h-[200px] items-center justify-center p-6">
          <p className="font-ui text-xs text-text2">
            Seleziona un template per modificarlo.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          <GlassCard className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-ui text-sm font-semibold text-text">
                  {current.label}
                </p>
                <p className="font-ui text-[10px] text-text2">
                  {current.key} · ultimo salvataggio: {current.updated_at || "—"}
                </p>
              </div>
              <NeonButton size="sm" disabled={busy || !dirty} onClick={save}>
                {savedKey === current.key ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Salvato, vale subito
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" /> Salva
                  </>
                )}
              </NeonButton>
            </div>

            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.max(6, draft.split("\n").length + 1)}
              spellCheck={false}
              className="w-full resize-y rounded-sm border border-border bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed text-text focus:border-accent/60 focus:outline-none"
            />

            {/* placeholder disponibili (solo quelli previsti dal template) */}
            <div className="flex flex-wrap gap-1.5">
              {current.variables.map((v) => (
                <button
                  key={v}
                  type="button"
                  title={PLACEHOLDER_DOCS[v] ?? ""}
                  onClick={() => setDraft((d) => d + v)}
                  className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/10"
                >
                  {v}
                </button>
              ))}
            </div>
          </GlassCard>

          {/* anteprima placeholder risolti su lead di esempio */}
          <GlassCard className="p-4">
            <p className="mb-2 flex items-center gap-1.5 border-b border-border pb-2 font-ui text-[10px] uppercase tracking-widest text-text2">
              <Eye className="h-3 w-3" /> Anteprima su lead di esempio (
              {PREVIEW_VARS.NOME_ATTIVITA}, {PREVIEW_VARS.CITTA})
            </p>
            {preview.trim() ? (
              <pre className="whitespace-pre-wrap break-words rounded-sm bg-bg p-3 font-sans text-[12px] leading-relaxed text-text">
                {preview}
              </pre>
            ) : (
              <p className="font-ui text-xs text-ochre">
                Template vuoto: chi lo usa riceverà un errore esplicito finché
                non lo compili.
              </p>
            )}
          </GlassCard>

          {/* legenda placeholder */}
          <GlassCard className="p-4">
            <p className="mb-2 border-b border-border pb-2 font-ui text-[10px] uppercase tracking-widest text-text2">
              Placeholder disponibili
            </p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {Object.entries(PLACEHOLDER_DOCS).map(([name, doc]) => (
                <li key={name} className="font-ui text-[11px] text-text2">
                  <code className="font-mono text-accent">{name}</code> — {doc}
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
