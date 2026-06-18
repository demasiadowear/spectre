import ModuleHeader from "@/components/layout/ModuleHeader";
import AutopilotConsole from "@/components/autopilot/AutopilotConsole";

export default function AutopilotPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="09"
        label="Assisted Pipeline"
        title="Autopilot"
        subtitle="Lead -> studio -> contatto WhatsApp a mano (wa.me) -> risposta incollata -> triage + bozza suggerita -> trattativa. Nessun invio automatico."
        accent="amber"
      />
      <AutopilotConsole />
    </div>
  );
}
