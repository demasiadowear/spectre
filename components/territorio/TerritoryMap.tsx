"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { LEAD_STATUS, PIPELINE_ORDER } from "@/lib/constants";
import LeadActionPanel from "@/components/visor/LeadActionPanel";
import type { Lead } from "@/types";

interface TerritoryMapProps {
  initialLeads: Lead[];
}

export default function TerritoryMap({ initialLeads }: TerritoryMapProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [selected, setSelected] = useState<Lead | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef(setSelected);
  selectRef.current = setSelected;

  const geoLeads = useMemo(
    () =>
      initialLeads.filter(
        (l) => typeof l.meta.lat === "number" && typeof l.meta.lng === "number",
      ),
    [initialLeads],
  );

  const closedCount = useMemo(
    () => leads.filter((l) => l.status === "closed").length,
    [leads],
  );

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || map) return;
      map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([41.117, 16.871], 11);

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { maxZoom: 19 },
      ).addTo(map);

      const pts: [number, number][] = [];
      for (const lead of geoLeads) {
        const lat = lead.meta.lat as number;
        const lng = lead.meta.lng as number;
        const hex = LEAD_STATUS[lead.status].hex;
        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          color: hex,
          fillColor: hex,
          fillOpacity: 0.85,
          weight: 1.5,
        }).addTo(map);
        marker.bindTooltip(lead.name, { direction: "top", offset: [0, -6] });
        marker.on("click", () => selectRef.current(lead));
        pts.push([lat, lng]);
      }
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [geoLeads]);

  function applyUpdate(updated: Lead) {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setSelected((cur) => (cur && cur.id === updated.id ? updated : cur));
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-sm border border-spectre-cyan/15">
        <div ref={containerRef} className="h-[68vh] min-h-[360px] w-full bg-spectre-ink" />

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col gap-1 rounded-sm border border-white/10 bg-black/70 p-2 backdrop-blur">
          {PIPELINE_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-spectre-muted">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: LEAD_STATUS[s].hex }} />
              {LEAD_STATUS[s].label}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-spectre-muted">
        {geoLeads.length}/{initialLeads.length} lead geolocalizzati · tocca un pin per aprire la scheda
      </p>

      {selected && (
        <LeadActionPanel
          lead={selected}
          closedCount={closedCount}
          onClose={() => setSelected(null)}
          onUpdate={applyUpdate}
        />
      )}
    </>
  );
}
