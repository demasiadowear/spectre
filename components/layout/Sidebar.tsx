"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Eye,
  LayoutDashboard,
  AudioLines,
  Hand,
  Gauge,
  Map as MapIcon,
  TrendingUp,
  Crosshair,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/visor", label: "Visor", icon: Eye },
  { href: "/cockpit", label: "Cockpit", icon: LayoutDashboard },
  { href: "/hunter", label: "Hunter", icon: Crosshair },
  { href: "/whisper", label: "Whisper", icon: AudioLines },
  { href: "/hand", label: "Hand", icon: Hand },
  { href: "/oracle", label: "Oracle", icon: Gauge },
  { href: "/territorio", label: "Territorio", icon: MapIcon },
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
];

interface SidebarProps {
  /** When false (dev bypass), the logout control is hidden. */
  authEnabled?: boolean;
}

export default function Sidebar({ authEnabled = false }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="z-30 flex w-16 shrink-0 flex-col items-center border-r border-border bg-surface py-4 backdrop-blur-xl">
      {/* Brand mark */}
      <Link
        href="/visor"
        className="mb-6 flex h-9 w-9 items-center justify-center border border-spectre-cyan/40 text-spectre-cyan shadow-neon-cyan"
        aria-label="SPECTRE home"
      >
        <span className="font-display text-lg font-bold leading-none">S</span>
      </Link>

      <div className="flex flex-1 flex-col gap-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className={cn(
                "group relative flex h-10 w-10 items-center justify-center rounded-sm border transition-all duration-200",
                active
                  ? "border-spectre-cyan/50 bg-spectre-cyan/10 text-spectre-cyan shadow-neon-cyan"
                  : "border-transparent text-spectre-muted hover:border-spectre-magenta/40 hover:text-spectre-magenta hover:shadow-neon-magenta",
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
              {active && (
                <span className="absolute -left-[1px] top-1/2 h-5 w-[2px] -translate-y-1/2 bg-spectre-cyan shadow-neon-cyan" />
              )}
              {/* hover tooltip */}
              <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded-sm border border-border bg-scrim/80 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-spectre-text opacity-0 backdrop-blur transition-opacity duration-150 group-hover:opacity-100">
                {label}
              </span>
            </Link>
          );
        })}
      </div>

      {authEnabled && (
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          aria-label="Disconnetti"
          className="group relative mt-2 flex h-10 w-10 items-center justify-center rounded-sm border border-transparent text-spectre-muted transition-all duration-200 hover:border-spectre-magenta/40 hover:text-spectre-magenta hover:shadow-neon-magenta"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.5} />
          <span className="pointer-events-none absolute left-12 z-50 whitespace-nowrap rounded-sm border border-spectre-magenta/20 bg-scrim/80 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-spectre-text opacity-0 backdrop-blur transition-opacity duration-150 group-hover:opacity-100">
            Disconnetti
          </span>
        </button>
      )}
    </nav>
  );
}
