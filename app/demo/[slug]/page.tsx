import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import DiLato from "@/components/demo/DiLato";
import { leggiDossier } from "@/lib/collector/db";
import { getProjectBySlug } from "@/lib/factory/db";
import { briefDaDossier } from "@/lib/factory/brief";
import { fotoMostrabili } from "@/lib/demo/foto";
import { statoApertura } from "@/lib/demo/orari";
import { recensioniLive } from "@/lib/demo/recensioni";

// ============================================================
// La demo privata: /demo/<slug>.
//
// Tutto viene dal database a ogni richiesta — nome, indirizzo,
// telefono, orari, riferimenti fotografici — e il punteggio Google
// viene dal provider. Nel repository non c'e un dato di questa
// attivita: cambiare il dossier cambia la pagina, e i riferimenti
// fotografici di Places, che scadono, non possono restare vecchi.
//
// Lo slug a 22 caratteri da `crypto.randomBytes` E la credenziale: la
// pagina sta fuori dal middleware perche il prospect non ha una
// sessione. Uno slug sbagliato da 404 identico a uno inesistente, e
// non esiste nessun endpoint che elenchi slug, lead o progetti.
// ============================================================

export const dynamic = "force-dynamic";

const display = Newsreader({
  subsets: ["latin"], weight: ["300", "400"], style: ["normal", "italic"],
  variable: "--font-display", display: "swap",
});
const ui = Bricolage_Grotesque({
  subsets: ["latin"], weight: ["400", "500", "600"],
  variable: "--font-ui", display: "swap",
});

/** `noarchive` oltre a `noindex, nofollow`: non basta non comparire su
 *  Google, non deve nemmeno restarne una copia in cache. Questa pagina
 *  non deve MAI presentarsi al posto del sito del cliente. */
export const metadata: Metadata = {
  title: "Anteprima privata",
  robots: {
    index: false, follow: false, nocache: true,
    googleBot: { index: false, follow: false, noarchive: true, nosnippet: true },
  },
};

const SLUG = /^[A-Za-z0-9_-]{22}$/;

const VISIBILI = new Set([
  "ready", "outreach_ready", "sent", "viewed", "replied",
  "appointment", "negotiating", "won", "client_approved",
]);

export default async function DemoPage({ params }: { params: { slug: string } }) {
  // Filtro di forma prima di toccare il database: uno slug malformato
  // non deve nemmeno produrre una query.
  if (!SLUG.test(params.slug || "")) notFound();

  const progetto = await getProjectBySlug(params.slug);
  if (!progetto || !VISIBILI.has(progetto.stage)) notFound();

  const salvato = await leggiDossier(progetto.lead_id);
  if (!salvato?.dossier) notFound();

  const brief = briefDaDossier(salvato.dossier);
  // Senza nome non c'e pagina: e l'unico campo davvero indispensabile.
  if (!brief.nome) notFound();

  const foto = fotoMostrabili(salvato.dossier, params.slug);
  const apertura = statoApertura(brief.orari);
  const recensioni = await recensioniLive(salvato.dossier.place_id);

  return (
    <div className={`${display.variable} ${ui.variable}`}>
      <DiLato brief={brief} foto={foto} apertura={apertura} recensioni={recensioni} />
    </div>
  );
}
