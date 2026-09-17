import { spawn } from "node:child_process";

// ============================================================
// Runner dei test. Esiste solo per impostare TSX_TSCONFIG_PATH in modo
// portabile: "VAR=x comando" non funziona su cmd.exe, e aggiungere
// cross-env per una variabile sola non vale una dipendenza in più.
//
// Serve tsconfig.test.json perché il tsconfig principale tiene jsx
// "preserve" (in build è Next a compilare il JSX): fuori da Next i
// componenti verrebbero compilati col runtime classico e cercherebbero
// un React in scope che non importano, e non devono importare.
// ============================================================

process.env.TSX_TSCONFIG_PATH ??= "./tsconfig.test.json";

const args = [
  "--import",
  "tsx",
  "--test",
  // Node fa lui l'espansione dei pattern: nessuna shell di mezzo.
  ...(process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["tests/**/*.test.ts", "tests/**/*.test.tsx"]),
];

const child = spawn(process.execPath, args, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
