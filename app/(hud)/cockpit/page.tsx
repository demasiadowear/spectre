import ModuleHeader from "@/components/layout/ModuleHeader";
import CockpitBoard from "@/components/cockpit/CockpitBoard";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CockpitPage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="02"
        label="Spectre Cockpit"
        title="Cockpit"
        subtitle="Cosa fare ORA — coda azioni prioritaria su tutti i lead: urgenti, da chiudere, da contattare."
        accent="magenta"
      />
      <CockpitBoard initialLeads={leads} />
    </div>
  );
}
