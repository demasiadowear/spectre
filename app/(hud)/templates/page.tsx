import ModuleHeader from "@/components/layout/ModuleHeader";
import TemplatesManager from "@/components/templates/TemplatesManager";

export default function TemplatesPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="11"
        label="Template Manager"
        title="Templates"
        subtitle="Tutti i testi WA del sistema in un posto solo: Study e la Pipeline leggono da qui. Salva e vale subito ovunque, zero deploy."
        accent="cyan"
      />
      <TemplatesManager />
    </div>
  );
}
