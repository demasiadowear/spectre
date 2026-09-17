# Grecale — rapporto di generazione

## Esito

Gli undici asset sono stati generati con lo strumento immagini integrato di
ChatGPT e verificati insieme tramite `contact-sheet.jpg`.

La serie mantiene lo stesso locale, temperatura colore, castagno, ceramica,
lino e registro documentario. Le due hero derivano dalla stessa scena madre.

## Provenienza e uso

- `source_type`: `generated`
- `synthetic`: `true`
- `allowed_scope`: `demo_only`
- autore/modello: OpenAI image generation, strumento integrato ChatGPT; il
  nome esatto del modello non è esposto dall'interfaccia
- data di generazione: 17 settembre 2026
- condizioni: [OpenAI Europe Terms of Use](https://openai.com/policies/terms-of-use/)

I Termini OpenAI aggiornati al 16 gennaio 2026 dichiarano che, nei rapporti
fra utente e OpenAI e nei limiti di legge, l'utente possiede l'Output. Il
manifest applica comunque il vincolo più restrittivo `demo_only`.

## Controlli eseguiti

- 11 file presenti con i nomi richiesti
- dimensioni esatte del manifest
- nessun testo, marchio o volto riconoscibile
- stessa famiglia di ceramiche e stesso piano di castagno
- temperatura e palette coerenti nella griglia completa
- hero verticale e orizzontale riconoscibili come lo stesso locale
- taglio centrale della tavolata utilizzabile su telefono
- checksum SHA-256 registrato per ogni file finale

## Deviazioni dichiarate

La scena madre mostra quattro sospensioni visibili invece delle tre richieste.
È stata conservata perché architettura, spazio negativo, luce e continuità fra
le due hero sono riusciti; Grecale è un concept inventato e il numero delle
lampade non rappresenta un fatto commerciale.

I file nella cartella `assets/` sono già alle dimensioni richieste. Gli
originali generati, prima del ricampionamento, sono conservati in `originals/`.
Claude deve produrre AVIF, WebP e `srcset` partendo preferibilmente dagli
originali, mantenendo focal point e mapping indicati nei JSON.
