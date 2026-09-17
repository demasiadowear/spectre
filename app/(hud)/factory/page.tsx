import ModuleHeader from "@/components/layout/ModuleHeader";
import FactoryConsole from "@/components/factory/FactoryConsole";
import CollectorSezione from "@/components/factory/CollectorSezione";

export default function FactoryPage() {
  return (
    <div className="animate-fade-up space-y-6">
      <ModuleHeader
        index="10"
        label="Autonomous Website Factory"
        title="Factory"
        subtitle="Dal lead alla bozza di sito: analisi del sito attuale, generazione con dati verificati, controllo qualità e messaggio pronto. L'invio resta a mano."
        accent="cyan"
      />
      {/* La raccolta viene prima della generazione, e sta in cima: non
          si genera un sito su dati che nessuno ha ancora guardato. */}
      <CollectorSezione />
      <FactoryConsole />
    </div>
  );
}
