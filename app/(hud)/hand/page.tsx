import ModuleHeader from "@/components/layout/ModuleHeader";
import HandWizard from "@/components/hand/HandWizard";
import { getLeads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function HandPage() {
  const leads = await getLeads();

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="02"
        label="Spectre Hand"
        title="Hand"
        subtitle="Generatore proposte — copy commerciale, pricing a tier, email ed export PDF."
        accent="amber"
      />
      <HandWizard leads={leads} />
    </div>
  );
}
