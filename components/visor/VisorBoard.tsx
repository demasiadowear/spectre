"use client";

import { useEffect, useMemo, useState } from "react";
import { useHudStore } from "@/lib/store";
import { useVoiceStore } from "@/lib/voice/store";
import { PIPELINE_ORDER } from "@/lib/constants";
import HeatmapList from "./HeatmapList";
import NewLeadModal from "./NewLeadModal";
import PipelineColumn from "./PipelineColumn";
import QuickActions from "./QuickActions";
import type { ApiResponse, Lead, LeadStatus } from "@/types";

interface VisorBoardProps {
  initialLeads: Lead[];
}

/** Client orchestrator for the VISOR kanban + heatmap + actions. */
export default function VisorBoard({ initialLeads }: VisorBoardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const setHudStats = useHudStore((s) => s.setHudStats);

  const pendingAction = useVoiceStore((s) => s.pendingAction);
  const consumeAction = useVoiceStore((s) => s.consumeAction);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<LeadStatus | "">("");

  // Keep the HUD counters in sync with the board (always full set).
  useEffect(() => {
    const active = leads.filter(
      (l) => l.status !== "closed" && l.status !== "lost",
    );
    setHudStats({
      activeLeads: active.length,
      dealValueOpen: active.reduce((sum, l) => sum + l.value, 0),
    });
  }, [leads, setHudStats]);

  // Voice command bus: search by name / filter by status / refresh.
  useEffect(() => {
    if (!pendingAction || pendingAction.module !== "visor") return;
    const { kind, payload } = pendingAction;
    consumeAction();
    if (kind === "search") {
      setVoiceStatus("");
      setVoiceQuery(String(payload.query ?? ""));
    } else if (kind === "filter") {
      const s = String(payload.status ?? "");
      const valid: LeadStatus[] = [
        "cold",
        "warm",
        "hot",
        "proposal",
        "negotiation",
        "closed",
        "lost",
      ];
      setVoiceQuery("");
      setVoiceStatus(valid.includes(s as LeadStatus) ? (s as LeadStatus) : "");
    } else if (kind === "refresh") {
      void (async () => {
        try {
          const res = await fetch("/api/leads");
          const json = (await res.json()) as ApiResponse<Lead[]>;
          if (json.success && json.data) setLeads(json.data);
        } catch {
          /* ignore */
        }
      })();
    }
  }, [pendingAction, consumeAction]);

  const hasVoiceFilter = voiceQuery !== "" || voiceStatus !== "";
  const filteredLeads = useMemo(() => {
    if (!hasVoiceFilter) return leads;
    const q = voiceQuery.toLowerCase();
    return leads.filter((l) => {
      if (voiceStatus && l.status !== voiceStatus) return false;
      if (q && !`${l.name} ${l.company}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [leads, voiceQuery, voiceStatus, hasVoiceFilter]);

  const byStatus = useMemo(() => {
    const map: Record<LeadStatus, Lead[]> = {
      cold: [],
      warm: [],
      hot: [],
      proposal: [],
      negotiation: [],
      closed: [],
      lost: [],
    };
    for (const lead of filteredLeads) map[lead.status].push(lead);
    return map;
  }, [filteredLeads]);

  const handleDrop = async (id: string, status: LeadStatus) => {
    setDraggingId(null);
    const current = leads.find((l) => l.id === id);
    if (!current || current.status === status) return;
    const prevStatus = current.status;

    // Optimistic move.
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status } : l)),
    );

    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json: ApiResponse<Lead> = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error ?? "Aggiornamento fallito.");
      }
      const updated = json.data;
      setLeads((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch {
      // Revert on failure.
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: prevStatus } : l)),
      );
    }
  };

  return (
    <>
      <QuickActions onNewLead={() => setModalOpen(true)} />

      {hasVoiceFilter && (
        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-spectre-magenta">
            Filtro vocale: {voiceQuery || voiceStatus} · {filteredLeads.length}{" "}
            lead
          </span>
          <button
            type="button"
            onClick={() => {
              setVoiceQuery("");
              setVoiceStatus("");
            }}
            className="rounded-sm border border-spectre-magenta/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-spectre-magenta transition hover:bg-spectre-magenta/10"
          >
            ✕ pulisci
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="overflow-x-auto pb-3">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {PIPELINE_ORDER.map((status) => (
              <PipelineColumn
                key={status}
                status={status}
                leads={byStatus[status]}
                draggingId={draggingId}
                onDragStartCard={setDraggingId}
                onDragEndCard={() => setDraggingId(null)}
                onDropLead={handleDrop}
              />
            ))}
          </div>
        </div>

        <HeatmapList leads={filteredLeads} />
      </div>

      <NewLeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(lead) => setLeads((prev) => [lead, ...prev])}
      />
    </>
  );
}
