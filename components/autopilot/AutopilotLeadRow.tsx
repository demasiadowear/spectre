"use client";

import { Archive, Check, MessageSquare, Search } from "lucide-react";
import { googleSearchHref } from "@/lib/pitch";
import { cn } from "@/lib/utils";
import type { AutopilotLead } from "@/types/autopilot";
import {
  HEAT_BADGE,
  STAGE_CHIP,
  lastAction,
  leadHeat,
  priceLabel,
  qualityLabel,
  stageLabel,
} from "./format";

export interface RowActions {
  onOpen: (lead: AutopilotLead, tab?: "chat") => void;
  onArchive: (leadId: string) => void;
}

interface Props extends RowActions {
  lead: AutopilotLead;
  busy: boolean;
}

// ============================================================
// Riga lead compatta — SOLO 4 elementi: nome+categoria, tier,
// stadio, ultima azione. Azioni rapide inline su hover (sempre
// visibili su mobile, dove l'hover non esiste). Max 2 righe.
// ============================================================

function QuickAction({
  label,
  icon: Icon,
  tone = "neutral",
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Check;
  tone?: "ok" | "no" | "neutral";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation(); // il click sulla riga apre il drawer
        onClick();
      }}
      className={cn(
        "flex items-center gap-1 rounded-sm border bg-surface px-2 py-1 font-ui text-[11px] transition-colors disabled:opacity-40",
        tone === "ok" && "border-success/50 text-success hover:bg-success/10",
        tone === "no" && "border-danger/40 text-danger hover:bg-danger/10",
        tone === "neutral" && "border-border text-text hover:bg-surface2",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default function AutopilotLeadRow({
  lead,
  busy,
  onOpen,
  onArchive,
}: Props) {
  return (
    <li
      onClick={() => onOpen(lead)}
      className="group flex cursor-pointer items-center gap-3 border-b border-surface2 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-surface2"
    >
      {/* 1. nome + categoria / 4. ultima azione */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-ui text-sm font-semibold text-text">
          {/* su mobile il chip di stadio è nascosto: resta il pallino colore */}
          <span
            className={cn(
              "mr-1.5 inline-block h-2 w-2 rounded-full align-middle sm:hidden",
              STAGE_CHIP[lead.stage],
            )}
            aria-label={stageLabel(lead)}
          />
          {lead.company}
          <span className="ml-1.5 font-normal text-text2">· {lead.category}</span>
        </p>
        <p className="truncate font-ui text-xs text-text2">
          {lastAction(lead)}
        </p>
      </div>

      {/* azioni rapide inline */}
      <div className="flex shrink-0 gap-1.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <QuickAction label="Apri" icon={MessageSquare} onClick={() => onOpen(lead, "chat")} />
        <QuickAction
          label="Cerca"
          icon={Search}
          onClick={() =>
            window.open(
              googleSearchHref(lead.company, lead.city),
              "_blank",
              "noopener,noreferrer",
            )
          }
        />
        {lead.stage !== "archiviato" && (
          <QuickAction label="Archivia" icon={Archive} tone="no" disabled={busy} onClick={() => onArchive(lead.lead_id)} />
        )}
      </div>

      {/* 2. tipo numero (mobile/fisso) + prezzo + qualità */}
      {lead.phone_type === "fisso" && (
        <span
          className="shrink-0 font-ui text-[12px] text-ochre"
          title="Numero fisso: niente WhatsApp"
          aria-label="numero fisso"
        >
          ☎
        </span>
      )}
      {lead.phone_type === "mobile" && (
        <span
          className="hidden shrink-0 font-ui text-[12px] sm:inline"
          title="Mobile: WhatsApp-abile"
          aria-label="mobile"
        >
          📱
        </span>
      )}
      {priceLabel(lead) && (
        <span className="shrink-0 rounded-sm border border-accent/50 px-1.5 py-0.5 font-ui text-[10px] font-bold text-accent">
          {priceLabel(lead)}
        </span>
      )}
      {qualityLabel(lead) && (
        <span
          className={cn(
            "hidden shrink-0 rounded-sm border px-1.5 py-0.5 font-ui text-[10px] font-semibold sm:inline",
            HEAT_BADGE[leadHeat(lead)],
          )}
          title="Qualità: stelle Google + recensioni"
        >
          {qualityLabel(lead)}
        </span>
      )}

      {/* 3. stadio pipeline */}
      <span
        className={cn(
          "hidden w-28 shrink-0 rounded-full px-2.5 py-1 text-center font-ui text-[11px] sm:block",
          STAGE_CHIP[lead.stage],
        )}
      >
        {stageLabel(lead)}
      </span>
    </li>
  );
}
