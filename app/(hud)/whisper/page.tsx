import ModuleHeader from "@/components/layout/ModuleHeader";
import WhisperConsole from "@/components/whisper/WhisperConsole";

export default function WhisperPage() {
  return (
    <div className="animate-fade-up">
      <ModuleHeader
        index="03"
        label="Spectre Whisper"
        title="Whisper"
        subtitle="Assistente real-time per call — transcript live e contro-risposte alle obiezioni."
        accent="magenta"
      />
      <WhisperConsole />
    </div>
  );
}
