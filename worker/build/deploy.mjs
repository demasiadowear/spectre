// Prepara il sito demo da uno dei 5 template ayromex-templates-gallery
// (editoriale/classico/minimal/pop/mono) e lo deploya su Vercel preview
// (team christians-projects-7637c213). Ritorna l'URL della preview.
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const TEMPLATES_DIR = process.env.TEMPLATES_GALLERY_DIR ?? "";
const WORKDIR = process.env.BUILD_WORKDIR ?? "./.builds";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? "";
const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? "christians-projects-7637c213";

/** Copia il template e scrive manifest.json. Ritorna la dir del sito. */
export async function prepareSite(slug, template, manifest) {
  if (!TEMPLATES_DIR || !existsSync(join(TEMPLATES_DIR, template))) {
    throw new Error(
      `template "${template}" non trovato in TEMPLATES_GALLERY_DIR (${TEMPLATES_DIR || "non impostata"})`,
    );
  }
  const siteDir = join(WORKDIR, slug);
  await rm(siteDir, { recursive: true, force: true });
  await mkdir(WORKDIR, { recursive: true });
  await cp(join(TEMPLATES_DIR, template), siteDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
  });
  await writeFile(
    join(siteDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return siteDir;
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "info@demasiadowear.com",
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "AYROMEX",
        GIT_COMMITTER_EMAIL:
          process.env.GIT_AUTHOR_EMAIL ?? "info@demasiadowear.com",
        GIT_COMMITTER_NAME: process.env.GIT_AUTHOR_NAME ?? "AYROMEX",
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`)),
    );
  });
}

/** `vercel deploy` (preview) della dir del sito. Ritorna l'URL preview. */
export async function deployToVercel(siteDir, slug) {
  if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN mancante");
  const out = await run(
    "npx",
    [
      "vercel",
      "deploy",
      "--yes",
      "--token",
      VERCEL_TOKEN,
      "--scope",
      VERCEL_SCOPE,
      "--name",
      `demo-${slug}`.slice(0, 52),
    ],
    siteDir,
  );
  // L'ultima riga dello stdout di `vercel deploy` è l'URL della preview.
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  const url = lines.reverse().find((l) => l.startsWith("https://"));
  if (!url) throw new Error(`URL preview non trovato nell'output Vercel`);
  return url;
}
