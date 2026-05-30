"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Target } from "lucide-react";
import HunterForm from "./HunterForm";
import HunterResults from "./HunterResults";
import ScriptModal from "./ScriptModal";
import PulseRing from "@/components/ui/spectre/PulseRing";
import { useVoiceStore } from "@/lib/voice/store";
import type { ApiResponse } from "@/types";
import {
  HUNTER_CATEGORIES,
  type HuntResult,
  type HunterParams,
  type ScoredLead,
} from "@/types/hunter";

/** Map a spoken category ("parrucchiere") to a known option value. */
function matchCategory(spoken: string): string {
  const s = spoken.toLowerCase().trim();
  if (!s) return HUNTER_CATEGORIES[0].value;
  const found = HUNTER_CATEGORIES.find((c) => {
    const base = c.value.split(" ")[0];
    return s.includes(base.slice(0, 5)) || base.startsWith(s.slice(0, 5));
  });
  return found?.value ?? HUNTER_CATEGORIES[0].value;
}

// ============================================================
// HUNTER orchestrator — owns search/results/modal/import state
// and stitches the three presentational pieces together.
// ============================================================

function toImportPayload(lead: ScoredLead, category: string) {
  return {
    name: lead.name,
    company: lead.name,
    email: "",
    phone: lead.phone,
    source: "maps" as const,
    status: "todo" as const,
    value: lead.estimated_value,
    probability: Math.max(5, Math.min(95, lead.hunter_score)),
    next_action: "Cold call — script Hunter pronto",
    notes: `${lead.address} · ${lead.rating.toFixed(1)}★ (${lead.reviews}) · ${
      lead.has_website ? "ha sito" : "NO SITO"
    }`,
    tags: [category, lead.priority, "hunter"],
    // Feed the pitch engine: rating/reviews/address/category live in meta.
    meta: {
      rating: lead.rating,
      reviews: lead.reviews,
      address: lead.address,
      category,
      lat: lead.lat,
      lng: lead.lng,
    },
  };
}

export default function HunterConsole() {
  const [leads, setLeads] = useState<ScoredLead[]>([]);
  const [source, setSource] = useState<HuntResult["source"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [category, setCategory] = useState("");

  const [scriptLead, setScriptLead] = useState<ScoredLead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const pendingAction = useVoiceStore((s) => s.pendingAction);
  const consumeAction = useVoiceStore((s) => s.consumeAction);
  const [seedLocation, setSeedLocation] = useState("");
  const [seedCategory, setSeedCategory] = useState("");
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleHunt = useCallback(async (params: HunterParams) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setCategory(params.category);
    try {
      const res = await fetch("/api/hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const json = (await res.json()) as ApiResponse<HuntResult>;
      if (json.success && json.data) {
        setLeads(json.data.leads);
        setSource(json.data.source);
      } else {
        setError(json.error || "Hunt fallito.");
        setLeads([]);
      }
    } catch {
      setError("Errore di rete durante l'hunt.");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerateScript = useCallback((lead: ScoredLead) => {
    setScriptLead(lead);
    setModalOpen(true);
  }, []);

  const handleImport = useCallback(
    async (lead: ScoredLead) => {
      if (importedIds.has(lead.id) || importingId) return;
      setImportingId(lead.id);
      try {
        const res = await fetch("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: [toImportPayload(lead, category)] }),
        });
        const json = (await res.json()) as ApiResponse<{ imported: number }>;
        if (json.success) {
          setImportedIds((prev) => {
            const next = new Set(prev);
            next.add(lead.id);
            return next;
          });
          setToast(`${lead.name} inserito in Visor`);
        } else {
          setToast(json.error || "Import fallito.");
        }
      } catch {
        setToast("Errore di rete durante l'import.");
      } finally {
        setImportingId(null);
      }
    },
    [category, importedIds, importingId],
  );

  // Voice command bus: "Hunter cerca [categoria] a [città]".
  useEffect(() => {
    if (
      !pendingAction ||
      pendingAction.module !== "hunter" ||
      pendingAction.kind !== "hunt"
    )
      return;
    const city = String(pendingAction.payload.city ?? "").trim();
    const cat = matchCategory(String(pendingAction.payload.category ?? ""));
    consumeAction();
    if (!city) return;
    setSeedLocation(city);
    setSeedCategory(cat);
    setFormKey((k) => k + 1);
    void handleHunt({
      location: city,
      category: cat,
      radius: 5,
      min_rating: 4,
      only_no_website: true,
      limit: 30,
    });
  }, [pendingAction, consumeAction, handleHunt]);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <HunterForm
        key={formKey}
        onHunt={handleHunt}
        loading={loading}
        initialLocation={seedLocation}
        initialCategory={seedCategory || undefined}
      />

      <HunterResults
        leads={leads}
        source={source}
        loading={loading}
        error={error}
        hasSearched={hasSearched}
        importingId={importingId}
        importedIds={importedIds}
        onGenerateScript={handleGenerateScript}
        onImport={handleImport}
      />

      <ScriptModal
        open={modalOpen}
        lead={scriptLead}
        category={category}
        onClose={() => setModalOpen(false)}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-none fixed bottom-8 left-1/2 z-[60] -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-sm border border-spectre-green/40 bg-spectre-panel/95 px-4 py-2.5 shadow-neon-green backdrop-blur-xl">
              <PulseRing tone="green" size={7} />
              <Target className="h-3.5 w-3.5 text-spectre-green" />
              <span className="font-mono text-xs uppercase tracking-[0.15em] text-spectre-green">
                {toast}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
