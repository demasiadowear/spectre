import Sidebar from "@/components/layout/Sidebar";
import HUDHeader from "@/components/ui/spectre/HUDHeader";
import VisorFrame from "@/components/ui/spectre/VisorFrame";
import { AUTH_DISABLED } from "@/lib/auth";

/** The authenticated HUD shell — chrome around every protected module. */
export default function HudLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <VisorFrame />
      <div className="relative z-10 flex h-screen">
        <Sidebar authEnabled={!AUTH_DISABLED} />
        <div className="flex min-w-0 flex-1 flex-col">
          <HUDHeader />
          <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
        </div>
      </div>
    </>
  );
}
