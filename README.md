# AYRO SPECTRE

> L'ombra digitale che chiude i deal mentre respiri.

Exoscheletro di vendita personale con interfaccia HUD cyberpunk. Tool **solo-tenant** per AYROMEX. 5 moduli neurali: **Visor** (dashboard pipeline), **Whisper** (assistente call real-time), **Hand** (generatore proposte), **Oracle** (predizione chiusura), **Mind** (grafo relazionale).

## Stack

- Next.js 14 (App Router) · TypeScript strict
- Tailwind CSS 3.4 · Framer Motion · Lucide
- Turso (libSQL / SQLite edge) — con **fallback automatico a dati mock**
- Google Gemini per i moduli AI · Google Places per il Lead Hunter — con **mock fallback**
- NextAuth (Credentials, JWT) — single-tenant, con **dev bypass**

## Setup

```bash
npm install
cp .env.local.example .env.local   # tutto opzionale
npm run dev
```

Apri http://localhost:3000 → redirect a `/visor`.

### Modalità demo (zero config)

Senza variabili d'ambiente l'app gira completamente su **dati mock** (20 lead italiani realistici in `lib/mock-data.ts`) e **AI mock**. Perfetto per sviluppo e demo offline.

### Con Turso (dati persistenti)

1. Crea un database su [turso.tech](https://turso.tech) (`turso db create spectre`).
2. Applica schema + seed (20 lead): `turso db shell spectre < lib/turso/schema.sql`.
3. Compila in `.env.local` (`turso db show --url spectre` e `turso db tokens create spectre`):
   ```
   TURSO_DATABASE_URL=libsql://your-db.turso.io
   TURSO_AUTH_TOKEN=...
   ```

### Con Gemini (AI reale) + Google Places (Hunter reale)

```
GEMINI_API_KEY=AIza...          # https://aistudio.google.com/app/apikey
GOOGLE_PLACES_API_KEY=AIza...   # Places API + Geocoding API su Google Cloud
```

### Autenticazione (single-tenant)

SPECTRE è un tool personale: un solo operatore.

- **Senza `SPECTRE_PASSWORD`** → l'app gira aperta, con il banner `DEV MODE — NO AUTH`. Comodo in locale.
- **Con `SPECTRE_PASSWORD`** → ogni rotta è protetta dal middleware e reindirizza a `/login` (sessione JWT). Username da `SPECTRE_USER` (default `puccio`).

```
NEXTAUTH_SECRET=...        # npx auth secret
SPECTRE_USER=puccio
SPECTRE_PASSWORD=il-tuo-codice
```

## API

| Metodo | Endpoint | Funzione |
|--------|----------|----------|
| GET / POST | `/api/leads` | Lista / crea lead |
| GET / PATCH / DELETE | `/api/leads/[id]` | Dettaglio / aggiorna / elimina |
| GET / POST | `/api/interactions` | Interazioni (`?leadId=`) |
| GET / POST | `/api/proposals` | Proposte (`?leadId=`) |

Tutte le risposte usano l'envelope `{ success, data?, error?, meta? }`.

## Stato build

- [x] PHASE 1 — Scaffold + design system + 10 componenti globali + shell HUD
- [x] PHASE 2 — Data layer (Turso + mock) + types + seed + API
- [x] PHASE 3 — VISOR (kanban DnD + heatmap urgenza + quick actions + nuovo lead)
- [x] PHASE 4 — HAND (wizard 3 step + proposta Claude + export PDF)
- [x] PHASE 5 — WHISPER (shadow mode + transcript live + contro-obiezioni) · ORACLE (simulatore + predizione animata) · MIND (force graph + scan rete)
- [x] PHASE 6 — Auth single-tenant + transizioni rotte + error/404 + build verde

**Build:** `npm run build` → 17 rotte, TypeScript strict, zero errori.

## Deploy (Vercel)

```bash
npx vercel --prod
```

Imposta le env vars nel dashboard Vercel (o `vercel env add`).
