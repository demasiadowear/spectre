# Backlog del Collector

Il Collector v1 è **approvato e congelato**. Si tocca solo per un difetto
bloccante dimostrato. Quello che segue è rinviato, non abbandonato.

---

## RemoteBrowserProvider — verifica social dietro accesso

**Stato:** nel backlog. Non si fa ora.

### Il limite, misurato

Sul primo lead reale la scoperta social arriva fino all'ultimo anello e
lì si ferma. La riga di produzione del 18/09, `collector_dossier_read`:

```
search_citations  13    search_resolved  13    search_profiles  4
social_confirmed_count  0
social_unverified_count 1
social_browser_required_count  3
search_outcome  candidates_unverified
```

Google Search cita, i reindirizzamenti del grounding si risolvono, i
profili si riconoscono. Tre su quattro non si aprono: Instagram,
Facebook e TikTok rispondono con un muro di accesso, quindi non si
estrae nessuno dei due segnali forti che servono a dire «è suo».

`RemoteBrowserProvider` esiste già come interfaccia in
`lib/collector/browser.ts`, e `richiedeBrowser()` sa riconoscere gli
host che lo pretendono. Manca il servizio dietro.

### Perché NON si fa adesso

Il valore che aggiungerebbe è alto ma **non blocca niente**: un profilo
non verificato non entra nel sito, e da quando
`commercial_recommendation` non dipende più dallo stato dei profili, non
declassa nemmeno il lead. Il collector produce già un dossier completo e
una valutazione corretta senza.

Quello che invece porterebbe con sé va deciso con calma, non di
conseguenza:

- **un servizio esterno** (Browserless, Cloudflare Browser Rendering o
  altro) significa una dipendenza in più sul percorso critico, una
  variabile d'ambiente nuova e una superficie di costo che oggi non
  esiste;
- **l'accesso con credenziali** a una piattaforma social è un'altra cosa
  ancora, e non è una decisione tecnica;
- **l'aggiramento dei CAPTCHA** è fuori discussione: è esattamente il
  «non aggirare blocchi» che vale da sempre in questo progetto.

### Quando riprenderlo

Quando la verifica social diventa il collo di bottiglia vero — cioè
quando i siti generati ne avranno bisogno per essere migliori, non solo
più completi. Allora la prima domanda è se basti un browser headless
senza credenziali su pagine pubbliche, che è il caso meno invasivo e
copre parte dei tre profili qui sopra.

### Quello che NON va fatto passare come «piccolo»

- aggiungere provider di ricerca (Serper, Brave): già escluso, e la
  ricerca grounded funziona;
- allentare i due segnali forti per «confermare» di più: la soglia è la
  cosa che impedisce di pubblicare l'Instagram di un altro sotto il nome
  del cliente;
- far dipendere di nuovo la decisione commerciale dai social.

---

## `google.com/search` classificato come `google_maps`

**Stato:** nel backlog. Non si riapre il Collector adesso.

Nel primo dossier reale, fra i candidati della ricerca grounded e
comparso `https://google.com/search`, e `piattaformaDi()` l'ha
etichettato `google_maps` invece che `altro`.

**Non fa danno oggi.** Quell'URL e finito `unverified_candidate` — zero
segnali, in nessuna direzione — quindi e escluso da tutto: non entra nel
sito, non tocca la decisione commerciale, compare solo nel dossier come
evidenza. L'etichetta sbagliata cambia una parola nel pannello.

**Va corretto quando si riapre il modulo**, insieme a una regola piu
generale: un URL senza un percorso di profilo non e un profilo, di
nessuna piattaforma. `google.com/search` non e una scheda Maps piu di
quanto `facebook.com` sia una pagina.
