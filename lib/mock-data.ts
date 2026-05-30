import type { Interaction, Lead, MindEdge } from "@/types";

// ============================================================
// AYRO SPECTRE — mock fallback datasets.
// Intentionally EMPTY: SPECTRE runs on real Turso data only. These stay
// as typed empty arrays so lib/data.ts imports remain valid and a Turso
// outage (or missing config) yields an EMPTY board, never fake leads.
// The original demo seed lives in git history + lib/turso/schema.sql.
// ============================================================

export const MOCK_LEADS: Lead[] = [];

export const MOCK_INTERACTIONS: Interaction[] = [];

export const MOCK_MIND_EDGES: MindEdge[] = [];
