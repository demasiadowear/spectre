"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import {
  AUDIT_CATEGORY_PRESETS,
  AUDIT_LIMIT_MAX,
  AUDIT_LIMIT_MIN,
  AUDIT_LOCATION_PRESETS,
  DEFAULT_AUDIT_CATEGORIES,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_AUDIT_LOCATIONS,
} from "@/lib/detective/presets";

// ============================================================
// Mini-form parametri Scout audit: chips categoria/zona con
// campo libero per voci custom + numero risultati target.
// Default precompilati = comportamento v1. Le ultime scelte
// usate vengono salvate in localStorage e ricaricate.
// ============================================================

export interface ScoutAuditParams {
  categories: string[];
  locations: string[];
  limit: number;
}

const STORAGE_KEY = "specter.detective.scout-params";

function loadSaved(): ScoutAuditParams | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ScoutAuditParams>;
    if (!Array.isArray(p.categories) || !Array.isArray(p.locations)) return null;
    return {
      categories: p.categories.filter((v) => typeof v === "string"),
      locations: p.locations.filter((v) => typeof v === "string"),
      limit: typeof p.limit === "number" ? p.limit : DEFAULT_AUDIT_LIMIT,
    };
  } catch {
    return null;
  }
}

/** Toggle immutabile di un valore in una lista. */
function toggled(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function ChipGroup({
  presets,
  selected,
  onToggle,
  customLabel,
}: {
  presets: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  customLabel: string;
}) {
  const [draft, setDraft] = useState("");

  // Voci custom (da storage o appena aggiunte) diventano chips a loro volta.
  const chips = useMemo(() => {
    const extra = selected.filter((v) => !presets.includes(v));
    return [...presets, ...extra];
  }, [presets, selected]);

  function addCustom() {
    const value = draft.trim().toLowerCase();
    setDraft("");
    if (!value || selected.includes(value)) return;
    onToggle(value);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = selected.includes(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => onToggle(chip)}
              aria-pressed={active}
              className={cn(
                "rounded-sm border px-2 py-1 font-ui text-[11px] transition-colors",
                active
                  ? "border-accent/60 bg-accent/10 text-accent"
                  : "border-border text-text2 hover:text-text",
              )}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={customLabel}
          className="w-44 rounded-sm border border-border bg-bg px-2 py-1 font-ui text-[11px] text-text placeholder:text-text2 focus:border-accent/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!draft.trim()}
          aria-label="Aggiungi voce custom"
          className="rounded-sm border border-border p-1 text-text2 hover:text-accent disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default function ScoutAuditForm({
  busy,
  onLaunch,
  onClose,
}: {
  busy: boolean;
  onLaunch: (params: ScoutAuditParams) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<string[]>(DEFAULT_AUDIT_CATEGORIES);
  const [locations, setLocations] = useState<string[]>(DEFAULT_AUDIT_LOCATIONS);
  const [limit, setLimit] = useState(DEFAULT_AUDIT_LIMIT);

  // localStorage è client-only: caricamento dopo il mount.
  useEffect(() => {
    const saved = loadSaved();
    if (!saved) return;
    if (saved.categories.length > 0) setCategories(saved.categories);
    if (saved.locations.length > 0) setLocations(saved.locations);
    setLimit(
      Math.min(AUDIT_LIMIT_MAX, Math.max(AUDIT_LIMIT_MIN, Math.round(saved.limit))),
    );
  }, []);

  const valid = categories.length > 0 && locations.length > 0;

  function launch() {
    if (!valid) return;
    const params: ScoutAuditParams = {
      categories,
      locations,
      limit: Math.min(AUDIT_LIMIT_MAX, Math.max(AUDIT_LIMIT_MIN, Math.round(limit))),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      /* storage pieno/bloccato: lo scout parte comunque */
    }
    onLaunch(params);
  }

  return (
    <GlassCard className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="font-ui text-[10px] uppercase tracking-widest text-text2">
          Parametri scout audit
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi form scout"
          className="text-text2 hover:text-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div>
        <p className="mb-1.5 font-ui text-xs font-semibold text-text">Categoria</p>
        <ChipGroup
          presets={AUDIT_CATEGORY_PRESETS}
          selected={categories}
          onToggle={(v) => setCategories((prev) => toggled(prev, v))}
          customLabel="Categoria custom…"
        />
      </div>

      <div>
        <p className="mb-1.5 font-ui text-xs font-semibold text-text">
          Zona <span className="font-normal text-text2">(Bari + provincia)</span>
        </p>
        <ChipGroup
          presets={AUDIT_LOCATION_PRESETS}
          selected={locations}
          onToggle={(v) => setLocations((prev) => toggled(prev, v))}
          customLabel="Città custom…"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 font-ui text-xs text-text">
          Risultati target
          <input
            type="number"
            min={AUDIT_LIMIT_MIN}
            max={AUDIT_LIMIT_MAX}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-16 rounded-sm border border-border bg-bg px-2 py-1 font-ui text-xs text-text focus:border-accent/60 focus:outline-none"
          />
        </label>
        <NeonButton size="sm" disabled={busy || !valid} onClick={launch}>
          <Search className="h-3.5 w-3.5" />
          {busy ? "Scout in corso…" : "Lancia scout"}
        </NeonButton>
        {!valid && (
          <p className="font-ui text-[11px] text-danger">
            Seleziona almeno una categoria e una zona.
          </p>
        )}
        <p className="ml-auto font-ui text-[11px] text-text2">
          {categories.length} categorie · {locations.length} zone · filtro CON sito
          + dedup DB invariati
        </p>
      </div>
    </GlassCard>
  );
}
