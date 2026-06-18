import ModuleHeader from "@/components/layout/ModuleHeader";
import AutopilotConsole from "@/components/autopilot/AutopilotConsole";

export default function PipelinePage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="01"
        label="Sales Pipeline"
        title="Pipeline"
        subtitle="Da contattare → contattato → ha risposto → in trattativa → vinto/perso. Scout+Study preparano i lead, tu contatti a mano (wa.me), incolli le risposte: triage + bozza. Lista / Kanban / Mappa."
        accent="cyan"
      />
      <AutopilotConsole />
    </div>
  );
}
