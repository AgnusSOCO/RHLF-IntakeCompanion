import type { CallSummary } from "./assist/ai";

/**
 * In-memory per-call records: metrics + post-call summaries for the admin
 * surface (/api/calls, admin WS). PoC storage — replace with Postgres when the
 * rhlf-ai dashboard integration lands.
 */
export interface CallRecord {
  sessionId: string;
  extensionId: string;
  callerNumber?: string;
  startedAt: number;
  endedAt?: number;
  transcriptSegments: number;
  suggestions: number;
  feedback: { helpful: number; unhelpful: number };
  summary?: CallSummary;
  /** Set at call start when this number has called before. */
  priorCalls?: { count: number; lastAt: number | null };
}

const MAX_RECORDS = 500;

export class CallLog {
  private records = new Map<string, CallRecord>();
  private order: string[] = [];

  start(sessionId: string, extensionId: string, callerNumber?: string): CallRecord {
    const rec: CallRecord = {
      sessionId,
      extensionId,
      callerNumber,
      startedAt: Date.now(),
      transcriptSegments: 0,
      suggestions: 0,
      feedback: { helpful: 0, unhelpful: 0 },
    };
    this.records.set(sessionId, rec);
    this.order.push(sessionId);
    while (this.order.length > MAX_RECORDS) {
      const evict = this.order.shift()!;
      this.records.delete(evict);
    }
    return rec;
  }

  get(sessionId: string): CallRecord | undefined {
    return this.records.get(sessionId);
  }

  /** Newest first. */
  list(limit = 100): CallRecord[] {
    return [...this.order].reverse().slice(0, limit)
      .map((id) => this.records.get(id)!)
      .filter(Boolean);
  }
}
