"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  Bookmark,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  LocateFixed,
  MapPin,
  Nfc,
  Phone,
  Plus,
  RotateCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import ZoneClientSheet, { STATUS_CHIP, STATUS_LABEL } from "@/components/zone/ZoneClientSheet";
import { ZONE_CATEGORY_LABELS } from "@/lib/zone/categories";
import GlassCard from "@/components/ui/spectre/GlassCard";
import NeonButton from "@/components/ui/spectre/NeonButton";
import { cn } from "@/lib/utils";
import type { ApiResponse } from "@/types";
import type {
  OpportunityTier,
  ZoneHuntResult,
  ZoneLead,
  ZoneSavedSearch,
  ZoneSavedSearchFull,
  ZoneSearchFilters,
} from "@/types/zone";

// ============================================================
// ZONE — pianifica il giro porta-a-porta delle card NFC recensioni.
// Tocca la mappa per fissare il centro, regola il raggio, "Cerca in
// zona": le attività del cerchio ordinate per OPPORTUNITÀ — in cima
// chi ha più bisogno di recensioni (vendita facile), in fondo i
// saturi. Lista copiabile / CSV per il giro.
// ============================================================

const TIER_LABEL: Record<OpportunityTier, string> = {
  caldo: "Caldo: ha fame di recensioni",
  tiepido: "Tiepido",
  gia_a_posto: "Già a posto (o servizio debole)",
};

const TIER_CHIP: Record<OpportunityTier, string> = {
  caldo: "bg-success/15 text-success border-success/40",
  tiepido: "bg-ochre/15 text-ochre border-ochre/40",
  gia_a_posto: "bg-surface2 text-text2 border-border",
};

/** Colori pin Leaflet (hex fissi: i CSS var non arrivano al canvas). */
const TIER_HEX: Record<OpportunityTier, string> = {
  caldo: "#4ade80",
  tiepido: "#eab308",
  gia_a_posto: "#8a8577",
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
  const cleanupRef = useRef<(() => void) | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(800);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<ZoneHuntResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // filtri ricerca (vuoto/indefinito = nessun filtro)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cats, setCats] = useState<string[]>([]);
  const [revMin, setRevMin] = useState("");
  const [revMax, setRevMax] = useState("");
  const [ratMin, setRatMin] = useState("");
  const [ratMax, setRatMax] = useState("");
  // filtro rapido per fascia sui risultati (client-side, tempo reale)
  const [tierFilter, setTierFilter] = useState<OpportunityTier | "tutti">("tutti");
  // ricerca del centro per via/CAP
  const [addr, setAddr] = useState("");
  const [addrBusy, setAddrBusy] = useState(false);
  // scheda completa aperta da un risultato (anche se NON in registro)
  const [sheetLead, setSheetLead] = useState<ZoneLead | null>(null);
  // cache ricerche zona (risparmio API): elenco persistente + quale è
  // attualmente caricata (per mostrare "Aggiorna").
  const [saved, setSaved] = useState<ZoneSavedSearch[]>([]);
  const [savedOpen, setSavedOpen] = useState(true);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const activeFilters =
    cats.length + [revMin, revMax, ratMin, ratMax].filter(Boolean).length;

  const toggleCat = (label: string) =>
    setCats((prev) =>
      prev.includes(label) ? prev.filter((c) => c !== label) : [...prev, label],
    );

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
      // Il tab Registro nasconde la Caccia via CSS: al ritorno il
      // container passa da 0 alla sua taglia e Leaflet va risvegliato,
      // altrimenti tile grigie e click disallineati.
      const ro = new ResizeObserver(() => map.invalidateSize());
      ro.observe(containerRef.current!);
      cleanupRef.current = () => ro.disconnect();
      if (!cancelled) setMapReady(true);
    })();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
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

  const visibleLeads = useMemo(
    () =>
      (result?.leads ?? []).filter(
        (l) => tierFilter === "tutti" || l.tier === tierFilter,
      ),
    [result, tierFilter],
  );

  const tierCountsAll = useMemo(() => {
    const c = { caldo: 0, tiepido: 0, gia_a_posto: 0 };
    for (const l of result?.leads ?? []) c[l.tier]++;
    return c;
  }, [result]);

  // Link Google Maps con indicazioni verso l'attività. Origine
  // omessa: Google Maps parte dalla posizione corrente del telefono
  // ("dalla mia posizione") senza chiedere permessi alla nostra app.
  const navHref = useCallback((lead: ZoneLead) => {
    const dest =
      lead.lat != null && lead.lng != null
        ? `${lead.lat},${lead.lng}`
        : encodeURIComponent(lead.address || lead.name);
    const pid = encodeURIComponent(lead.id);
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${pid}&travelmode=driving`;
  }, []);

  // Contenuto del popup come DOM reale: info + Naviga + Copia NFC,
  // con click veri (bottoni Leaflet-in-stringa non li avrebbero).
  const buildPopup = useCallback(
    (L: typeof import("leaflet"), lead: ZoneLead): HTMLElement => {
      const el = L.DomUtil.create("div", "");
      el.style.cssText = "font-size:12px;line-height:1.45;min-width:200px";
      const esc = (t: string) =>
        t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      el.innerHTML = `
        <b style="font-size:13px">${esc(lead.name)}</b><br/>
        <span style="opacity:.7">${esc(lead.category)}</span> · indice <b>${lead.score}</b><br/>
        ★${lead.rating} (${lead.reviews} recensioni)<br/>
        <span style="opacity:.7">${esc(lead.address)}</span>
        <div style="display:flex;gap:6px;margin-top:8px">
          <a data-nav href="${navHref(lead)}" target="_blank" rel="noreferrer"
             style="flex:1;min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:4px;
                    border-radius:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;
                    font-weight:700;text-decoration:none;padding:8px">➤ Naviga</a>
          <button data-nfc type="button" ${lead.nfc_review_url ? "" : "disabled"}
             style="flex:1;min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:4px;
                    border-radius:4px;border:1px solid #16a34a;background:rgba(22,163,74,.12);color:#16a34a;
                    font-weight:700;padding:8px;cursor:pointer;${lead.nfc_review_url ? "" : "opacity:.4;cursor:not-allowed"}">
             ⧉ Copia NFC</button>
        </div>`;
      const nfcBtn = el.querySelector<HTMLButtonElement>("[data-nfc]");
      if (nfcBtn && lead.nfc_review_url) {
        L.DomEvent.on(nfcBtn, "click", (e) => {
          L.DomEvent.stop(e);
          void copyNfc(lead);
        });
      }
      // il link Naviga apre da solo (target _blank); fermo solo il
      // bubbling per non far scattare la selezione del marker sotto.
      const nav = el.querySelector<HTMLAnchorElement>("[data-nav]");
      if (nav) L.DomEvent.on(nav, "click", (e) => L.DomEvent.stopPropagation(e));
      return el;
    },
    // copyNfc usa solo flash+clipboard: stabile, fuori dalle deps a ragion veduta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navHref],
  );

  // Pin dei risultati, colorati per attenzione. Il selezionato è più grande.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      for (const lead of visibleLeads) {
        if (lead.lat == null || lead.lng == null) continue;
        const selected = lead.id === selectedId;
        const marker = L.circleMarker([lead.lat, lead.lng], {
          radius: selected ? 10 : 6,
          color: selected ? "#ffffff" : TIER_HEX[lead.tier],
          weight: selected ? 2 : 1,
          fillColor: TIER_HEX[lead.tier],
          fillOpacity: 0.85,
        })
          .addTo(map)
          // Popup-scheda operativa: info + bottoni Naviga / Copia NFC.
          // Costruito come DOM (non stringa) per agganciare i click veri.
          .bindPopup(buildPopup(L, lead), {
            minWidth: 210,
            closeButton: true,
            autoPan: true,
          })
          .on("click", () => setSelectedId(lead.id));
        markersRef.current.set(lead.id, marker);
      }
      // La selezione ricostruisce i marker (stile evidenziato): il
      // popup del selezionato va riaperto sull'istanza nuova, sia che
      // il click arrivi dal pin sia dalla riga in lista.
      if (selectedId) markersRef.current.get(selectedId)?.openPopup();
    })();
  }, [mapReady, visibleLeads, selectedId, buildPopup]);

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

  // Filtri correnti dalla UI (serializzabili per la cache).
  const currentFilters = useCallback(
    (): ZoneSearchFilters => ({
      categories: cats,
      reviews_min: revMin !== "" ? Number(revMin) : undefined,
      reviews_max: revMax !== "" ? Number(revMax) : undefined,
      rating_min: ratMin !== "" ? Number(ratMin) : undefined,
      rating_max: ratMax !== "" ? Number(ratMax) : undefined,
    }),
    [cats, revMin, revMax, ratMin, ratMax],
  );

  // Etichetta ricerca: via/CAP digitato, altrimenti il CAP prevalente
  // tra i risultati, altrimenti le coordinate del centro.
  function deriveLabel(lat: number, lng: number, r: ZoneHuntResult): string {
    if (addr.trim()) return addr.trim();
    const caps = new Map<string, number>();
    for (const l of r.leads) {
      const m = /\b(\d{5})\b/.exec(l.address);
      if (m) caps.set(m[1], (caps.get(m[1]) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [cap, n] of Array.from(caps.entries())) {
      if (n > bestN) {
        best = cap;
        bestN = n;
      }
    }
    return best || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  // La chiamata API vera e propria (spende quota Google). Ritorna i
  // risultati o null in caso d'errore (già segnalato).
  const runHunt = useCallback(
    async (lat: number, lng: number, r: number, f: ZoneSearchFilters): Promise<ZoneHuntResult | null> => {
      const res = await fetch("/api/hunt/zone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng, radius: r, ...f }),
      });
      const json = (await res.json()) as ApiResponse<ZoneHuntResult>;
      if (!json.success || !json.data) {
        setError(json.error ?? "Caccia zona fallita.");
        return null;
      }
      return json.data;
    },
    [],
  );

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/zone/searches", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<ZoneSavedSearch[]>;
      if (json.success && json.data) setSaved(json.data);
    } catch {
      /* la cache è un extra: un errore qui non blocca la Caccia */
    }
  }, []);

  // Carica l'elenco delle ricerche salvate all'apertura (cache API):
  // riaprendo SPECTRE la ricerca è già lì, zero chiamate a Google.
  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Ogni ricerca viene salvata in automatico (persistente su DB): se
  // riapro SPECTRE la ritrovo, zero API. Best-effort: se il salvataggio
  // fallisce la ricerca resta comunque visibile a schermo.
  const persistSearch = useCallback(
    async (lat: number, lng: number, r: number, f: ZoneSearchFilters, res: ZoneHuntResult) => {
      try {
        const save = await fetch("/api/zone/searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: deriveLabel(lat, lng, res), lat, lng, radius: r, filters: f, result: res }),
        });
        const json = (await save.json()) as ApiResponse<ZoneSavedSearch[]>;
        if (json.success && json.data) {
          setSaved(json.data);
          // la riga appena salvata (dedup su centro+raggio) è quella attiva
          const mine = json.data.find(
            (s) => Math.abs(s.lat - lat) < 1e-4 && Math.abs(s.lng - lng) < 1e-4 && s.radius === Math.round(r),
          );
          if (mine) setActiveSavedId(mine.id);
        }
      } catch {
        /* ignora: la ricerca è comunque a schermo */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addr],
  );

  async function hunt() {
    if (!center) return;
    setBusy(true);
    setError(null);
    setSelectedId(null);
    try {
      const f = currentFilters();
      const data = await runHunt(center[0], center[1], radius, f);
      if (!data) {
        setResult(null);
        return;
      }
      setResult(data);
      if (data.groups_failed.length > 0) {
        flash(`Zona letta (categorie saltate: ${data.groups_failed.join(", ")}).`);
      }
      await persistSearch(center[0], center[1], radius, f, data);
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  // "Riapri": mostra i risultati SALVATI, nessuna chiamata API.
  async function reopenSaved(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/zone/searches?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse<ZoneSavedSearchFull>;
      if (!json.success || !json.data) {
        flash(json.error ?? "Ricerca non trovata.");
        return;
      }
      const s = json.data;
      setCenter([s.lat, s.lng]);
      setRadius(s.radius);
      setCats(s.filters.categories ?? []);
      setRevMin(s.filters.reviews_min != null ? String(s.filters.reviews_min) : "");
      setRevMax(s.filters.reviews_max != null ? String(s.filters.reviews_max) : "");
      setRatMin(s.filters.rating_min != null ? String(s.filters.rating_min) : "");
      setRatMax(s.filters.rating_max != null ? String(s.filters.rating_max) : "");
      setResult(s.result);
      setActiveSavedId(s.id);
      setSelectedId(null);
      mapRef.current?.setView([s.lat, s.lng], 15);
      flash(`Ricerca "${s.label}" riaperta dalla cache (nessuna API).`);
    } catch {
      flash("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  // "Aggiorna": rifà la chiamata API SOLO su richiesta esplicita, e
  // aggiorna la ricerca salvata (dedup su centro+raggio).
  async function updateSaved(s: ZoneSavedSearch) {
    setBusy(true);
    setError(null);
    try {
      const data = await runHunt(s.lat, s.lng, s.radius, s.filters);
      if (!data) return;
      setCenter([s.lat, s.lng]);
      setRadius(s.radius);
      setResult(data);
      setActiveSavedId(s.id);
      await persistSearch(s.lat, s.lng, s.radius, s.filters, data);
      flash(`"${s.label}" aggiornata da Google.`);
    } catch {
      setError("Errore di rete.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaved(id: string) {
    try {
      const res = await fetch(`/api/zone/searches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<ZoneSavedSearch[]>;
      if (json.success && json.data) {
        setSaved(json.data);
        if (activeSavedId === id) setActiveSavedId(null);
      }
    } catch {
      flash("Errore di rete.");
    }
  }

  async function importLead(l: ZoneLead) {
    try {
      const res = await fetch("/api/zone/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: l.id,
          name: l.name,
          category: l.category,
          address: l.address,
          phone: l.phone,
          lat: l.lat,
          lng: l.lng,
          maps_url: l.maps_url,
          nfc_review_url: l.nfc_review_url ?? "",
          rating: l.rating,
          reviews: l.reviews,
        }),
      });
      const json = (await res.json()) as ApiResponse<{ status?: string }>;
      if (!json.success) {
        flash(`Errore: ${json.error ?? "import fallito"}`);
        return;
      }
      // il badge "in registro" si accende subito sul risultato
      setResult((prev) =>
        prev
          ? {
              ...prev,
              leads: prev.leads.map((x) =>
                x.id === l.id
                  ? { ...x, saved_status: x.saved_status ?? "da_visitare" }
                  : x,
              ),
            }
          : prev,
      );
      flash(`${l.name} nel Registro (da visitare).`);
    } catch {
      flash("Errore di rete durante l'import.");
    }
  }

  async function copyNfc(l: ZoneLead) {
    if (!l.nfc_review_url) return;
    await navigator.clipboard.writeText(l.nfc_review_url);
    flash(`Link NFC di ${l.name} copiato: incollalo su NFC Tools.`);
  }

  // Ricerca centro per via o CAP: Text Search (stessa API della
  // ricerca clienti) -> primo risultato -> centro del giro.
  async function goToAddress() {
    const q = addr.trim();
    if (!q) return;
    setAddrBusy(true);
    try {
      const query = /^\d{5}$/.test(q) ? `${q} Italia` : q;
      const res = await fetch("/api/zone/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, city: "" }),
      });
      const json = (await res.json()) as ApiResponse<ZoneLead[]>;
      const hit = json.success ? json.data?.find((c) => c.lat != null && c.lng != null) : null;
      if (!hit) {
        flash(`Indirizzo non trovato: "${q}". Prova con via e città.`);
        return;
      }
      const c: [number, number] = [hit.lat!, hit.lng!];
      setCenter(c);
      mapRef.current?.setView(c, 15);
      flash(`Centro fissato: ${hit.address || hit.name}`);
    } catch {
      flash("Errore di rete nella ricerca indirizzo.");
    } finally {
      setAddrBusy(false);
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
    return visibleLeads
      .map(
        (l, i) =>
          `${i + 1}. ${l.name} [${l.score}] — ★${l.rating} (${l.reviews} rec.) — ${l.address}${l.phone ? ` — ${l.phone}` : ""}`,
      )
      .join("\n");
  }, [result, visibleLeads]);

  async function copyList() {
    if (!listText) return;
    await navigator.clipboard.writeText(listText);
    flash("Lista giro copiata.");
  }

  function downloadCsv() {
    if (!result) return;
    const header = "nome;indice;voto;recensioni;categoria;indirizzo;telefono;maps";
    const rows = visibleLeads.map((l) =>
      [
        l.name,
        String(l.score),
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

  return (
    <div className="space-y-4">
      {/* comandi zona */}
      <GlassCard className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-4">
        <div className="flex items-center gap-2">
          <NeonButton size="sm" variant="cyan" onClick={useMyPosition} className="min-h-[44px]">
            <LocateFixed className="h-3.5 w-3.5" /> La mia posizione
          </NeonButton>
        </div>
        <span className="flex items-center gap-1.5">
          <input
            placeholder="…o via / CAP"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && goToAddress()}
            className="min-h-[44px] w-full min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 py-2 font-ui text-sm text-text placeholder:text-text2/60 focus:border-accent focus:outline-none sm:w-52 sm:flex-none sm:text-xs"
          />
          <NeonButton size="sm" disabled={addrBusy || !addr.trim()} onClick={goToAddress} className="min-h-[44px] shrink-0">
            <MapPin className="h-3.5 w-3.5" /> {addrBusy ? "…" : "Vai"}
          </NeonButton>
        </span>
        <label className="flex items-center gap-2 font-ui text-xs text-text2">
          Raggio
          <input
            type="range"
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            step={100}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="h-6 flex-1 accent-accent sm:w-36 sm:flex-none"
          />
          <span className="w-14 shrink-0 font-semibold text-text">{fmtRadius(radius)}</span>
        </label>
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm border px-3 py-2 font-ui text-xs font-semibold transition-colors",
            filtersOpen || activeFilters > 0
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-border text-text2 hover:text-text",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtri{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </button>
        <NeonButton
          size="sm"
          variant="amber"
          disabled={!center || busy}
          onClick={hunt}
          className="min-h-[44px] w-full justify-center sm:ml-auto sm:w-auto"
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

      {filtersOpen && (
        <GlassCard className="space-y-3 px-4 py-3">
          <div>
            <p className="mb-1.5 font-ui text-[10px] uppercase tracking-widest text-text2">
              Categorie (nessuna selezione = tutte)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ZONE_CATEGORY_LABELS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleCat(label)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold transition-colors",
                    cats.includes(label)
                      ? "border-accent/60 bg-accent/15 text-accent"
                      : "border-border text-text2 hover:text-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4 font-ui text-[11px] text-text2">
            <label className="flex items-center gap-1.5">
              Recensioni
              <input
                type="number"
                min={0}
                placeholder="min"
                value={revMin}
                onChange={(e) => setRevMin(e.target.value)}
                className="w-16 rounded-sm border border-border bg-surface px-1.5 py-1 text-text focus:border-accent focus:outline-none"
              />
              –
              <input
                type="number"
                min={0}
                placeholder="max"
                value={revMax}
                onChange={(e) => setRevMax(e.target.value)}
                className="w-16 rounded-sm border border-border bg-surface px-1.5 py-1 text-text focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5">
              Voto ★
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                placeholder="min"
                value={ratMin}
                onChange={(e) => setRatMin(e.target.value)}
                className="w-16 rounded-sm border border-border bg-surface px-1.5 py-1 text-text focus:border-accent focus:outline-none"
              />
              –
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                placeholder="max"
                value={ratMax}
                onChange={(e) => setRatMax(e.target.value)}
                className="w-16 rounded-sm border border-border bg-surface px-1.5 py-1 text-text focus:border-accent focus:outline-none"
              />
            </label>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCats([]);
                  setRevMin("");
                  setRevMax("");
                  setRatMin("");
                  setRatMax("");
                }}
                className="font-semibold text-text2 underline hover:text-text"
              >
                Azzera filtri
              </button>
            )}
          </div>
        </GlassCard>
      )}

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

      {/* Ricerche salvate (cache anti-spesa API) */}
      {saved.length > 0 && (
        <GlassCard className="px-3 py-3 sm:px-4">
          <button
            type="button"
            onClick={() => setSavedOpen((v) => !v)}
            className="flex w-full items-center justify-between font-ui text-[10px] uppercase tracking-[0.18em] text-text2"
          >
            <span className="inline-flex items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5" /> Ricerche salvate ({saved.length})
            </span>
            <span className="text-text2">{savedOpen ? "nascondi" : "mostra"}</span>
          </button>
          {savedOpen && (
            <ul className="mt-2 space-y-1.5">
              {saved.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-sm border p-2 font-ui text-xs",
                    activeSavedId === s.id ? "border-accent/50 bg-accent/5" : "border-surface2",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <b className="text-text">{s.label}</b>
                    <span className="text-text2">
                      {" "}
                      · {s.count} attività · {fmtRadius(s.radius)} · {s.updated_at.slice(0, 10)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <NeonButton size="sm" onClick={() => reopenSaved(s.id)} disabled={busy}>
                      <ExternalLink className="h-3.5 w-3.5" /> Riapri
                    </NeonButton>
                    <button
                      type="button"
                      title="Aggiorna da Google (spende API)"
                      onClick={() => updateSaved(s)}
                      disabled={busy}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-sm border border-ochre/40 px-2 font-semibold text-ochre hover:bg-ochre/10 disabled:opacity-40"
                    >
                      <RotateCw className="h-3.5 w-3.5" /> Aggiorna
                    </button>
                    <button
                      type="button"
                      title="Elimina ricerca salvata"
                      onClick={() => deleteSaved(s.id)}
                      className="inline-flex min-h-[36px] items-center rounded-sm border border-danger/40 px-2 text-danger hover:bg-danger/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 font-ui text-[10px] text-text2">
            Riapri mostra i risultati salvati senza chiamare Google. Aggiorna rifà la ricerca
            (spende API) solo quando lo chiedi tu.
          </p>
        </GlassCard>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        {/* mappa */}
        <GlassCard className="overflow-hidden p-0">
          <div ref={containerRef} className="h-[300px] w-full sm:h-[380px] lg:h-[560px]" />
        </GlassCard>

        {/* lista giro */}
        <GlassCard className="flex flex-col p-4 lg:max-h-[560px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="font-ui text-xs text-text2">
              {result ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: "tutti", label: `Tutti (${result.count})`, cls: "border-accent/60 bg-accent/10 text-accent" },
                      { id: "caldo", label: `Caldi (${tierCountsAll.caldo})`, cls: TIER_CHIP.caldo },
                      { id: "tiepido", label: `Tiepidi (${tierCountsAll.tiepido})`, cls: TIER_CHIP.tiepido },
                      { id: "gia_a_posto", label: `A posto (${tierCountsAll.gia_a_posto})`, cls: TIER_CHIP.gia_a_posto },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTierFilter(t.id as OpportunityTier | "tutti")}
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-ui text-[10px] font-semibold transition-colors",
                        tierFilter === t.id ? t.cls : "border-border text-text2 hover:text-text",
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </span>
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
            {visibleLeads.map((l, i) => (
              <li key={l.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    selectLead(l);
                    setSheetLead(l);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && setSheetLead(l)}
                  className={cn(
                    "w-full cursor-pointer rounded-sm border px-3 py-2 text-left transition-colors",
                    l.id === selectedId
                      ? "border-accent/60 bg-accent/5"
                      : "border-border hover:bg-surface2",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-ui text-xs font-semibold text-text">
                      {i + 1}. {l.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {l.saved_status && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 font-ui text-[10px]",
                            STATUS_CHIP[l.saved_status],
                          )}
                          title="Già nel Registro"
                        >
                          ✓ {STATUS_LABEL[l.saved_status]}
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 font-ui text-[10px] font-bold",
                          TIER_CHIP[l.tier],
                        )}
                        title={TIER_LABEL[l.tier]}
                      >
                        {l.score}
                      </span>
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 font-ui text-[11px]">
                    {!l.saved_status && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          importLead(l);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-sm border border-accent/50 bg-accent/10 px-3 py-2 font-semibold text-accent hover:bg-accent/20"
                      >
                        <Plus className="h-3.5 w-3.5" /> Registro
                      </button>
                    )}
                    {l.nfc_review_url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyNfc(l);
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-sm border border-success/50 bg-success/10 px-3 py-2 font-semibold text-success hover:bg-success/20"
                      >
                        <Nfc className="h-3.5 w-3.5" /> Copia NFC
                      </button>
                    )}
                    {l.phone && (
                      <a
                        href={`tel:${l.phone.replace(/\s/g, "")}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex min-h-[40px] items-center gap-1 text-accent hover:underline"
                      >
                        <Phone className="h-3.5 w-3.5" /> {l.phone}
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
                </div>
              </li>
            ))}
            {result && result.count === 0 && (
              <li className="font-ui text-xs text-text2">
                Nessuna attività trovata nel cerchio: allarga il raggio.
              </li>
            )}
            {result && result.count > 0 && visibleLeads.length === 0 && (
              <li className="font-ui text-xs text-text2">
                Nessuna attività in questa fascia: cambia filtro.
              </li>
            )}
          </ul>
        </GlassCard>
      </div>

      {/* scheda completa dal risultato — anche se NON in registro */}
      {sheetLead && (
        <ZoneClientSheet
          clientId={sheetLead.id}
          previewLead={sheetLead}
          onClose={() => setSheetLead(null)}
          onChanged={() => {
            // dopo un'azione dalla scheda il lead è (o resta) in registro:
            // accendi il badge sul risultato senza rifare lo scan
            setResult((prev) =>
              prev
                ? {
                    ...prev,
                    leads: prev.leads.map((x) =>
                      x.id === sheetLead.id
                        ? { ...x, saved_status: x.saved_status ?? "da_visitare" }
                        : x,
                    ),
                  }
                : prev,
            );
          }}
        />
      )}
    </div>
  );
}
