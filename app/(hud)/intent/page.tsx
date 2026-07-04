import ModuleHeader from "@/components/layout/ModuleHeader";
import IntentBoard from "@/components/intent/IntentBoard";

export default function IntentPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="12"
        label="Intent Scout"
        title="Intent"
        subtitle="Aziende che hanno PUBBLICATO una richiesta per sito web o servizi digitali (AddLance + Freelanceboard). Score alto = contattare entro 1 ora."
        accent="cyan"
      />
      <IntentBoard />
    </div>
  );
}
