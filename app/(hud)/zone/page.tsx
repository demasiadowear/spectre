import ModuleHeader from "@/components/layout/ModuleHeader";
import ZoneConsole from "@/components/zone/ZoneConsole";

export default function ZonePage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="09"
        label="NFC Review Cards"
        title="Zone"
        subtitle="Giro porta-a-porta — disegna il cerchio della zona, trova le attività più attente alle recensioni e battile in ordine."
        accent="green"
      />
      <ZoneConsole />
    </div>
  );
}
