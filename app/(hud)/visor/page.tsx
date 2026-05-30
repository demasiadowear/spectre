import ModuleHeader from "@/components/layout/ModuleHeader";
import VisorBoard from "@/components/visor/VisorBoard";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function VisorPage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="01"
        label="Spectre Visor"
        title="Visor"
        subtitle="Dashboard HUD — pipeline kanban, heatmap urgenza, azioni rapide."
        accent="cyan"
      />
      <VisorBoard initialLeads={leads} />
    </div>
  );
}
