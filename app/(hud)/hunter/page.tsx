import ModuleHeader from "@/components/layout/ModuleHeader";
import HunterConsole from "@/components/hunter/HunterConsole";

export default function HunterPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="06"
        label="Lead Hunter System"
        title="Hunter"
        subtitle="Target acquisition — scova PMI locali senza sito, calcola lo score di chiusura e genera lo script di cold call."
        accent="magenta"
      />
      <HunterConsole />
    </div>
  );
}
