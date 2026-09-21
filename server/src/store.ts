import crypto from "node:crypto";
import pg from "pg";
import type { CallSummary, CallFlag } from "./assist/ai";
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
  paired?: boolean;
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
  token_hash TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS token_hash TEXT;
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
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
  transcript JSONB,
  flags JSONB,
  disposition TEXT,
  disposition_at TIMESTAMPTZ
);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS flags JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS disposition TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS suggestion_events JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS languages JSONB;
CREATE INDEX IF NOT EXISTS calls_ext_started ON calls (extension_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_caller ON calls (caller_number);
CREATE TABLE IF NOT EXISTS plays (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  source_session_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const PAIRING_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export class Store {
  private pool?: pg.Pool;
  private agentNames = new Map<string, string>();
  private agentTokenHashes = new Map<string, string>();
  private playTexts: string[] = []; // cached best plays, injected into AI prompts
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
        "SELECT extension_id, name, token_hash FROM agents"
      );
      for (const r of rows) {
        if (r.name) this.agentNames.set(r.extension_id, r.name);
        if (r.token_hash) this.agentTokenHashes.set(r.extension_id, r.token_hash);
      }
      const plays = await this.pool!.query(
        "SELECT title, text FROM plays ORDER BY created_at DESC LIMIT 12"
      );
      this.playTexts = plays.rows.map((p) => `${p.title}: ${p.text}`);
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
    coverage: { covered: number; total: number },
    flags: CallFlag[] = []
  ): Promise<void> {
    if (!this.ready) return;
    const languages = [
      ...new Set(
        transcript.map((t: any) => t.language).filter((l): l is string => Boolean(l))
      ),
    ];
    await this.pool!.query(
      `INSERT INTO calls
        (session_id, extension_id, caller_number, started_at, ended_at,
         transcript_segments, suggestions, helpful, unhelpful,
         coverage, coverage_total, summary, transcript, flags,
         suggestion_events, languages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (session_id) DO UPDATE SET
         ended_at = EXCLUDED.ended_at,
         transcript_segments = EXCLUDED.transcript_segments,
         suggestions = EXCLUDED.suggestions,
         helpful = EXCLUDED.helpful,
         unhelpful = EXCLUDED.unhelpful,
         coverage = EXCLUDED.coverage,
         coverage_total = EXCLUDED.coverage_total,
         summary = EXCLUDED.summary,
         transcript = EXCLUDED.transcript,
         flags = EXCLUDED.flags,
         suggestion_events = EXCLUDED.suggestion_events,
         languages = EXCLUDED.languages`,
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
        JSON.stringify(flags),
        rec.suggestionEvents?.length ? JSON.stringify(rec.suggestionEvents) : null,
        languages.length ? JSON.stringify(languages) : null,
      ]
    ).catch((e) => console.error("[store] saveCall:", e.message));
  }

  /**
   * Admin mints a one-time pairing code for an extension. The agent enters it
   * in the companion setup dialog; /api/pair/exchange trades it for a token.
   */
  async createPairingCode(
    extensionId: string,
    name?: string
  ): Promise<{ code: string; expiresAt: number } | null> {
    if (!this.ready) return null;
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    await this.upsertAgent(extensionId, name);
    await this.pool!.query(
      `INSERT INTO pairing_codes (code, extension_id, name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [code, extensionId, name ?? null, new Date(expiresAt)]
    ).catch((e) => console.error("[store] createPairingCode:", e.message));
    return { code, expiresAt };
  }

  /**
   * Burn a pairing code -> mint a per-extension token. Returns the token
   * (shown once to the companion) or null on invalid/expired/used code.
   */
  async exchangePairingCode(
    extensionId: string,
    code: string
  ): Promise<{ token: string; name: string | null } | null> {
    if (!this.ready) return null;
    const { rows } = await this.pool!.query(
      `UPDATE pairing_codes SET used_at = now()
       WHERE code = $1 AND extension_id = $2
         AND used_at IS NULL AND expires_at > now()
       RETURNING name`,
      [code.trim(), extensionId]
    );
    if (rows.length === 0) return null;
    const token = crypto.randomBytes(24).toString("base64url");
    const hash = hashToken(token);
    this.agentTokenHashes.set(extensionId, hash);
    await this.pool!.query(
      `UPDATE agents SET token_hash = $1 WHERE extension_id = $2`,
      [hash, extensionId]
    );
    return { token, name: rows[0].name ?? this.agentNames.get(extensionId) ?? null };
  }

  /** Per-extension token issued via pairing. Env AGENT_TOKENS still wins. */
  verifyAgentToken(extensionId: string, token: string): boolean {
    const hash = this.agentTokenHashes.get(extensionId);
    return Boolean(hash) && hash === hashToken(token);
  }

  /** True once an extension has been paired — shared token then stops working. */
  hasPairedToken(extensionId: string): boolean {
    return this.agentTokenHashes.has(extensionId);
  }

  /** Agent dispositions their own call (signed / callback / etc). */
  async setDisposition(
    sessionId: string,
    extensionId: string,
    disposition: string
  ): Promise<boolean> {
    if (!this.ready) return false;
    const { rowCount } = await this.pool!.query(
      `UPDATE calls SET disposition = $1, disposition_at = now()
       WHERE session_id = $2 AND extension_id = $3`,
      [disposition, sessionId, extensionId]
    );
    return (rowCount ?? 0) > 0;
  }

  /** Prior call count + most recent call context for this caller number. */
  async callerHistory(
    callerNumber: string
  ): Promise<{
    count: number;
    lastAt: number | null;
    lastSummary?: string;
    lastDisposition?: string;
  }> {
    if (!this.ready || !callerNumber) return { count: 0, lastAt: null };
    try {
      const { rows } = await this.pool!.query(
        `SELECT count(*)::int AS n, max(started_at) AS last_at
         FROM calls WHERE caller_number = $1`,
        [callerNumber]
      );
      const count = rows[0]?.n ?? 0;
      if (!count) return { count: 0, lastAt: null };
      // Pull the most recent call's summary + outcome for the repeat-caller card.
      const { rows: last } = await this.pool!.query(
        `SELECT summary->>'summary' AS s, disposition
         FROM calls WHERE caller_number = $1 AND ended_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`,
        [callerNumber]
      );
      return {
        count,
        lastAt: rows[0]?.last_at ? new Date(rows[0].last_at).getTime() : null,
        lastSummary: last[0]?.s ?? undefined,
        lastDisposition: last[0]?.disposition ?? undefined,
      };
    } catch {
      return { count: 0, lastAt: null };
    }
  }

  private rowToRecord(r: any): CallRecord & {
    transcript?: any;
    coverage?: number;
    coverageTotal?: number;
    flags?: CallFlag[];
    disposition?: string;
  } {
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
      flags: r.flags ?? undefined,
      disposition: r.disposition ?? undefined,
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

  /**
   * Supervisor-promoted "best plays" — responses that converted on real calls.
   * The pipeline injects these into AI prompts so one agent's win compounds.
   */
  async bestPlays(): Promise<string[]> {
    return this.playTexts;
  }

  async listPlays() {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      "SELECT * FROM plays ORDER BY created_at DESC LIMIT 50"
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      text: r.text,
      sourceSessionId: r.source_session_id ?? undefined,
      createdBy: r.created_by ?? undefined,
      createdAt: new Date(r.created_at).getTime(),
    }));
  }

  async addPlay(
    title: string,
    text: string,
    sourceSessionId?: string,
    createdBy?: string
  ): Promise<number | null> {
    if (!this.ready) return null;
    const { rows } = await this.pool!.query(
      `INSERT INTO plays (title, text, source_session_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [title.slice(0, 120), text.slice(0, 600), sourceSessionId ?? null, createdBy ?? null]
    );
    this.playTexts.unshift(`${title}: ${text}`);
    this.playTexts = this.playTexts.slice(0, 12);
    return rows[0]?.id ?? null;
  }

  /**
   * QA review queue: recent calls that need a supervisor's eyes, with the
   * reasons they surfaced. Pure read — computed over the calls table.
   */
  async qaQueue(limit = 50) {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      `SELECT * FROM calls WHERE ended_at IS NOT NULL
       ORDER BY started_at DESC LIMIT $1`,
      [Math.min(limit * 3, 300)]
    );
    const queue: any[] = [];
    for (const r of rows) {
      const reasons: string[] = [];
      const cov = r.coverage_total > 0 ? r.coverage / r.coverage_total : null;
      if (cov !== null && cov < 0.5) reasons.push("low_coverage");
      if ((r.flags ?? []).some((f: any) => f.severity === "alert"))
        reasons.push("alert_flag");
      if (r.unhelpful > r.helpful && r.unhelpful > 0) reasons.push("unhelpful_suggestions");
      if (!r.disposition) reasons.push("no_disposition");
      if (!r.summary) reasons.push("no_summary");
      if (!reasons.length) continue;
      queue.push({ ...this.rowToRecord(r), qaReasons: reasons });
      if (queue.length >= limit) break;
    }
    return queue;
  }

  /**
   * Aggregate analytics for the dashboard over a trailing window.
   * Computed in JS — call volumes are small enough that one scan beats
   * a pile of SQL, and it keeps every metric consistent.
   */
  async analytics(days = 30) {
    if (!this.ready) return null;
    const since = new Date(Date.now() - days * 86400e3);
    const { rows } = await this.pool!.query(
      `SELECT session_id, extension_id, caller_number, started_at, ended_at,
              transcript_segments, suggestions, helpful, unhelpful,
              coverage, coverage_total, flags, disposition, suggestion_events, languages
       FROM calls WHERE started_at >= $1 ORDER BY started_at`,
      [since]
    );

    const byDay = new Map<string, { calls: number; signed: number; alerts: number }>();
    const funnel = { total: 0, signed: 0, callback: 0, attorneyReview: 0, notQualified: 0, spam: 0, none: 0 };
    const suggMap = new Map<string, { count: number; kind: string; escalations: number }>();
    const flagMap = new Map<string, { count: number; severity: string }>();
    const peakHours = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const languages = { en: 0, es: 0, mixed: 0, unknown: 0 };
    const seenCallers = new Set<string>();
    let repeatCalls = 0;
    let durationSum = 0, durationN = 0;
    let coverageSum = 0, coverageN = 0;
    let helpfulSum = 0, feedbackN = 0;
    const perAgent = new Map<string, { calls: number; signed: number; durationSum: number; covSum: number; covN: number; helpful: number; unhelpful: number }>();

    for (const r of rows) {
      const started = new Date(r.started_at);
      const day = started.toISOString().slice(0, 10);
      const alerts = (r.flags ?? []).filter((f: any) => f.severity === "alert").length;
      const d = byDay.get(day) ?? { calls: 0, signed: 0, alerts: 0 };
      d.calls++;
      if (r.disposition === "signed") d.signed++;
      d.alerts += alerts;
      byDay.set(day, d);

      funnel.total++;
      if (r.disposition === "signed") funnel.signed++;
      else if (r.disposition === "callback") funnel.callback++;
      else if (r.disposition === "attorney_review") funnel.attorneyReview++;
      else if (r.disposition === "not_qualified") funnel.notQualified++;
      else if (r.disposition === "spam") funnel.spam++;
      else funnel.none++;

      peakHours[started.getDay()][started.getHours()]++;

      if (r.caller_number) {
        if (seenCallers.has(r.caller_number)) repeatCalls++;
        seenCallers.add(r.caller_number);
      }
      if (r.ended_at) {
        durationSum += new Date(r.ended_at).getTime() - started.getTime();
        durationN++;
      }
      if (r.coverage_total > 0) {
        coverageSum += r.coverage / r.coverage_total;
        coverageN++;
      }
      if (r.helpful + r.unhelpful > 0) {
        helpfulSum += r.helpful / (r.helpful + r.unhelpful);
        feedbackN++;
      }

      const langs: string[] = r.languages ?? [];
      const hasEs = langs.some((l) => l?.startsWith("es"));
      const hasEn = langs.some((l) => l?.startsWith("en"));
      if (hasEs && hasEn) languages.mixed++;
      else if (hasEs) languages.es++;
      else if (hasEn) languages.en++;
      else languages.unknown++;

      for (const f of r.flags ?? []) {
        const e = flagMap.get(f.label) ?? { count: 0, severity: f.severity };
        e.count++;
        flagMap.set(f.label, e);
      }
      for (const s of r.suggestion_events ?? []) {
        const key = `${s.kind}|${s.title}`;
        const e = suggMap.get(key) ?? { count: 0, kind: s.kind, escalations: 0 };
        e.count++;
        if (s.escalate) e.escalations++;
        suggMap.set(key, e);
      }

      const a = perAgent.get(r.extension_id) ?? { calls: 0, signed: 0, durationSum: 0, covSum: 0, covN: 0, helpful: 0, unhelpful: 0 };
      a.calls++;
      if (r.disposition === "signed") a.signed++;
      if (r.ended_at) a.durationSum += new Date(r.ended_at).getTime() - started.getTime();
      if (r.coverage_total > 0) { a.covSum += r.coverage / r.coverage_total; a.covN++; }
      a.helpful += r.helpful;
      a.unhelpful += r.unhelpful;
      perAgent.set(r.extension_id, a);
    }

    return {
      rangeDays: days,
      totals: {
        calls: funnel.total,
        signed: funnel.signed,
        signedRate: funnel.total ? funnel.signed / funnel.total : 0,
        repeatCalls,
        repeatRate: funnel.total ? repeatCalls / funnel.total : 0,
        avgDurationMs: durationN ? durationSum / durationN : 0,
        avgCoverage: coverageN ? coverageSum / coverageN : 0,
        helpfulRate: feedbackN ? helpfulSum / feedbackN : null,
        alerts: [...byDay.values()].reduce((n, d) => n + d.alerts, 0),
      },
      funnel,
      callsByDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      topSuggestions: [...suggMap.entries()]
        .map(([k, v]) => ({ title: k.split("|").slice(1).join("|"), ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
      topFlags: [...flagMap.entries()]
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      peakHours,
      languages,
      perAgent: [...perAgent.entries()].map(([extensionId, a]) => ({
        extensionId,
        name: this.agentNames.get(extensionId),
        calls: a.calls,
        signed: a.signed,
        conversionRate: a.calls ? a.signed / a.calls : 0,
        avgDurationMs: a.calls ? a.durationSum / a.calls : 0,
        avgCoverage: a.covN ? a.covSum / a.covN : 0,
        helpfulRate: a.helpful + a.unhelpful ? a.helpful / (a.helpful + a.unhelpful) : null,
      })),
    };
  }

  /** Admin: full-text search across all calls' transcripts + summaries. */
  async searchCalls(q: string, limit = 40) {
    if (!this.ready || !q.trim()) return [];
    const { rows } = await this.pool!.query(
      `SELECT * FROM calls
       WHERE caller_number ILIKE $1 OR summary::text ILIKE $1 OR transcript::text ILIKE $1
       ORDER BY started_at DESC LIMIT $2`,
      [`%${q.trim()}%`, Math.min(limit, 100)]
    );
    return rows.map((r) => this.rowToRecord(r));
  }

  async listAgents(): Promise<AgentRow[]> {
    if (!this.ready) return [];
    const { rows } = await this.pool!.query(
      "SELECT * FROM agents ORDER BY last_seen DESC"
    );
    return rows.map((r) => ({
      extensionId: r.extension_id,
      name: r.name,
      paired: Boolean(r.token_hash),
      firstSeen: new Date(r.first_seen).getTime(),
      lastSeen: new Date(r.last_seen).getTime(),
    }));
  }
}
