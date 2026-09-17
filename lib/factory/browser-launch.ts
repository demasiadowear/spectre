import { chromium, type Browser } from "playwright-core";

// ============================================================
// Launcher Chromium per il QA della Factory. Stessa combinazione
// già in uso in lib/intent/browser.ts (playwright-core +
// @sparticuz/chromium su Vercel, Chrome locale in sviluppo): modulo
// separato solo perché il QA non dipende dagli scraper Intent, non
// perché serva un secondo modo di avviare un browser.
//
// Le route che chiamano questo launcher devono comparire in
// `outputFileTracingIncludes` (next.config.mjs), altrimenti su Vercel
// i binari brotli non finiscono nella lambda e executablePath() salta.
// ============================================================

const LOCAL_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

async function localExecutablePath(): Promise<string> {
  // Si riusa la variabile già documentata per Intent: chi ha Chrome in
  // un percorso non standard l'ha impostata una volta e vale per tutti.
  const override =
    process.env.FACTORY_CHROME_PATH?.trim() || process.env.INTENT_CHROME_PATH?.trim();
  if (override) return override;
  const { existsSync } = await import("node:fs");
  const found = LOCAL_CHROME_PATHS.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "Chrome non trovato in locale: imposta FACTORY_CHROME_PATH (o INTENT_CHROME_PATH) in .env.local",
    );
  }
  return found;
}

export async function launchFactoryBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({
    executablePath: await localExecutablePath(),
    headless: true,
  });
}
