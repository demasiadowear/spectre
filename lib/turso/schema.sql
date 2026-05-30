-- ============================================================
-- AYRO SPECTRE — Turso (libSQL / SQLite) schema + seed
-- Apply with:  turso db shell <db-name> < lib/turso/schema.sql
-- Mirrors lib/mock-data.ts so the app behaves the same online/offline.
--
-- SQLite has no array / jsonb column types. List fields (tags,
-- graph_connections) and ProposalContent are stored as JSON *text* and
-- (de)serialized in lib/data.ts. Single-tenant personal tool: no RLS.
-- ============================================================

-- ----- Tables -----------------------------------------------

create table if not exists leads (
  id                text primary key,
  name              text not null,
  company           text not null,
  email             text default '',
  phone             text default '',
  source            text default 'cold',
  status            text not null default 'cold',
  value             integer default 0,
  probability       integer default 0,
  last_contact      text default (datetime('now')),
  next_action       text default '',
  notes             text default '',
  tags              text default '[]',  -- JSON array of strings
  created_at        text default (datetime('now')),
  updated_at        text default (datetime('now')),
  graph_connections text default '[]',  -- JSON array of lead ids
  meta              text default '{}'   -- JSON LeadMeta (rating, reviews, address, funnel dates, custom msgs)
);

create table if not exists interactions (
  id         text primary key,
  lead_id    text references leads(id) on delete cascade,
  type       text default 'note',
  content    text default '',
  sentiment  text default 'neutral',
  ai_summary text default '',
  created_at text default (datetime('now'))
);

create table if not exists proposals (
  id           text primary key,
  lead_id      text references leads(id) on delete cascade,
  title        text default '',
  content_json text default '{}',  -- JSON (ProposalContent)
  pdf_url      text,
  status       text default 'draft',
  price_total  integer default 0,
  created_at   text default (datetime('now'))
);

create table if not exists ai_logs (
  id         text primary key,
  module     text not null,
  input      text default '',
  output     text default '',
  latency_ms integer default 0,
  created_at text default (datetime('now'))
);

create table if not exists mind_graph (
  id            text primary key,
  source_id     text references leads(id) on delete cascade,
  target_id     text references leads(id) on delete cascade,
  relation_type text default 'colleague',
  strength      integer default 1,
  evidence      text default ''
);

create index if not exists idx_interactions_lead on interactions(lead_id);
create index if not exists idx_proposals_lead on proposals(lead_id);
create index if not exists idx_mind_source on mind_graph(source_id);
create index if not exists idx_leads_status on leads(status);

-- ----- Seed: leads ------------------------------------------
-- Stable ids (lead-01 … lead-20) so cross-references stay valid.

insert or ignore into leads
  (id, name, company, email, phone, source, status, value, probability, last_contact, next_action, notes, tags, created_at, updated_at, graph_connections)
values
('lead-01','Giorgia Memmola','Estetica Luce di Luna','info@lucedilunaestetica.it','+39 080 555 0101','maps','warm',4800,55,datetime('now','-3 days'),'Inviare demo AyroDesk24 (Sara) via WhatsApp','Centro estetico Bari, 3 cabine. Perde prenotazioni la sera.','["beauty","ayrodesk24","bari"]',datetime('now','-20 days'),datetime('now','-3 days'),'["lead-07","lead-17"]'),
('lead-02','Vito Sannicandro','Barber House Tridente','tridente.barber@gmail.com','+39 080 555 0102','referral','hot',3600,72,datetime('now','-1 days'),'Chiudere setup 99 + Studio 129/mese','Modugno. 2 poltrone, no-show frequenti.','["barber","ayrodesk24"]',datetime('now','-14 days'),datetime('now','-1 days'),'["lead-12"]'),
('lead-03','Anna De Santis','B&B Corte dei Mercanti','prenotazioni@cortedeimercanti.it','+39 080 555 0103','maps','proposal',7200,64,datetime('now','-2 days'),'Follow-up su proposta AyroStay Pro','Polignano. 6 camere. Risponde tardi su Booking.','["hospitality","ayrostay","puglia"]',datetime('now','-25 days'),datetime('now','-2 days'),'["lead-08","lead-15"]'),
('lead-04','Cosimo Lacirignola','Ristorante Sale & Mare','info@salemare.it','+39 080 555 0104','cold','warm',5400,48,datetime('now','-9 days'),'Ricontattare: prenotazioni tavoli + recensioni','Monopoli. Estate sold-out, liste d''attesa.','["restaurant","automazione"]',datetime('now','-30 days'),datetime('now','-9 days'),'["lead-10"]'),
('lead-05','Daniele Sforza','Poker Club Apex','direzione@apexcardroom.it','+39 080 555 0105','referral','negotiation',36000,68,datetime('now','-2 days'),'Definire pricing Reactivation OS','Card room Bari. Voice+WA reactivation dormienti.','["adm","poker","reactivation-os","high-value"]',datetime('now','-40 days'),datetime('now','-2 days'),'["lead-19","lead-14","lead-09"]'),
('lead-06','Dott. Marco Ferrara','Studio Dentistico Ferrara','segreteria@studioferrara.it','+39 080 555 0106','linkedin','cold',6000,22,datetime('now','-16 days'),'Primo contatto: triage chiamate','Bari. Segretaria oberata, chiamate perse.','["studio","ayrodesk24"]',datetime('now','-18 days'),datetime('now','-16 days'),'["lead-13"]'),
('lead-07','Federica Carbonara','Nails & Co','nailsandco.bitonto@gmail.com','+39 080 555 0107','maps','warm',3000,51,datetime('now','-4 days'),'Mandare case study Glam Beauty','Bitonto. Prenotazioni da social.','["beauty","ayrodesk24","social-booking"]',datetime('now','-12 days'),datetime('now','-4 days'),'["lead-01"]'),
('lead-08','Riccardo Pinto','Hotel Maestrale','info@hotelmaestrale.it','+39 0884 555 010','referral','hot',12500,70,datetime('now','-1 days'),'Demo AyroStay Corporate + voice AI','Vieste, 28 camere. Picco estivo ingestibile.','["hospitality","ayrostay","high-value"]',datetime('now','-22 days'),datetime('now','-1 days'),'["lead-03","lead-15"]'),
('lead-09','Massimo Centonze','Betwin Point Lecce','m.centonze@betwinpoint.it','+39 0832 555 010','referral','proposal',28000,58,datetime('now','-6 days'),'Inviare proposta Reactivation OS annuale','Concessionario ADM. Punto vendita + online.','["adm","reactivation-os","high-value"]',datetime('now','-35 days'),datetime('now','-6 days'),'["lead-14","lead-05"]'),
('lead-10','Nico Lorusso','Pizzeria Fornace 900','fornace900@gmail.com','+39 080 555 0110','maps','closed',2400,100,datetime('now','-5 days'),'Onboarding fatto — upsell recensioni a 30gg','Bari. Cliente attivo AyroDesk24.','["restaurant","ayrodesk24","cliente"]',datetime('now','-50 days'),datetime('now','-5 days'),'["lead-04"]'),
('lead-11','Serena Quaranta','Centro Estetico Aura','aura.estetica@gmail.com','+39 099 555 0111','cold','cold',3600,18,datetime('now','-21 days'),'Sequenza cold: ritentare WA','Taranto. Nessuna risposta al primo contatto.','["beauty","cold"]',datetime('now','-21 days'),datetime('now','-21 days'),'[]'),
('lead-12','Antonio Greco','Barbershop King''s','kingsbarber.br@gmail.com','+39 0831 555 010','maps','warm',3000,44,datetime('now','-8 days'),'Ricontattare dopo ferie','Brindisi. Competitor di Barber House Tridente.','["barber","ayrodesk24"]',datetime('now','-17 days'),datetime('now','-8 days'),'["lead-02"]'),
('lead-13','Avv. Elena Marzano','Studio Legale Marzano','studio@avvmarzano.it','+39 080 555 0113','linkedin','warm',5400,46,datetime('now','-5 days'),'Info filtro chiamate + smistamento','Bari. Filtrare chiamate non qualificate.','["studio","ayrodesk24"]',datetime('now','-19 days'),datetime('now','-5 days'),'["lead-06"]'),
('lead-14','Pierluigi Faro','Gaming Hall Royal','p.faro@royalgaming.it','+39 0881 555 010','referral','hot',31000,66,datetime('now','-1 days'),'Call tecnica integrazione DB giocatori','Foggia. Sala ADM, churn giocatori alto.','["adm","reactivation-os","high-value"]',datetime('now','-28 days'),datetime('now','-1 days'),'["lead-05","lead-09"]'),
('lead-15','Chiara Vetrugno','Resort Cala Verde','booking@calaverde.it','+39 0833 555 010','maps','negotiation',16500,62,datetime('now','-3 days'),'Negoziare bundle AyroStay + voice ristorante','Gallipoli. Resort + ristorante.','["hospitality","ayrostay","high-value"]',datetime('now','-33 days'),datetime('now','-3 days'),'["lead-08","lead-03"]'),
('lead-16','Tommaso Conte','Osteria del Borgo','osteriadelborgo@gmail.com','+39 080 555 0116','cold','lost',2800,0,datetime('now','-27 days'),'Perso: budget assente. Rivalutare autunno.','Alberobello. Ha scelto un gestionale gratuito.','["restaurant","lost"]',datetime('now','-45 days'),datetime('now','-27 days'),'["lead-20"]'),
('lead-17','Martina Lopez','Beauty Lab Eden','beautylabeden@gmail.com','+39 080 555 0117','referral','proposal',4200,60,datetime('now','-2 days'),'Proposta Studio inviata, attendere','Bari. 4 operatrici, gestione liste.','["beauty","ayrodesk24"]',datetime('now','-15 days'),datetime('now','-2 days'),'["lead-01"]'),
('lead-18','Dott. Luca Tedone','Fisioterapia Movimento','info@fisiomovimento.it','+39 0883 555 010','linkedin','cold',4800,20,datetime('now','-13 days'),'Primo contatto: richiami pazienti','Andria. Cicli di terapie, molti richiami.','["studio","ayrodesk24"]',datetime('now','-13 days'),datetime('now','-13 days'),'[]'),
('lead-19','Gennaro Esposito','Poker Room Vesuvio','g.esposito@vesuviopoker.it','+39 081 555 0119','referral','warm',24000,40,datetime('now','-7 days'),'Inviare case study + ROI calculator','Napoli. Card room, competitor di Apex.','["adm","poker","reactivation-os","high-value"]',datetime('now','-24 days'),datetime('now','-7 days'),'["lead-05"]'),
('lead-20','Ilaria Surano','Caffè Letterario Pessoa','pessoacaffe@gmail.com','+39 0832 555 020','referral','hot',3200,74,datetime('now','-1 days'),'Chiudere: gestione eventi + prenotazioni','Lecce. Referral da Osteria del Borgo.','["restaurant","cafe","automazione"]',datetime('now','-10 days'),datetime('now','-1 days'),'["lead-16"]');

-- ----- Seed: interactions -----------------------------------

insert or ignore into interactions (id, lead_id, type, content, sentiment, ai_summary, created_at) values
('int-01','lead-05','meeting','Incontro in sala. Sforza interessato alla reactivation dei giocatori inattivi da 90gg. Chiede numeri concreti di ROI.','positive','Alto interesse, blocco su prova ROI. Inviare case study.',datetime('now','-2 days')),
('int-02','lead-05','call','Prima call esplorativa. Budget ampio ma vuole capire la compliance ADM.','neutral','Obiezione compliance. Preparare scheda conformità ADM.',datetime('now','-9 days')),
('int-03','lead-08','whatsapp','Pinto: In agosto è impossibile rispondere a tutti, perdiamo prenotazioni dirette. Apertura forte.','positive','Pain stagionale chiaro. Spingere su prenotazioni dirette H24.',datetime('now','-1 days')),
('int-04','lead-03','email','Inviata proposta AyroStay Pro. Aperta 2 volte, nessuna risposta.','neutral','Interesse tiepido. Follow-up con scarcity entro 48h.',datetime('now','-2 days')),
('int-05','lead-02','call','Sannicandro pronto a partire. Chiede solo se l''AI gestisce le modifiche last-minute.','positive','Pronto a chiudere. Rispondere su reschedule automatico.',datetime('now','-1 days')),
('int-06','lead-16','note','Ha scelto un gestionale gratuito. Nessun budget al momento.','negative','Perso per prezzo. Nurturing trimestrale.',datetime('now','-27 days')),
('int-07','lead-14','call','Faro chiede integrazione col loro DB giocatori esistente. Aspetto tecnico chiave.','positive','Deal tecnico-dipendente. Coinvolgere parte dev su integrazione DB.',datetime('now','-1 days')),
('int-08','lead-20','whatsapp','Surano entusiasta, vuole partire prima del prossimo evento.','positive','Urgenza naturale (evento). Chiudere subito.',datetime('now','-1 days'));

-- ----- Seed: mind_graph -------------------------------------

insert or ignore into mind_graph (id, source_id, target_id, relation_type, strength, evidence) values
('edge-01','lead-05','lead-19','competitor',8,'Due card room rivali sullo stesso circuito tornei Sud Italia.'),
('edge-02','lead-05','lead-14','colleague',6,'Entrambi concessionari ADM, contatti allo stesso evento di settore.'),
('edge-03','lead-09','lead-14','competitor',7,'Punti vendita ADM in province limitrofe (Lecce/Foggia).'),
('edge-04','lead-02','lead-12','competitor',5,'Due barbershop con clientela sovrapposta tra Modugno e Brindisi.'),
('edge-05','lead-01','lead-07','colleague',6,'Si seguono su Instagram, condividono fornitore prodotti.'),
('edge-06','lead-01','lead-17','friend',7,'Stesso corso di formazione estetica nel 2023.'),
('edge-07','lead-03','lead-08','colleague',5,'Strutture ricettive pugliesi, stesso consorzio turistico.'),
('edge-08','lead-08','lead-15','colleague',6,'Entrambi nel circuito resort del Salento/Gargano.'),
('edge-09','lead-04','lead-10','competitor',4,'Ristorazione Bari area, clientela simile.'),
('edge-10','lead-06','lead-13','friend',5,'Studi professionali nello stesso palazzo a Bari.'),
('edge-11','lead-16','lead-20','colleague',6,'Surano (Pessoa) arrivata come referral diretto dall''Osteria del Borgo.'),
('edge-12','lead-05','lead-09','colleague',5,'Contatti incrociati nel mondo ADM, possibile introduzione.');
