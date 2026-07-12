"use client";

import { useState } from "react";
import { BarChart3, Crosshair, Notebook } from "lucide-react";
import ZoneAnalytics from "@/components/zone/ZoneAnalytics";
import ZoneConsole from "@/components/zone/ZoneConsole";
import ZoneRegistry from "@/components/zone/ZoneRegistry";
import { cn } from "@/lib/utils";

// Tab del modulo Zone. La Caccia resta montata anche quando guardi
// il Registro (nascosta via CSS): i risultati dello scan non si
// perdono passando a segnare una vendita e tornando al giro.
type Tab = "caccia" | "registro" | "analisi";

export default function ZoneShell() {
  const [tab, setTab] = useState<Tab>("caccia");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-sm border border-border bg-surface p-1 font-ui text-xs font-semibold">
        {(
          [
            { id: "caccia", label: "Caccia", icon: Crosshair },
            { id: "registro", label: "Registro", icon: Notebook },
            { id: "analisi", label: "Analisi", icon: BarChart3 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 transition-colors",
              tab === id
                ? "bg-surface2 text-text"
                : "text-text2 hover:text-text",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className={tab === "caccia" ? "" : "hidden"}>
        <ZoneConsole />
      </div>
      {tab === "registro" && <ZoneRegistry />}
      {tab === "analisi" && <ZoneAnalytics />}
    </div>
  );
}
