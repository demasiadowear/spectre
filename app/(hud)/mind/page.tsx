import ModuleHeader from "@/components/layout/ModuleHeader";
import MindGraph from "@/components/mind/MindGraph";
import { getLeads, getMindEdges } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MindPage() {
  const [leads, edges] = await Promise.all([getLeads(), getMindEdges()]);

  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="05"
        label="Spectre Mind"
        title="Mind"
        subtitle="Grafo relazionale lead / contatti / clienti — network intelligence e scan connessioni nascoste."
        accent="green"
      />
      <MindGraph leads={leads} edges={edges} />
    </div>
  );
}
