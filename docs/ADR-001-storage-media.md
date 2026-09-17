# ADR-001 — I sorgenti media non stanno nel repository

**Stato:** accettata
**Data:** 2026-09-17
**Ambito:** Premium Website Factory, generazione siti, collector media

---

## Contesto

Per costruire Grecale come benchmark fotografico sono entrati nel
repository 11 PNG sorgente, 16 MB. La scelta era corretta *per quel
caso*: le immagini esistevano solo dentro un container effimero, il
manifest ne dichiarava i checksum, e senza i file quei checksum non
descrivono niente e il sito non e piu ricostruibile.

Non e corretta come regola generale. Un solo sito di benchmark pesa
16 MB di sorgenti piu 3,2 MB di varianti derivate piu 13 MB di
screenshot di verifica. La Factory e pensata per generare un sito per
lead: a poche centinaia di lead il repository diventa ingestibile, i
cloni impraticabili, e ogni rigenerazione di varianti produce un commit
binario che non si puo ne leggere ne fondere.

C'e anche un problema che non e di dimensione. Un binario in git e
per sempre: una fotografia entrata per errore, o con diritti che si
scoprono dopo insufficienti, resta nella storia anche se il commit
successivo la cancella. Per contenuti di terzi — che e esattamente
quello che il collector media raccogliera — questo non e accettabile.

## Decisione

1. **I PNG sorgente committati sono ammessi soltanto per Grecale**, in
   quanto benchmark di riferimento, e in quanto gia committati.

2. **Non si replica questo schema per nessun progetto generato.** Un
   sito prodotto dalla Factory non porta sorgenti nel repository.

3. **Non si porta niente di tutto questo su `main`** finche non esiste
   uno storage media esterno funzionante. Il benchmark resta sul suo
   ramo.

4. **Il repository conserva solo manifest e riferimenti:** identificatori,
   checksum, dimensioni, provenienza, diritti, ruolo, e la chiave con
   cui recuperare il file. Non i byte.

5. **Sorgenti, varianti e screenshot vanno in object storage**, con:
   - **checksum** come identita: la chiave dell'oggetto deriva dallo
     SHA-256 del contenuto, quindi lo stesso file non esiste due volte
     e un file cambiato e un file diverso, non una revisione;
   - **deduplicazione** esatta sullo SHA-256 e quasi-esatta sul
     perceptual hash, perche la stessa fotografia arriva dallo stesso
     locale via sito, via Maps e via Instagram con tre URL diversi;
   - **lifecycle**: le varianti derivate si rigenerano, quindi scadono;
     gli screenshot di verifica servono al ciclo di revisione e scadono;
     i sorgenti con `rights_status` diverso da `owned` o `authorized`
     scadono quando scade il permesso; `provider_display_only` rispetta
     la scadenza imposta dal provider e non sopravvive ad essa.

## Conseguenze

Il manifest diventa l'unica cosa versionata, ed e la cosa giusta da
versionare: e li che stanno provenienza, diritti e ambito d'uso, cioe
le informazioni su cui si prende una decisione. I byte sono
rigenerabili o ri-scaricabili; il permesso di usarli no.

Serve che lo storage esista prima di ogni altro lavoro sui media, e che
il collector ci scriva da subito: un collector che accumula file sul
disco locale "per ora" e un collector che dopo non si sposta piu.

Finche lo storage non c'e, il collector va scritto contro
un'interfaccia di archiviazione, con un'implementazione locale usata
solo nei test. Non si scrive codice che dia per scontato il filesystem.

## Alternative scartate

- **Git LFS.** Sposta il problema senza risolverlo: la dimensione
  smette di pesare sul clone, ma resta la storia immutabile, e per
  contenuti di terzi serve poter cancellare davvero.
- **Committare solo le varianti derivate.** Sono la parte rigenerabile:
  se si tiene qualcosa, si tiene il sorgente, non il derivato.
- **Non conservare i sorgenti.** Renderebbe impossibile rigenerare le
  varianti quando cambiano le larghezze dello srcset, e impossibile
  verificare a posteriori che un file non sia stato alterato.
