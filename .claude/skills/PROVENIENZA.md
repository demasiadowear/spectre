# Skill della Premium Website Factory — provenienza e licenze

Queste skill vivono nel repository e non sulla macchina di nessuno: il
runner cloud non vede `~/.claude/skills`, quindi una skill che sta solo
lì non esiste quando serve. Niente symlink, per lo stesso motivo.

## Copiate da monte

| Skill | Origine | Licenza | Modificata? |
|---|---|---|---|
| `frontend-design` | `/mnt/skills/public/frontend-design` (skill pubblica Anthropic distribuita con l'ambiente Claude) | **Apache 2.0** — `LICENSE.txt` copiata integralmente accanto alla skill | **No.** `SKILL.md` è byte per byte l'originale |

La licenza Apache 2.0 consente la ridistribuzione a condizione di
conservare licenza e attribuzione: entrambe sono qui. Nessuna modifica,
quindi non c'è nulla da dichiarare come cambiato.

## Scritte per questo repository

Tutte sotto la stessa licenza del repository. Portano conoscenza guadagnata
costruendo il gold standard, non riassunti di manuali:

| Skill | Cosa contiene che non troveresti altrove |
|---|---|
| `forge-creative-direction` | Il processo delle tre direzioni e i criteri per ucciderne una |
| `typography-editorial` | Assi delle variabili (Fraunces SOFT/WONK/opsz), testo italiano |
| `gsap-motion-design` | Il difetto `yPercent` che rende invisibile un titolo, e la regola del contenuto mai parcheggiato |
| `threejs-webgl-direction` | Quando **rifiutare** WebGL, con la misura che ha bocciato una direzione |
| `asset-art-direction` | Come reggere senza una sola fotografia |
| `responsive-mobile-first` | Bersagli di tocco, cosa togliere dal telefono |
| `visual-qa` | Il ciclo guarda-non-solo-misurare, e i falsi positivi dell'auditor |
| `performance-accessibility` | Cosa misurare quando Lighthouse non c'è |
| `conversion-copy` | Copy commerciale italiano senza affermazioni inventate |

## Non copiate, e perché

| Skill | Dove | Perché no |
|---|---|---|
| `brand-guidelines` | `/mnt/skills/examples/` | È l'identità di **Anthropic**. Applicarla ai siti dei clienti AYROMEX sarebbe sbagliato, e portarsela nel repo non serve |
| `web-artifacts-builder` | `/mnt/skills/examples/` | React + Tailwind + shadcn per artefatti claude.ai. Il nostro sito è Vite/vanilla, e shadcn è esattamente il "SaaS-card kit" che `frontend-design` elenca fra i cliché |
| `theme-factory` | `/mnt/skills/examples/` | Dieci temi preconfezionati. La Factory deve produrre identità su misura: un tema pronto è il contrario dell'obiettivo |
| `canvas-design` | `/mnt/skills/examples/` | Produce PNG e PDF statici (manifesti, poster), non pagine web |
| `algorithmic-art` | `/mnt/skills/examples/` | Arte generativa con p5.js. Pertinente in astratto — nessuna foto disponibile — ma p5 pesa ~900 KB per decorare, e il peso su telefono è il nemico. **Citata in `asset-art-direction` come strada da valutare**, non copiata |
| `paint` | `/mnt/skills/examples/` | Illustrazione ad acquerello via codice. Nessun legame col mestiere dei nostri soggetti |
| `built-in-browser`, `computer-use` | `/mnt/skills/examples/` | Il loro campo `compatibility` le limita all'app desktop con un computer collegato. Nel runner cloud non funzionerebbero |
| `docx`, `pdf`, `pptx`, `xlsx`, `file-reading` | `/mnt/skills/public/` | Documenti e fogli di calcolo. Caricarle per poter dire di averle usate sarebbe rumore |
| `skill-creator` | `/mnt/skills/examples/` | **Usata** per scrivere le skill qui sopra, ma è uno strumento di autore: non serve al runner che genera siti |

## Come verificare che siano scoperte

```
cd <repo> && claude -p "Elenca solo le skill della Premium Factory" --allowedTools ""
```

L'esito registrato è in `docs/CLAUDE_PREMIUM_FACTORY_CAPABILITIES.md`,
sezione «Test di portabilità».
