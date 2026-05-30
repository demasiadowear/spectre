import { isTursoConfigured, turso } from "@/lib/turso";
import type { InValue, Row } from "@libsql/client";
import {
  MOCK_INTERACTIONS,
  MOCK_LEADS,
  MOCK_MIND_EDGES,
} from "@/lib/mock-data";
import type {
  Interaction,
  InteractionType,
  Lead,
  LeadMeta,
  LeadSource,
  LeadStatus,
  MindEdge,
  Proposal,
  ProposalContent,
  ProposalStatus,
  RelationType,
  Sentiment,
} from "@/types";

// ============================================================
// Unified data access layer.
// Uses Turso (libSQL / SQLite edge) when configured, otherwise an
// in-memory mock store (seeded from lib/mock-data) so the app is fully
// runnable offline. SQLite has no array/JSON column types, so list
// fields (tags, graph_connections) and ProposalContent are stored as
// JSON text and (de)serialized at the boundary.
// ============================================================

// In-memory store (mock mode). Mutations persist per server process only.
const leadStore: Lead[] = MOCK_LEADS.map((l) => ({ ...l }));
const interactionStore: Interaction[] = MOCK_INTERACTIONS.map((i) => ({ ...i }));
const proposalStore: Proposal[] = [];

function sortByUpdated(a: Lead, b: Lead) {
  return (
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

// ----- Serialization helpers ---------------------------------

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToLead(r: Row): Lead {
  return {
    id: String(r.id),
    name: String(r.name),
    company: String(r.company),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    source: r.source as LeadSource,
    status: r.status as LeadStatus,
    value: Number(r.value ?? 0),
    probability: Number(r.probability ?? 0),
    last_contact: String(r.last_contact ?? ""),
    next_action: String(r.next_action ?? ""),
    notes: String(r.notes ?? ""),
    tags: parseJsonArray(r.tags),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    graph_connections: parseJsonArray(r.graph_connections),
    meta: parseJson<LeadMeta>(r.meta, {}),
  };
}

function rowToInteraction(r: Row): Interaction {
  return {
    id: String(r.id),
    lead_id: String(r.lead_id),
    type: r.type as InteractionType,
    content: String(r.content ?? ""),
    sentiment: r.sentiment as Sentiment,
    ai_summary: String(r.ai_summary ?? ""),
    created_at: String(r.created_at ?? ""),
  };
}

function rowToProposal(r: Row): Proposal {
  return {
    id: String(r.id),
    lead_id: String(r.lead_id),
    title: String(r.title ?? ""),
    content_json: parseJson<ProposalContent>(r.content_json, {
      title: "",
      sections: [],
      pricing: [],
      email_subject: "",
      email_body: "",
      followup_script: "",
    }),
    pdf_url: r.pdf_url != null ? String(r.pdf_url) : null,
    status: r.status as ProposalStatus,
    price_total: Number(r.price_total ?? 0),
    created_at: String(r.created_at ?? ""),
  };
}

function rowToEdge(r: Row): MindEdge {
  return {
    id: String(r.id),
    source_id: String(r.source_id),
    target_id: String(r.target_id),
    relation_type: r.relation_type as RelationType,
    strength: Number(r.strength ?? 0),
    evidence: String(r.evidence ?? ""),
  };
}

// Writable lead columns (id is immutable). Used to build safe UPDATE
// statements from a partial patch without trusting arbitrary keys.
const LEAD_COLUMNS = new Set([
  "name",
  "company",
  "email",
  "phone",
  "source",
  "status",
  "value",
  "probability",
  "last_contact",
  "next_action",
  "notes",
  "tags",
  "created_at",
  "updated_at",
  "graph_connections",
  "meta",
]);

function serializeLeadValue(key: string, value: unknown): InValue {
  if (key === "tags" || key === "graph_connections") {
    return JSON.stringify(Array.isArray(value) ? value : []);
  }
  if (key === "meta") {
    return JSON.stringify(value && typeof value === "object" ? value : {});
  }
  return value as InValue;
}

// ----- Leads -------------------------------------------------

export async function getLeads(): Promise<Lead[]> {
  if (isTursoConfigured && turso) {
    try {
      const res = await turso.execute(
        "SELECT * FROM leads ORDER BY updated_at DESC",
      );
      return res.rows.map(rowToLead);
    } catch (e) {
      console.error(
        "[data] getLeads turso error, falling back:",
        (e as Error).message,
      );
    }
  }
  return [...leadStore].sort(sortByUpdated);
}

export async function getLeadById(id: string): Promise<Lead | null> {
  if (isTursoConfigured && turso) {
    try {
      const res = await turso.execute({
        sql: "SELECT * FROM leads WHERE id = ? LIMIT 1",
        args: [id],
      });
      return res.rows.length ? rowToLead(res.rows[0]) : null;
    } catch (e) {
      console.error("[data] getLeadById error:", (e as Error).message);
    }
  }
  return leadStore.find((l) => l.id === id) ?? null;
}

export type NewLead = Omit<
  Lead,
  | "id"
  | "created_at"
  | "updated_at"
  | "probability"
  | "graph_connections"
  | "meta"
> &
  Partial<Pick<Lead, "probability" | "graph_connections" | "meta">>;

export async function createLead(input: NewLead): Promise<Lead> {
  const nowIso = new Date().toISOString();
  const lead: Lead = {
    id: crypto.randomUUID(),
    probability: 25,
    graph_connections: [],
    meta: {},
    ...input,
    created_at: nowIso,
    updated_at: nowIso,
  };

  if (isTursoConfigured && turso) {
    await turso.execute({
      sql: `INSERT INTO leads
        (id, name, company, email, phone, source, status, value, probability,
         last_contact, next_action, notes, tags, created_at, updated_at, graph_connections, meta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        lead.id,
        lead.name,
        lead.company,
        lead.email,
        lead.phone,
        lead.source,
        lead.status,
        lead.value,
        lead.probability,
        lead.last_contact,
        lead.next_action,
        lead.notes,
        JSON.stringify(lead.tags),
        lead.created_at,
        lead.updated_at,
        JSON.stringify(lead.graph_connections),
        JSON.stringify(lead.meta),
      ],
    });
    return lead;
  }

  leadStore.unshift(lead);
  return lead;
}

export async function updateLead(
  id: string,
  patch: Partial<Lead>,
): Promise<Lead | null> {
  const updated_at = new Date().toISOString();

  if (isTursoConfigured && turso) {
    const entries = Object.entries({ ...patch, updated_at }).filter(
      ([key]) => key !== "id" && LEAD_COLUMNS.has(key),
    );
    if (entries.length === 0) return getLeadById(id);

    const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
    const args: InValue[] = entries.map(([key, value]) =>
      serializeLeadValue(key, value),
    );
    args.push(id);

    const res = await turso.execute({
      sql: `UPDATE leads SET ${setClause} WHERE id = ? RETURNING *`,
      args,
    });
    return res.rows.length ? rowToLead(res.rows[0]) : null;
  }

  const idx = leadStore.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const next: Lead = { ...leadStore[idx], ...patch, updated_at };
  leadStore[idx] = next;
  return next;
}

export async function deleteLead(id: string): Promise<boolean> {
  if (isTursoConfigured && turso) {
    await turso.execute({ sql: "DELETE FROM leads WHERE id = ?", args: [id] });
    return true;
  }
  const idx = leadStore.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  leadStore.splice(idx, 1);
  return true;
}

// ----- Interactions ------------------------------------------

export async function getInteractions(leadId?: string): Promise<Interaction[]> {
  if (isTursoConfigured && turso) {
    try {
      const res = await turso.execute(
        leadId
          ? {
              sql: "SELECT * FROM interactions WHERE lead_id = ? ORDER BY created_at DESC",
              args: [leadId],
            }
          : "SELECT * FROM interactions ORDER BY created_at DESC",
      );
      return res.rows.map(rowToInteraction);
    } catch (e) {
      console.error("[data] getInteractions error:", (e as Error).message);
    }
  }
  const all = [...interactionStore].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return leadId ? all.filter((i) => i.lead_id === leadId) : all;
}

export async function createInteraction(
  input: Omit<Interaction, "id" | "created_at">,
): Promise<Interaction> {
  const interaction: Interaction = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...input,
  };
  if (isTursoConfigured && turso) {
    await turso.execute({
      sql: `INSERT INTO interactions
        (id, lead_id, type, content, sentiment, ai_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        interaction.id,
        interaction.lead_id,
        interaction.type,
        interaction.content,
        interaction.sentiment,
        interaction.ai_summary,
        interaction.created_at,
      ],
    });
    return interaction;
  }
  interactionStore.unshift(interaction);
  return interaction;
}

// ----- Proposals ---------------------------------------------

export async function getProposals(leadId?: string): Promise<Proposal[]> {
  if (isTursoConfigured && turso) {
    try {
      const res = await turso.execute(
        leadId
          ? {
              sql: "SELECT * FROM proposals WHERE lead_id = ? ORDER BY created_at DESC",
              args: [leadId],
            }
          : "SELECT * FROM proposals ORDER BY created_at DESC",
      );
      return res.rows.map(rowToProposal);
    } catch (e) {
      console.error("[data] getProposals error:", (e as Error).message);
    }
  }
  const all = [...proposalStore];
  return leadId ? all.filter((p) => p.lead_id === leadId) : all;
}

export async function createProposal(input: {
  lead_id: string;
  content: ProposalContent;
}): Promise<Proposal> {
  const price_total = input.content.pricing.reduce(
    (sum, tier) => sum + (tier.price || 0),
    0,
  );
  const proposal: Proposal = {
    id: crypto.randomUUID(),
    lead_id: input.lead_id,
    title: input.content.title,
    content_json: input.content,
    pdf_url: null,
    status: "draft",
    price_total,
    created_at: new Date().toISOString(),
  };
  if (isTursoConfigured && turso) {
    await turso.execute({
      sql: `INSERT INTO proposals
        (id, lead_id, title, content_json, pdf_url, status, price_total, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        proposal.id,
        proposal.lead_id,
        proposal.title,
        JSON.stringify(proposal.content_json),
        proposal.pdf_url,
        proposal.status,
        proposal.price_total,
        proposal.created_at,
      ],
    });
    return proposal;
  }
  proposalStore.unshift(proposal);
  return proposal;
}

// ----- Mind graph --------------------------------------------

export async function getMindEdges(): Promise<MindEdge[]> {
  if (isTursoConfigured && turso) {
    try {
      const res = await turso.execute("SELECT * FROM mind_graph");
      return res.rows.map(rowToEdge);
    } catch (e) {
      console.error("[data] getMindEdges error:", (e as Error).message);
    }
  }
  return [...MOCK_MIND_EDGES];
}
