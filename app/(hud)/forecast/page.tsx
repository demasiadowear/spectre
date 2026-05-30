import ModuleHeader from "@/components/layout/ModuleHeader";
import ForecastBoard from "@/components/forecast/ForecastBoard";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="06"
        label="Spectre Forecast"
        title="Forecast"
        subtitle="Proiezione cassa — pipeline pesata per probabilità, scenari e quanto manca al target."
        accent="green"
      />
      <ForecastBoard initialLeads={leads} />
    </div>
  );
}
