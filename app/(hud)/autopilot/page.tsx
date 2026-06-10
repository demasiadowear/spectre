import ModuleHeader from "@/components/layout/ModuleHeader";
import AutopilotConsole from "@/components/autopilot/AutopilotConsole";

export default function AutopilotPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="09"
        label="Autonomous Pipeline"
        title="Autopilot"
        subtitle="Lead -> studio -> contatto WA -> demo -> escalation. Coda messaggi da approvare, contatore outreach e kill switch globale."
        accent="amber"
      />
      <AutopilotConsole />
    </div>
  );
}
