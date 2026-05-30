import ModuleHeader from "@/components/layout/ModuleHeader";
import TerritoryMap from "@/components/territorio/TerritoryMap";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function TerritorioPage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="07"
        label="Spectre Territorio"
        title="Territorio"
        subtitle="Mappa reale dei lead — colorati per stato. Pianifica il giro porta-a-porta per zona."
        accent="cyan"
      />
      <TerritoryMap initialLeads={leads} />
    </div>
  );
}
