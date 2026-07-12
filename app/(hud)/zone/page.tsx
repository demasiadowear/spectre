import ModuleHeader from "@/components/layout/ModuleHeader";
import ZoneShell from "@/components/zone/ZoneShell";

export default function ZonePage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="09"
        label="NFC Review Cards"
        title="Zone"
        subtitle="Card NFC recensioni — caccia per zona sulla mappa e registro clienti del giro (vendite, card, richiami)."
        accent="green"
      />
      <ZoneShell />
    </div>
  );
}
