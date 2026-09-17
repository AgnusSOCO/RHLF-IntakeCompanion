import pg from "pg";
import type { CallSummary } from "./assist/ai";
import type { CallRecord } from "./callLog";

/**
 * Durable store: agents, call records, transcripts. Postgres on Railway via
 * DATABASE_URL; when unset everything silently no-ops (in-memory CallLog
 * remains the live store) so local dev needs no database.
 *
 * NOTE: transcripts contain prospective-client PII. Retention/deletion policy
 * belongs to the firm — add a purge job before production rollout.
 */

export interface AgentRow {
  extensionId: string;
  name: string | null;
  firstSeen: number;
  lastSeen: number;
}

export interface HistoryQuery {
  from?: number;
  to?: number;
  q?: string;
  limit?: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  extension_id TEXT PRIMARY KEY,
  name TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calls (
  session_id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  caller_number TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  transcript_segments INT NOT NULL DEFAULT 0,
  suggestions INT NOT NULL DEFAULT 0,
  helpful INT NOT NULL DEFAULT 0,
  unhelpful INT NOT NULL DEFAULT 0,
  coverage INT NOT NULL DEFAULT 0,
  coverage_total INT NOT NULL DEFAULT 0,
  summary JSONB,
  transcript JSONB
);
CREATE INDEX IF NOT EXISTS calls_ext_started ON calls (extension_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_caller ON calls (caller_number);
`;

export class Store {
  private pool?: pg.Pool;
  private agentNames = new Map<string, string>();
  private ready = false;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) return;
    this.pool = new pg.Pool({ connectionString: url, max: 5 });
  }

  get enabled(): boolean {
    return Boolean(this.pool);
  }

  async init(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(SCHEMA);
      const { rows } = await this.pool.query(
        "SELECT extension_id, name FROM agents WHERE name IS NOT NULL"
      );
      for (const r of rows) this.agentNames.set(r.extension_id, r.name);
      this.ready = true;
      console.log(`[store] postgres ready (${this.agentNames.size} named agents)`);
    } catch (e) {
      console.error("[store] init failed:", (e as Error).message);
    }
  }

  agentName(extensionId: string): string | undefined {
    return this.agentNames.get(extensionId);
  }

  async upsertAgent(extensionId: string, name?: string | null): Promise<void> {
    if (name) this.agentNames.set(extensionId, name);
    if (!this.ready) return;
    await this.pool!.query(
      `INSERT INTO agents (extension_id, name, last_seen) VALUES ($1, $2, now())
       ON CONFLICT (extension_id)
       DO UPDATE SET last_seen = now(), name = COALESCE($2, agents.name)`,
      [extensionId, name ?? null]
    ).catch((e) => console.error("[store] upsertAgent:", e.message));
  }

  async saveCall(
    rec: CallRecord,
    transcript: { speaker: string; text: string }[],
    coverage: { covered: number; total: number }
  ): Promise<void> {
    if (!this.ready) return;
    await this.pool!.query(
      `INSERT INTO calls
        (session_id, extension_id, caller_number, started_at, ended_at,
         transcript_segments, suggestions, helpful, unhelpful,
         coverage, coverage_total, summary, transcript)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (session_id) DO UPDATE SET
         ended_at = EXCLUDED.ended_at,
         transcript_segments = EXCLUDED.transcript_segments,
         suggestions = EXCLUDED.suggestions,
         helpful = EXCLUDED.helpful,
         unhelpful = EXCLUDED.unhelpful,
         coverage = EXCLUDED.coverage,
         coverage_total = EXCLUDED.coverage_total,
         summary = EXCLUDED.summary,
         transcript = EXCLUDED.transcript`,
      [
        rec.sessionId,
        rec.extensionId,
        rec.callerNumber ?? null,
        new Date(rec.startedAt),
        rec.endedAt ? new Date(rec.endedAt) : null,
        rec.transcriptSegments,
        rec.suggestions,
        rec.feedback.helpful,
        rec.feedback.unhelpful,
        coverage.covered,
        coverage.total,
        rec.summary ? JSON.stringify(rec.summary) : null,
        JSON.stringify(transcript),
      ]
    ).catch((e) => console.error("[store] saveCall:", e.message));
  }

  /** Prior call count + most recent call for this caller number. */
  async callerHistory(
    callerNumber: string
  ): Promise<{ count: number; lastAt: number | null }> {
    if (!this.ready || !callerNumber) return { count: 0, lastAt: null };
    try {
      const { rows } = await this.pool!.query(
        `SELECT count(*)::int AS n, max(started_at) AS last_at
         FROM calls WHERE caller_number = $1`,
        [callerNumber]
      );
      return {
        count: rows[0]?.n ?? 0,
        lastAt: rows[0]?.last_at ? new Date(rows[0].last_at).getTime() : null,
      };
    } catch {
      return { count: 0, lastAt: null };
    }
  }

  private rowToRecord(r: any): CallRecord & { transcript?: any; coverage?: number; coverageTotal?: number } {
    return {
      sessionId: r.session_id,
      extensionId: r.extension_id,
      callerNumber: r.caller_number ?? undefined,
      startedAt: new Date(r.started_at).getTime(),
      endedAt: r.ended_at ? new Date(r.ended_at).getTime() : undefined,
      transcriptSegments: r.transcript_segments,
      suggestions: r.suggestions,
      feedback: { helpful: r.helpful, unhelpful: r.unhelpful },
      summary: r.summary as CallSummary | undefined,
      transcript: r.transcript ?? undefined,
      coverage: r.coverage,
      coverageTotal: r.coverage_total,
    };
  }

  /** Admin: recent calls across all agents. */
  async listCalls(limit = 100): Promise<ReturnType<Store["rowToRecord"]>[]> {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      `SELECT * FROM calls ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  /** Agent-scoped history: own calls only, optional date range + text search. */
  async historyFor(extensionId: string, hq: HistoryQuery) {
    if (!this.ready) return [];
    const conds = ["extension_id = $1"];
    const params: any[] = [extensionId];
    if (hq.from) { params.push(new Date(hq.from)); conds.push(`started_at >= $${params.length}`); }
    if (hq.to) { params.push(new Date(hq.to)); conds.push(`started_at < $${params.length}`); }
    if (hq.q) {
      params.push(`%${hq.q}%`);
      conds.push(`(caller_number ILIKE $${params.length} OR summary::text ILIKE $${params.length} OR transcript::text ILIKE $${params.length})`);
    }
    params.push(Math.min(hq.limit ?? 200, 500));
    const { rows } = await this.pool!.query(
      `SELECT * FROM calls WHERE ${conds.join(" AND ")}
       ORDER BY started_at DESC LIMIT $${params.length}`,
      params
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  /** Admin: per-agent aggregates for performance views. */
  async agentPerformance() {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      `SELECT a.extension_id, a.name,
              count(c.session_id)::int AS calls,
              coalesce(avg(EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) * 1000), 0)::bigint AS avg_duration_ms,
              coalesce(sum(c.suggestions), 0)::int AS suggestions,
              coalesce(sum(c.helpful), 0)::int AS helpful,
              coalesce(sum(c.unhelpful), 0)::int AS unhelpful,
              coalesce(avg(c.coverage::float / nullif(c.coverage_total, 0)), 0)::float AS avg_coverage,
              max(c.started_at) AS last_call_at
       FROM agents a LEFT JOIN calls c ON c.extension_id = a.extension_id
       GROUP BY a.extension_id, a.name
       ORDER BY calls DESC`
    );
    return rows.map((r) => ({
      extensionId: r.extension_id,
      name: r.name,
      calls: r.calls,
      avgDurationMs: Number(r.avg_duration_ms),
      suggestions: r.suggestions,
      feedback: { helpful: r.helpful, unhelpful: r.unhelpful },
      avgCoverage: r.avg_coverage,
      lastCallAt: r.last_call_at ? new Date(r.last_call_at).getTime() : null,
    }));
  }

  async listAgents(): Promise<AgentRow[]> {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      "SELECT * FROM agents ORDER BY last_seen DESC"
    );
    return rows.map((r) => ({
      extensionId: r.extension_id,
      name: r.name,
      firstSeen: new Date(r.first_seen).getTime(),
      lastSeen: new Date(r.last_seen).getTime(),
    }));
  }
}
