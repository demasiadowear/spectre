"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import CollectorPanel from "./CollectorPanel";
import PannelloStato, { type StatoRuntime } from "./PannelloStato";
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
  const [stato, setStato] = useState<StatoRuntime | null>(null);
  const [leadId, setLeadId] = useState("");
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        // Lo stato del runtime si legge PRIMA dei lead: se il database
        // non e raggiungibile, un elenco vuoto non vuol dire «nessun
        // lead», vuol dire «non l'ho potuto chiedere».
        const [resStato, res] = await Promise.all([
          fetch("/api/collector/capability"),
          fetch("/api/leads"),
        ]);
        const jStato = (await resStato.json()) as ApiResponse<StatoRuntime>;
        if (vivo && jStato.success && jStato.data) setStato(jStato.data);

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

  // Un elenco vuoto non e piu una frase sola per quattro cause: il
  // pannello di stato dice QUALE delle cinque situazioni e, e cosa
  // fare. Qui si aggiunge solo la conseguenza sul collector.
  if (leads.length === 0) {
    return (
      <div className="space-y-3">
        {stato && <PannelloStato stato={stato} />}
        <GlassCard className="p-4">
          <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
            Lead su cui raccogliere
          </p>
          <p className="mt-2 text-xs leading-snug text-text2">
            {stato?.database.stato === "database_empty"
              ? "Il database risponde e lo schema c'è, ma la tabella dei lead è vuota: non c'è ancora niente su cui raccogliere."
              : "Elenco dei lead non disponibile: vedi lo stato del runtime qui sopra per il motivo preciso."}
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {stato && <PannelloStato stato={stato} />}
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
