import ModuleHeader from "@/components/layout/ModuleHeader";
import OracleConsole from "@/components/oracle/OracleConsole";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function OraclePage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="04"
        label="Spectre Oracle"
        title="Oracle"
        subtitle="Previsione probabilità di chiusura — simulatore di prezzo, timing e bundle."
        accent="amber"
      />
      <OracleConsole leads={leads} />
    </div>
  );
}
