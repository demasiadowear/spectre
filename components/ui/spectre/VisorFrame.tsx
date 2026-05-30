/** Thin technical HUD frame rendered at the screen edges (military-visor look). */
export default function VisorFrame() {
  const corner = "absolute h-6 w-6 text-spectre-cyan/30";
  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Corner brackets */}
      <svg className={`${corner} left-3 top-3`} viewBox="0 0 24 24" fill="none">
        <path d="M1 9V1H9" stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg className={`${corner} right-3 top-3`} viewBox="0 0 24 24" fill="none">
        <path d="M23 9V1H15" stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg className={`${corner} bottom-3 left-3`} viewBox="0 0 24 24" fill="none">
        <path d="M1 15V23H9" stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg className={`${corner} bottom-3 right-3`} viewBox="0 0 24 24" fill="none">
        <path d="M23 15V23H15" stroke="currentColor" strokeWidth="1" />
      </svg>

      {/* Edge labels */}
      <span className="absolute left-1/2 top-2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.4em] text-spectre-cyan/25">
        AYRO · SPECTRE · OS
      </span>
      <span className="absolute bottom-2 right-12 font-mono text-[9px] uppercase tracking-[0.3em] text-spectre-cyan/20">
        v1.0 // shadow protocol
      </span>

      {/* Side ticks */}
      <div className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-px w-2 bg-spectre-cyan/20"
            style={{ width: i % 2 === 0 ? 8 : 4 }}
          />
        ))}
      </div>
    </div>
  );
}
