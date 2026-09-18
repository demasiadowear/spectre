import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import DiLato from "@/components/demo/DiLato";
import { leggiDossier } from "@/lib/collector/db";
import { getProjectBySlug } from "@/lib/factory/db";
import { briefDaDossier } from "@/lib/factory/brief";
import { fotoMostrabili } from "@/lib/demo/foto";
import { leggiPubblicata } from "@/lib/demo/proposte-db";
import { risolviSpec } from "@/lib/demo/pubblicazione";
import { scriviHeroMancante } from "@/lib/demo/telemetria-proposta";
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

  // La revisione PUBBLICATA, quando c'e. Contiene identita e non
  // indici: l'indice per l'URL della fotografia si risolve adesso, sul
  // manifest di adesso, e cosi una raccolta che riordina le stesse dieci
  // immagini non sposta niente in pagina.
  //
  // Se una fotografia approvata non c'e piu, viene SALTATA e non
  // sostituita. Finche nessuno ha approvato niente, la pagina si compone
  // come prima: una demo gia data a qualcuno non smette di funzionare
  // perche e comparso un flusso di approvazione.
  const spec = await leggiPubblicata(progetto.id);
  const curata = risolviSpec(spec, foto);
  const inPagina = spec && curata.foto.length > 0 ? curata.foto : foto;

  // L'apertura approvata non e piu servibile.
  //
  // Una fotografia di galleria che sparisce si salta e la composizione
  // regge. L'apertura no: e l'unica posizione in cui saltare vorrebbe
  // dire far salire un'altra fotografia, e quella scelta non la puo
  // prendere un programma. Quindi la pagina si apre con il nome, resta
  // raggiungibile, e lo dichiara nei log — perche questo guasto e
  // invisibile: la demo risponde 200 e sembra a posto.
  //
  // Non fa partire nessuna analisi. Una pagina pubblica che innesca una
  // fase a pagamento e un modo di far spendere a chiunque abbia lo slug.
  const aperturaTestuale = Boolean(spec) && curata.apertura_mancante;
  if (aperturaTestuale) {
    scriviHeroMancante({
      project_id: progetto.id,
      lead_id: progetto.lead_id,
      proposal_revision: spec?.proposal_revision ?? "",
      foto_in_pagina: curata.foto.length,
      foto_mancanti: curata.mancanti.length,
    });
  }

  return (
    <div className={`${display.variable} ${ui.variable}`}>
      <DiLato
        brief={brief}
        foto={inPagina}
        apertura={apertura}
        recensioni={recensioni}
        aperturaTestuale={aperturaTestuale}
      />
    </div>
  );
}
