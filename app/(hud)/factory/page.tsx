import ModuleHeader from "@/components/layout/ModuleHeader";
import FactoryConsole from "@/components/factory/FactoryConsole";

export default function FactoryPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="10"
        label="Autonomous Website Factory"
        title="Factory"
        subtitle="Dal lead alla bozza di sito: analisi del sito attuale, generazione con dati verificati, controllo qualità e messaggio pronto. L'invio resta a mano."
        accent="cyan"
      />
      <FactoryConsole />
    </div>
  );
}
