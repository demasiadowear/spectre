import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteRenderer from "@/components/factory/SiteRenderer";
import DemoViewPing from "@/components/factory/DemoViewPing";
import { getProjectBySlug } from "@/lib/factory/db";
import { validateSiteSpec } from "@/lib/factory/sitespec";

// ============================================================
// Demo pubblica /preview/[slug].
//
// Slug a 22 caratteri da crypto.randomBytes: non enumerabile, quindi
// non serve login (la route è esclusa dal middleware). `noindex,
// nofollow` a livello di metadata: la demo non deve MAI finire su
// Google al posto del sito del cliente.
//
// Visibile solo se il progetto ha passato il QA (stage >= ready):
// una demo con difetti non si mostra a nessuno.
// ============================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Anteprima sito",
  robots: { index: false, follow: false, nocache: true },
};

/** Fasi in cui la demo è mostrabile: il QA è già passato. */
const VISIBLE_STAGES = new Set([
  "ready",
  "outreach_ready",
  "sent",
  "viewed",
  "replied",
  "appointment",
  "negotiating",
  "won",
  "client_approved",
]);

export default async function PreviewPage({
  params,
}: {
  params: { slug: string };
}) {
  // Filtro di forma prima di toccare il DB: lo slug è base64url.
  if (!/^[A-Za-z0-9_-]{22}$/.test(params.slug || "")) notFound();

  const project = await getProjectBySlug(params.slug);
  if (!project || !project.spec) notFound();
  if (!VISIBLE_STAGES.has(project.stage)) notFound();

  // La spec salvata viene rivalidata a ogni render: una riga corrotta
  // a mano sul DB non può produrre una pagina rotta o insicura.
  const parsed = validateSiteSpec(project.spec);
  if (!parsed.ok || !parsed.value) notFound();

  return (
    <>
      <SiteRenderer spec={parsed.value} />
      <DemoViewPing slug={params.slug} />
    </>
  );
}
