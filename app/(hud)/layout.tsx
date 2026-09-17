import Sidebar from "@/components/layout/Sidebar";
import HUDHeader from "@/components/ui/spectre/HUDHeader";
import VisorFrame from "@/components/ui/spectre/VisorFrame";
import { AUTH_DISABLED } from "@/lib/auth";
import DevModeBanner from "@/components/layout/DevModeBanner";

/** The authenticated HUD shell — chrome around every protected module. */
export default function HudLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Il banner "auth aperta" avvisa l'OPERATORE, e sta qui e non nel
          layout radice: sulle pagine pubbliche (preview delle demo,
          report Detective) sarebbe un riferimento interno stampato
          addosso a una pagina che guarda un cliente. */}
      <DevModeBanner />
      <VisorFrame />
      <div className="relative z-10 flex h-screen">
        <Sidebar authEnabled={!AUTH_DISABLED} />
        <div className="flex min-w-0 flex-1 flex-col">
          <HUDHeader />
          <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
