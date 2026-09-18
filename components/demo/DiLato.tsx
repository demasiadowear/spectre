import type { Brief } from "@/lib/factory/brief";
import type { FotoDemo } from "@/lib/demo/foto";
import type { StatoApertura } from "@/lib/demo/orari";
import stile from "./di-lato.module.css";

// ============================================================
// Direzione «Di lato» — il nome dell'attivita reso struttura.
//
// «Collateral beauty» e la bellezza che si nota di fianco, senza
// cercarla. Quindi le fotografie non stanno mai al centro: entrano
// tagliate dai bordi, e il testo vive nello spazio che lasciano. Sotto
// la piega le sezioni alternano il lato d'ingresso, cosi l'idea
// diventa struttura invece di restare un effetto della prima videata.
//
// COSA NON C'E, E PERCHE. Niente servizi, niente descrizione, niente
// social, nessuna recensione citata: di questa attivita il dossier non
// li ha, e una pagina che li inventasse sarebbe piu piena e falsa. Non
// c'e nemmeno un titolo tipo «I nostri servizi» rimasto vuoto: un
// titolo senza contenuto e una promessa non mantenuta.
//
// Tutto e reso da un server component: la pagina e completa senza una
// riga di JavaScript. Il movimento sta in CSS e si spegne da solo con
// `prefers-reduced-motion`.
// ============================================================

/** Le tre lastre della hero. Il ruolo lo decide la FORMA, non un
 *  giudizio sul contenuto: il dossier dichiara `probable_role:
 *  unknown` per tutte e dieci, e fingere di sapere quale sia la foto
 *  «hero» sarebbe inventare un dato. Le piu alte reggono il taglio
 *  verticale, la piu larga sta in basso dove il taglio e orizzontale. */
function disponi(foto: FotoDemo[]): { hero: FotoDemo[]; resto: FotoDemo[] } {
  const perAltezza = foto.slice().sort((a, b) =>
    (b.altezza / (b.larghezza || 1)) - (a.altezza / (a.larghezza || 1)));
  const hero = perAltezza.slice(0, 3);
  const scelti = new Set(hero.map((f) => f.indice));
  return { hero, resto: foto.filter((f) => !scelti.has(f.indice)) };
}

/** Gli autori distinti, per l'attribuzione collettiva sotto la
 *  galleria. Places puo attribuire a persone diverse dalla titolare:
 *  vanno citate tutte, non solo la prima. */
function autori(foto: FotoDemo[]): string[] {
  const visti: string[] = [];
  for (const f of foto) {
    const a = (f.attribuzione || "").trim();
    if (a && visti.indexOf(a) === -1) visti.push(a);
  }
  return visti;
}

export interface DatiDemo {
  brief: Brief;
  foto: FotoDemo[];
  apertura: StatoApertura;
  /** Recuperato live da Places al momento della richiesta. `null`
   *  quando non e disponibile: allora il blocco sparisce del tutto,
   *  invece di lasciare un vuoto o un numero vecchio. */
  recensioni: { punteggio: number; totale: number } | null;
}

export default function DiLato({ brief, foto, apertura, recensioni }: DatiDemo) {
  const { hero, resto } = disponi(foto);
  const tel = brief.contatti.telefono.replace(/[^\d+]/g, "");
  const maps = brief.luogo.maps_url;
  const firme = autori(foto);

  return (
    <div className={stile.pagina}>
      <main className={stile.hero}>
        {hero.map((f, i) => (
          <figure key={f.indice} className={`${stile.lastra} ${stile[`l${i + 1}`]}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.src}
              alt=""
              width={f.larghezza}
              height={f.altezza}
              // La hero e sopra la piega: la prima si carica subito, le
              // altre due no. `fetchPriority` su una sola immagine, o
              // non significa niente.
              loading={i === 0 ? "eager" : "lazy"}
              fetchPriority={i === 0 ? "high" : "auto"}
              decoding="async"
            />
          </figure>
        ))}

        <div className={stile.titolo}>
          <h1>
            {brief.nome.replace(/\s+di\s+.*$/i, "")}
            <em>{(/\sdi\s+(.+)$/i.exec(brief.nome) ?? [])[0]?.trim() ?? ""}</em>
          </h1>
        </div>

        <p className={stile.sotto}>
          {brief.categoria} in {brief.luogo.indirizzo.replace(/,\s*\d{5}.*$/, "")}, a Bari.
          Su appuntamento.
        </p>

        <div className={stile.azioni}>
          <a className={stile.bottone} href={`tel:${tel}`}>
            Chiama {brief.contatti.telefono}
          </a>
          {maps && (
            <a className={`${stile.bottone} ${stile.vuoto}`} href={maps}
              target="_blank" rel="noopener noreferrer">
              Indicazioni su Google Maps
            </a>
          )}
        </div>

        {/* Prova sociale: solo se Places la restituisce adesso. Niente
            numero congelato nel codice, niente recensioni citate. */}
        {recensioni && maps && (
          <p className={stile.prova}>
            {recensioni.punteggio.toLocaleString("it-IT", { minimumFractionDigits: 1 })} su
            {" "}Google Maps · {recensioni.totale} recensioni —{" "}
            <a href={maps} target="_blank" rel="noopener noreferrer">scheda dell’attività</a>
          </p>
        )}

        {apertura.stato !== "sconosciuto" && (
          <p className={stile.adesso}>
            {apertura.stato === "aperto"
              ? <>Aperto ora, fino alle {apertura.fino}.</>
              : <>Chiuso ora. <span>Riapre {apertura.riapre}.</span></>}
          </p>
        )}
      </main>

      <section className={`${stile.sezione} ${stile.sx}`}>
        <h2>Quando</h2>
        <div className={stile.corpo}>
          <ul className={stile.orari}>
            {brief.orari.map((riga) => {
              const [g, v] = riga.split(/:\s*/, 2);
              const chiuso = /chiuso/i.test(v ?? "");
              return (
                <li key={riga} className={chiuso ? stile.chiuso : undefined}>
                  <span>{g}</span><span>{chiuso ? "chiuso" : v}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className={`${stile.sezione} ${stile.dx}`}>
        <h2>Dove</h2>
        <div className={stile.corpo}>
          <p className={stile.indirizzo}>{brief.luogo.indirizzo}</p>
          {/* Una CTA per ogni cosa che si puo davvero fare, e nessuna
              per quelle che non si possono: non c'e un modulo, perche
              non c'e un indirizzo email a cui scriverebbe. */}
          <p className={stile.nota}>
            Per un appuntamento si telefona. Non c’è un modulo di contatto
            perché non c’è un indirizzo a cui scriverebbe.
          </p>
        </div>
      </section>

      {resto.length > 0 && (
        <section className={stile.sezione}>
          <div className={stile.galleria}>
            {resto.map((f, i) => (
              // Un ritmo di quattro, non un'alternanza: sfalsare una
              // fotografia su due produce una zigzag meccanica, che e
              // solo un altro modo di essere uniformi.
              <figure key={f.indice}
                className={i % 4 === 1 ? stile.alta : i % 4 === 3 ? stile.bassa : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.src} alt="" width={f.larghezza} height={f.altezza}
                  loading="lazy" decoding="async" />
              </figure>
            ))}
          </div>
          <p className={stile.credito}>
            Fotografie da Google Maps{firme.length ? ` — ${firme.join(", ")}` : ""}.
          </p>
        </section>
      )}

      <footer className={stile.piede}>
        <p>
          {brief.nome} · {brief.luogo.indirizzo}
          {maps && <> · <a href={maps} target="_blank" rel="noopener noreferrer">Google Maps</a></>}
        </p>
        <p className={stile.avviso}>
          Anteprima privata, non indicizzata. Dati e fotografie da Google Maps.
        </p>
      </footer>
    </div>
  );
}
