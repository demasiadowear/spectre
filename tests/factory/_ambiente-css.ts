import Module from "node:module";

// ============================================================
// I CSS Module, resi importabili fuori da Next.
//
// `import stile from "./x.module.css"` sotto Node fa cadere il file al
// primo `.` del foglio di stile: Node non sa cosa sia un CSS. Senza
// questo, i componenti che hanno un foglio proprio non si possono
// rendere in un test — e sono proprio quelli la cui resa vale la pena
// verificare.
//
// L'oggetto restituito e un Proxy che risponde con la CHIAVE: `stile.hero`
// vale "hero". Quindi il markup reso porta nomi di classe leggibili, e
// un test puo chiedersi se la hero e in variante testuale guardando le
// classi invece di indovinarlo dalla struttura.
//
// Non e un mock del componente: il componente e quello vero. E un mock
// del compilatore CSS, che nei test non serve a niente.
// ============================================================

const nomiDiClasse = new Proxy({} as Record<string, string>, {
  get: (_t, k) => (typeof k === "string" ? k : undefined),
});

type ConEstensioni = { _extensions: Record<string, (m: NodeJS.Module, f: string) => void> };

(Module as unknown as ConEstensioni)._extensions[".css"] = (m) => {
  // `__esModule` esplicito: senza, l'interop di esbuild avvolge il
  // Proxy in `{ default: ... }` e `stile.hero` diventa `undefined`.
  (m as unknown as { exports: unknown }).exports = {
    __esModule: true,
    default: nomiDiClasse,
  };
};

export const CSS_PRONTO = true;
