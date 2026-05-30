"use client";

import { useState, type FormEvent } from "react";
import { Crosshair, Globe } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { SPECTRE } from "@/lib/constants";
import { HUNTER_CATEGORIES, type HunterParams } from "@/types/hunter";

interface HunterFormProps {
  onHunt: (params: HunterParams) => void;
  loading: boolean;
  initialLocation?: string;
  initialCategory?: string;
}

const LABEL =
  "font-mono text-[10px] uppercase tracking-[0.25em] text-spectre-muted";
const FIELD =
  "w-full rounded-sm border border-spectre-cyan/20 bg-black/40 px-3 py-2.5 font-mono text-sm text-spectre-text outline-none transition focus:border-spectre-cyan/60 focus:shadow-neon-cyan";

export default function HunterForm({
  onHunt,
  loading,
  initialLocation,
  initialCategory,
}: HunterFormProps) {
  const [location, setLocation] = useState(initialLocation ?? "");
  const [category, setCategory] = useState(
    initialCategory ?? HUNTER_CATEGORIES[0].value,
  );
  const [radius, setRadius] = useState(5);
  const [minRating, setMinRating] = useState(4.0);
  const [onlyNoWebsite, setOnlyNoWebsite] = useState(true);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!location.trim() || !category.trim() || loading) return;
    onHunt({
      location: location.trim(),
      category: category.trim(),
      radius,
      min_rating: minRating,
      only_no_website: onlyNoWebsite,
      limit: 30,
    });
  }

  return (
    <GlassCard corners glow="magenta" className="p-5 sm:p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Città / Zona</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Milano, Roma, Torino..."
              className={FIELD}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Categoria attività</span>
            <input
              type="text"
              list="hunter-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="ristoranti, fioraio, officina, palestra…"
              className={FIELD}
              required
            />
            <datalist id="hunter-categories">
              {HUNTER_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </datalist>
          </label>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between">
              <span className={LABEL}>Raggio ricerca</span>
              <span className="font-mono text-xs text-spectre-cyan">
                {radius} km
              </span>
            </span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-spectre-cyan/15"
              style={{ accentColor: SPECTRE.cyan }}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between">
              <span className={LABEL}>Rating minimo</span>
              <span className="font-mono text-xs text-spectre-amber">
                {minRating.toFixed(1)} ★
              </span>
            </span>
            <input
              type="range"
              min={3.0}
              max={5.0}
              step={0.1}
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-spectre-amber/15"
              style={{ accentColor: SPECTRE.amber }}
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setOnlyNoWebsite((v) => !v)}
          className="flex items-center justify-between rounded-sm border border-spectre-cyan/15 bg-black/30 px-3 py-2.5 transition hover:border-spectre-cyan/30"
        >
          <span className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-spectre-muted" strokeWidth={1.5} />
            <span className="font-mono text-xs text-spectre-text">
              Solo attività senza sito web
            </span>
          </span>
          <span
            className={`relative h-5 w-9 rounded-full transition-colors ${
              onlyNoWebsite ? "bg-spectre-magenta/70" : "bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                onlyNoWebsite ? "left-[18px]" : "left-0.5"
              }`}
            />
          </span>
        </button>

        <NeonButton
          type="submit"
          variant="magenta"
          size="lg"
          filled
          disabled={loading || !location.trim()}
          className="w-full"
        >
          <Crosshair
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            strokeWidth={1.5}
          />
          {loading ? "Hunting in corso" : "Lancia Hunt"}
        </NeonButton>
      </form>
    </GlassCard>
  );
}
