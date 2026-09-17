"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import { cn } from "@/lib/utils";
import type { CapabilityReport } from "@/types/dossier";

// ============================================================
// Lo stato del runtime, detto senza ambiguita.
//
// «Nessun lead disponibile» univa quattro cause che si sistemano in
// quattro modi diversi. Qui ogni riga e un booleano e basta, e il
// database ha cinque stati distinti con l'azione corrispondente.
//
// Nessun valore, nessun prefisso, nessuna lunghezza: solo si/no e i
// nomi delle variabili mancanti.
// ============================================================

export interface StatoRuntime {
  capability: CapabilityReport;
  database: { stato: string; detail: string; tabelle_mancanti: string[]; lead: number; ms: number };
  auth_mode: string;
  scope: string;
  pronto: boolean;
  motivi: string[];
  note: string[];
}

const ETICHETTA_DB: Record<string, string> = {
  database_not_configured: "Non configurato",
  database_unreachable: "Irraggiungibile",
  database_schema_missing: "Schema assente",
  database_empty: "Vuoto",
  database_ready: "Pronto",
};

/** Cosa fare, per ciascuno stato. Un errore senza rimedio e meta errore. */
const RIMEDIO_DB: Record<string, string> = {
  database_not_configured: "Aggiungi TURSO_DATABASE_URL e TURSO_AUTH_TOKEN in questo scope, poi rideploya.",
  database_unreachable: "Le variabili ci sono ma l'host non risponde: controlla URL, token e stato del database.",
  database_schema_missing: "Il database risponde ma le tabelle non ci sono: applica lo schema.",
  database_empty: "Tutto a posto, ma non c'è ancora nessun lead da lavorare.",
  database_ready: "",
};

const VOCI: { chiave: keyof CapabilityReport; etichetta: string }[] = [
  { chiave: "authentication_configured", etichetta: "Autenticazione configurata" },
  { chiave: "database_configured", etichetta: "Database configurato" },
  { chiave: "database_reachable", etichetta: "Database raggiungibile" },
  { chiave: "database_schema_present", etichetta: "Schema presente" },
  { chiave: "google_places_configured", etichetta: "Google Places configurato" },
  { chiave: "storage_configured", etichetta: "Storage configurato" },
  { chiave: "browser_worker_configured", etichetta: "Browser worker configurato" },
];

export default function PannelloStato({ stato }: { stato: StatoRuntime }) {
  const db = stato.database.stato;
  const rimedio = RIMEDIO_DB[db] ?? "";

  return (
    <GlassCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-text2">
          Stato del runtime
        </h3>
        <span className="text-[11px] text-text2">
          {stato.scope} · auth {stato.auth_mode}
        </span>
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {VOCI.map((v) => {
          const ok = Boolean(stato.capability[v.chiave]);
          return (
            <li key={String(v.chiave)} className="flex items-center gap-2 text-[11px]">
              {ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                : <XCircle className="h-3.5 w-3.5 shrink-0 text-text2" />}
              <span className={ok ? "text-text" : "text-text2"}>{v.etichetta}</span>
              <span className={cn("ml-auto font-ui", ok ? "text-success" : "text-text2")}>
                {ok ? "sì" : "no"}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Il database ha cinque stati, non due: ognuno con il suo rimedio. */}
      <div className={cn(
        "mt-3 rounded-sm border p-2.5",
        db === "database_ready" ? "border-success/30" : "border-ochre/40 bg-ochre/5",
      )}>
        <p className="text-[11px]">
          <span className="text-text2">Database: </span>
          <span className={db === "database_ready" ? "text-success" : "text-ochre"}>
            {ETICHETTA_DB[db] ?? db}
          </span>
          <span className="text-text2"> — {stato.database.detail}</span>
        </p>
        {rimedio && <p className="mt-1 text-[11px] leading-snug text-text2">{rimedio}</p>}
        {stato.database.tabelle_mancanti.length > 0 && (
          <p className="mt-1 text-[11px] text-text2">
            Tabelle mancanti: {stato.database.tabelle_mancanti.join(", ")}
          </p>
        )}
      </div>

      {/* Le variabili mancanti: solo i nomi, con lo scope. */}
      {stato.capability.missing.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] text-text2">Variabili mancanti in {stato.scope}:</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {stato.capability.missing.map((m) => (
              <li key={m.name} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] text-text2">
                {m.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Perche le azioni sono spente. */}
      {!stato.pronto && (
        <div className="mt-3 rounded-sm border border-danger/40 bg-danger/5 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> Azioni disabilitate
          </p>
          <ul className="mt-1 space-y-1">
            {stato.motivi.map((m) => (
              <li key={m} className="text-[11px] leading-snug text-text2">— {m}</li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
