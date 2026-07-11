"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  LocateFixed,
  Phone,
} from "lucide-react";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type { CareTier, ZoneHuntResult, ZoneLead } from "@/types/zone";

// ============================================================
// ZONE — pianifica il giro porta-a-porta delle card NFC recensioni.
// Tocca la mappa per fissare il centro, regola il raggio, "Cerca in
// zona": le attività del cerchio ordinate dalla più attenta alle
// recensioni alla meno attenta. Lista copiabile / CSV per il giro.
// ============================================================

const TIER_LABEL: Record<CareTier, string> = {
  molto_attento: "Molto attento",
  attento: "Attento",
  tiepido: "Tiepido",
};

const TIER_CHIP: Record<CareTier, string> = {
  molto_attento: "bg-success/15 text-success border-success/40",
  attento: "bg-ochre/15 text-ochre border-ochre/40",
  tiepido: "bg-surface2 text-text2 border-border",
};

/** Colori pin Leaflet (hex fissi: i CSS var non arrivano al canvas). */
const TIER_HEX: Record<CareTier, string> = {
  molto_attento: "#4ade80",
  attento: "#eab308",
  tiepido: "#8a8577",
};

const DEFAULT_CENTER: [number, number] = [41.117, 16.871]; // Bari
const RADIUS_MIN = 200;
const RADIUS_MAX = 3000;

function fmtRadius(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace(".0", "")} km` : `${m} m`;
}

function csvEscape(s: string): string {
  return /[";\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export default function ZoneConsole() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const markersRef = useRef<Map<string, import("leaflet").CircleMarker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(800);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<ZoneHuntResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // Mappa creata una sola volta al mount (stesso pattern di PipelineMap).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView(DEFAULT_CENTER, 13);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19 },
      ).addTo(map);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        setCenter([e.latlng.lat, e.latlng.lng]);
      });
      mapRef.current = map;
      if (!cancelled) setMapReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Cerchio zona: segue centro e raggio.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;
      if (!center) {
        circleRef.current?.remove();
        circleRef.current = null;
        return;
      }
      if (circleRef.current) {
        circleRef.current.setLatLng(center);
        circleRef.current.setRadius(radius);
      } else {
        circleRef.current = L.circle(center, {
          radius,
          color: "#c9a227",
          weight: 1.5,
          fillColor: "#c9a227",
          fillOpacity: 0.08,
        }).addTo(map);
      }
    })();
  }, [mapReady, center, radius]);

  // Pin dei risultati, colorati per attenzione. Il selezionato è più grande.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      for (const lead of result?.leads ?? []) {
        if (lead.lat == null || lead.lng == null) continue;
        const selected = lead.id === selectedId;
        const marker = L.circleMarker([lead.lat, lead.lng], {
          radius: selected ? 10 : 6,
          color: selected ? "#ffffff" : TIER_HEX[lead.care_tier],
          weight: selected ? 2 : 1,
          fillColor: TIER_HEX[lead.care_tier],
          fillOpacity: 0.85,
        })
          .addTo(map)
          .bindTooltip(`${lead.name} · ${lead.care_score}`, { direction: "top" })
          .on("click", () => setSelectedId(lead.id));
        markersRef.current.set(lead.id, marker);
      }
    })();
  }, [mapReady, result, selectedId]);

  const useMyPosition = useCallback(() => {
    if (!navigator.geolocation) {
      flash("Geolocalizzazione non disponibile su questo browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setCenter(c);
        mapRef.current?.setView(c, 15);
      },
      () => flash("Posizione negata: tocca la mappa per fissare il centro."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  async function hunt() {
    if (!center) return;
    setBusy(true);
    setError(null);
    setSelectedId(null);
    try {
      const res = await fetch("/api/hunt/zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: center[0], lng: center[1], radius }),
      });
      const json = (await res.json()) as ApiResponse<ZoneHuntResult>;
      if (!json.success || !json.data) {
        setError(json.error ?? "Caccia zona fallita.");
        setResult(null);
        return;
      }
      setResult(json.data);
      if (json.data.groups_failed.length > 0) {
        flash(`Zona letta (categorie saltate: ${json.data.groups_failed.join(", ")}).`);
      }
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  const selectLead = useCallback((lead: ZoneLead) => {
    setSelectedId(lead.id);
    if (lead.lat != null && lead.lng != null) {
      mapRef.current?.panTo([lead.lat, lead.lng]);
    }
  }, []);

  const listText = useMemo(() => {
    if (!result) return "";
    return result.leads
      .map(
        (l, i) =>
          `${i + 1}. ${l.name} [${l.care_score}] — ★${l.rating} (${l.reviews} rec.) — ${l.address}${l.phone ? ` — ${l.phone}` : ""}`,
      )
      .join("\n");
  }, [result]);

  async function copyList() {
    if (!listText) return;
    await navigator.clipboard.writeText(listText);
    flash("Lista giro copiata.");
  }

  function downloadCsv() {
    if (!result) return;
    const header = "nome;indice;voto;recensioni;categoria;indirizzo;telefono;maps";
    const rows = result.leads.map((l) =>
      [
        l.name,
        String(l.care_score),
        String(l.rating),
        String(l.reviews),
        l.category,
        l.address,
        l.phone,
        l.maps_url,
      ]
        .map(csvEscape)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "giro-zona.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const tierCounts = useMemo(() => {
    const c = { molto_attento: 0, attento: 0, tiepido: 0 };
    for (const l of result?.leads ?? []) c[l.care_tier]++;
    return c;
  }, [result]);

  return (
    <div className="space-y-4">
      {/* comandi zona */}
      <GlassCard className="flex flex-wrap items-center gap-3 px-4 py-3">
        <NeonButton size="sm" variant="cyan" onClick={useMyPosition}>
          <LocateFixed className="h-3.5 w-3.5" /> La mia posizione
        </NeonButton>
        <label className="flex items-center gap-2 font-ui text-xs text-text2">
          Raggio
          <input
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={100}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-36 accent-accent"
          />
          <span className="w-14 font-semibold text-text">{fmtRadius(radius)}</span>
        </label>
        <NeonButton
          size="sm"
          variant="amber"
          disabled={!center || busy}
          onClick={hunt}
        >
          <Crosshair className="h-3.5 w-3.5" />
          {busy ? "Scansione zona…" : "Cerca in zona"}
        </NeonButton>
        <p className="ml-auto font-ui text-xs text-text2">
          {center
            ? `centro ${center[0].toFixed(4)}, ${center[1].toFixed(4)}`
            : "tocca la mappa per fissare il centro del giro"}
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

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* mappa */}
        <GlassCard className="overflow-hidden p-0">
          <div ref={containerRef} className="h-[320px] w-full lg:h-[560px]" />
        </GlassCard>

        {/* lista giro */}
        <GlassCard className="flex max-h-[560px] flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="font-ui text-xs text-text2">
              {result ? (
                <>
                  <b className="text-text">{result.count}</b> attività ·{" "}
                  <span className="text-success">{tierCounts.molto_attento} top</span> ·{" "}
                  <span className="text-ochre">{tierCounts.attento} medi</span> ·{" "}
                  {tierCounts.tiepido} tiepidi
                </>
              ) : (
                "Nessuna scansione: fissa il centro e cerca."
              )}
            </div>
            {result && result.count > 0 && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={copyList}
                  title="Copia lista giro"
                  className="rounded-sm border border-border p-1.5 text-text2 hover:text-text"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  title="Scarica CSV"
                  className="rounded-sm border border-border p-1.5 text-text2 hover:text-text"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <ul ref={listRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
            {(result?.leads ?? []).map((l, i) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => selectLead(l)}
                  className={cn(
                    "w-full rounded-sm border px-3 py-2 text-left transition-colors",
                    l.id === selectedId
                      ? "border-accent/60 bg-accent/5"
                      : "border-border hover:bg-surface2",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-ui text-xs font-semibold text-text">
                      {i + 1}. {l.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-ui text-[10px] font-bold",
                        TIER_CHIP[l.care_tier],
                      )}
                      title={TIER_LABEL[l.care_tier]}
                    >
                      {l.care_score}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 font-ui text-[11px] text-text2">
                    <span className="shrink-0">
                      ★{l.rating} ({l.reviews})
                    </span>
                    <span className="truncate">
                      {l.category} · {l.address}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 font-ui text-[11px]">
                    {l.phone && (
                      <a
                        href={`tel:${l.phone.replace(/\s/g, "")}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <Phone className="h-3 w-3" /> {l.phone}
                      </a>
                    )}
                    <a
                      href={l.maps_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-text2 hover:text-text hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Maps
                    </a>
                  </div>
                </button>
              </li>
            ))}
            {result && result.count === 0 && (
              <li className="font-ui text-xs text-text2">
                Nessuna attività trovata nel cerchio: allarga il raggio.
              </li>
            )}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
