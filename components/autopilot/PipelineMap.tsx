"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { AutopilotLead } from "@/types/autopilot";
import { AUTOPILOT_STAGES } from "@/lib/autopilot/constants";
import { STAGE_HEX, STAGE_LABELS } from "./format";

interface Props {
  leads: AutopilotLead[];
  onOpen: (lead: AutopilotLead) => void;
}

// ============================================================
// Vista Mappa della Pipeline (ex modulo Territorio, assorbito come
// tab). Pin colorati per stadio; tocca un pin per aprire la scheda.
// ============================================================
export default function PipelineMap({ leads, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").CircleMarker[]>([]);
  const firstFitDone = useRef(false);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [mapReady, setMapReady] = useState(false);

  const geoLeads = useMemo(
    () => leads.filter((l) => l.lat != null && l.lng != null),
    [leads],
  );

  // Crea la mappa UNA SOLA VOLTA al mount (deps [] — non su geoLeads).
  // Prima l'effetto dipendeva da geoLeads: essendo un nuovo array ad
  // ogni poll (30s) anche a parità di dati, l'intera mappa Leaflet
  // veniva distrutta e ricreata ogni volta, "lampeggiando" e buttando
  // via il pan/zoom fatto dall'utente.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([41.117, 16.871], 11);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map);
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

  // Ridisegna solo i marker quando cambiano i lead geolocalizzati.
  // `fitBounds` scatta solo la prima volta: sui poll successivi i
  // marker si aggiornano senza spostare la vista dell'utente.
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (cancelled || !map) return;

      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      const pts: [number, number][] = [];
      for (const lead of geoLeads) {
        const lat = lead.lat as number;
        const lng = lead.lng as number;
        const hex = STAGE_HEX[lead.stage] ?? "#8A877E";
        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          color: hex,
          fillColor: hex,
          fillOpacity: 0.85,
          weight: 1.5,
        }).addTo(map);
        marker.bindTooltip(lead.company, { direction: "top", offset: [0, -6] });
        marker.on("click", () => openRef.current(lead));
        markersRef.current.push(marker);
        pts.push([lat, lng]);
      }
      if (pts.length && !firstFitDone.current) {
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
        firstFitDone.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mapReady, geoLeads]);

  return (
    <div className="relative overflow-hidden rounded-sm border border-border">
      <div ref={containerRef} className="h-[68vh] min-h-[360px] w-full bg-spectre-ink" />

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col gap-1 rounded-sm border border-border bg-scrim/60 p-2 backdrop-blur">
        {AUTOPILOT_STAGES.filter((s) => s !== "archiviato").map((s) => (
          <span
            key={s}
            className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-spectre-muted"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_HEX[s] }} />
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>

      <p className="pointer-events-none absolute bottom-3 right-3 z-[500] font-mono text-[10px] text-spectre-muted">
        {geoLeads.length}/{leads.length} geolocalizzati · tocca un pin
      </p>
    </div>
  );
}
