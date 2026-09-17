"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import CollectorPanel from "./CollectorPanel";
import type { ApiResponse, Lead } from "@/types";

// ============================================================
// Il pannello del collector dentro la Factory: prima si sceglie su
// quale lead lavorare, poi si raccoglie.
//
// Il lead si sceglie da un elenco, non si digita: l'unico ingresso del
// collector e un lead_id gia esistente, e la schermata deve rendere
// evidente che non c'e un campo dove incollare un URL.
//
// La scelta resta in `localStorage` perche su telefono si torna sulla
// pagina di continuo e riselezionare ogni volta e una piccola tortura.
// ============================================================

const CHIAVE = "specter.collector.lead";

export default function CollectorSezione() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState("");
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch("/api/leads");
        const j = (await res.json()) as ApiResponse<Lead[]>;
        if (!vivo) return;
        if (!j.success) throw new Error(j.error ?? "impossibile leggere i lead");
        const lista = j.data ?? [];
        setLeads(lista);
        const salvato = typeof window !== "undefined" ? window.localStorage.getItem(CHIAVE) : "";
        const valido = salvato && lista.some((l) => l.id === salvato) ? salvato : (lista[0]?.id ?? "");
        setLeadId(valido);
      } catch (e) {
        if (vivo) setErrore((e as Error).message);
      } finally {
        if (vivo) setCaricamento(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (leadId && typeof window !== "undefined") window.localStorage.setItem(CHIAVE, leadId);
  }, [leadId]);

  const selezionato = useMemo(() => leads.find((l) => l.id === leadId) ?? null, [leads, leadId]);

  if (caricamento) {
    return (
      <GlassCard className="flex items-center gap-2 p-4 text-xs text-text2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carico i lead…
      </GlassCard>
    );
  }

  if (errore) {
    return (
      <GlassCard className="p-4 text-xs text-danger">{errore}</GlassCard>
    );
  }

  // Un elenco vuoto va detto, non mostrato come una tendina muta: senza
  // questo si resta a fissare un campo vuoto senza capire se e un
  // difetto o se davvero non c'e niente.
  if (leads.length === 0) {
    return (
      <GlassCard className="p-4">
        <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
          Lead su cui raccogliere
        </p>
        <p className="mt-2 text-xs leading-snug text-text2">
          Nessun lead disponibile. Il collector parte sempre da un lead esistente,
          quindi finché la pipeline è vuota — o il database non è raggiungibile da
          questo ambiente — non c&apos;è niente su cui raccogliere.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <label htmlFor="collector-lead" className="block font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
          Lead su cui raccogliere
        </label>
        <select
          id="collector-lead"
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          // 44px e la soglia sotto la quale un dito sbaglia bersaglio.
          className="mt-2 min-h-[44px] w-full rounded-sm border border-border bg-bg px-3 text-sm text-text"
        >
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.company || l.name}{l.phone ? ` — ${l.phone}` : ""}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] leading-snug text-text2">
          Si sceglie da qui, non si incolla un indirizzo: il collector parte da un lead
          e visita solo quello che Google Places dichiara o che il sito ufficiale linka.
        </p>
      </GlassCard>

      {leadId && (
        <CollectorPanel
          key={leadId}
          leadId={leadId}
          leadName={selezionato?.company || selezionato?.name}
        />
      )}
    </div>
  );
}
