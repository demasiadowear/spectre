import ModuleHeader from "@/components/layout/ModuleHeader";
import DetectiveBoard from "@/components/detective/DetectiveBoard";

export default function DetectivePage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="10"
        label="Audit Light Engine"
        title="Detective"
        subtitle="Indaga prospect CON sito da sole fonti pubbliche e produce il dossier 'dove stai perdendo soldi'. Invio sempre manuale: il worker WA non tocca questo funnel."
        accent="amber"
      />
      <DetectiveBoard />
    </div>
  );
}
