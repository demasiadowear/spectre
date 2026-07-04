import { chromium, type Browser } from "playwright-core";

// ============================================================
// Launcher Chromium per gli scraper Intent.
// - Su Vercel: @sparticuz/chromium (binario linux serverless-ready,
//   unica combo che gira nelle functions) + playwright-core.
// - In locale: Chrome installato (INTENT_CHROME_PATH per override).
// Import dinamico di @sparticuz/chromium: il pacchetto spedisce solo
// il binario linux e in locale non deve nemmeno essere risolto.
// ============================================================

const LOCAL_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];

async function localExecutablePath(): Promise<string> {
  const override = process.env.INTENT_CHROME_PATH?.trim();
  if (override) return override;
  const { existsSync } = await import("node:fs");
  const found = LOCAL_CHROME_PATHS.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      "Chrome non trovato in locale: imposta INTENT_CHROME_PATH in .env.local",
    );
  }
  return found;
}

export async function launchIntentBrowser(): Promise<Browser> {
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

export const INTENT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
