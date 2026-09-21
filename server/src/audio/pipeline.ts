import { EventEmitter } from "node:events";
import { DeepgramLiveStream, SpeakerChannel, TranscriptResult } from "./stt";
import { ObjectionEngine, Suggestion } from "../assist/objections";
import { assistWithAi, askAssistant, extractChecklist, summarizeCall, CallSummary, CallFlag } from "../assist/ai";
import { INTAKE_CHECKLIST, ChecklistItem } from "../assist/checklist";
import { ScriptEngine, ScriptState } from "../assist/script";
import { config } from "../config";

/**
 * Per-call processing pipeline: two STT streams (caller = RingCentral
 * playback, agent = headset mic) plus assist on caller finals.
 *
 * Assist order (latency-first):
 *   1. Playbook keyword match -> instant approved response (no LLM call).
 *   2. LLM draft -> emitted async with a preceding "assist-thinking" event.
 *   3. If no LLM is configured, an unmatched caller question is flagged so
 *      the agent knows to escalate rather than improvise.
 *
 * Background work (latency-independent):
 *   - Every CHECKLIST_INTERVAL_MS, asks the LLM which intake fields the call
 *     has covered so far -> "checklist" event for the UI strip.
 *   - finalize() on call end -> post-call summary for case notes / dashboard.
 *
 * Emits on `bus`:
 *   "transcript"       TranscriptResult
 *   "suggestion"       Suggestion
 *   "assist-thinking"  {} — UI shows a pending card while the LLM runs
 *   "checklist"        ChecklistItem[]
 *   "fields"           Record<string,string> — live caller-card values (deduped)
 *   "flags"            CallFlag[] — live risk/moment flags (deduped)
 *   "stt-error"        Error
 */
const MAX_HISTORY = 12;
const MAX_AI_IN_FLIGHT = 2;
const AI_COOLDOWN_MS = 8_000;
const CHECKLIST_INTERVAL_MS = 12_000;
// Dead-air: this long with no transcript activity on either channel nudges
// the agent to re-engage before the caller cools off.
const DEAD_AIR_MS = 6_000;
const DEAD_AIR_POLL_MS = 1_000;
// Speculative assist: when a caller interim stops changing for this long we
// run detection/AI before the final transcript arrives — suggestion lands
// ~endpointing+LLM sooner, so the agent sees it as the caller finishes.
const SPEC_STABLE_MS = 450;
const SPEC_MIN_CHARS = 18;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9áéíóúñü\s]/gi, " ").replace(/\s+/g, " ").trim();
}

/** Same utterance check: either is a prefix of the other beyond a few words. */
function sameUtterance(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) || shorter.startsWith(longer.slice(0, Math.min(40, longer.length)));
}

export class CallPipeline {
  readonly bus = new EventEmitter();
  private streams: Record<SpeakerChannel, DeepgramLiveStream>;
  private paused = false;
  private history: { speaker: string; text: string; language?: string }[] = [];
  private fullTranscript: { speaker: string; text: string; language?: string }[] = [];
  private aiInFlight = 0;
  private lastAiAt = 0;
  private extractedFinals = 0;
  private checklistTimer?: NodeJS.Timeout;
  private finalized = false;
  private specTimer?: NodeJS.Timeout;
  private specForText = "";    // normalized interim the spec run covered
  private specEmitted = false; // a suggestion already fired for that utterance
  private specInFlight = false; // spec AI call still resolving
  private seenFlags = new Set<string>(); // dedupe live flags across extraction passes
  private emittedFlags: CallFlag[] = []; // persisted on the call record
  private seenNudges = new Set<string>(); // dedupe empathy/compliance nudges
  private liveFields: Record<string, string> = {};
  private lastChecklistItems: ChecklistItem[] = [];
  private lastCovered: Record<string, string> = {};
  private lastScriptJson = "";
  private manualScriptDone = new Set<string>();
  private readonly startedAt = Date.now();
  private lastActivityAt = Date.now();
  private deadAirFired = false;
  private deadAirTimer?: NodeJS.Timeout;
  /** Counters for the per-call record (dashboard metrics). */
  suggestionCount = 0;
  finalCount = 0;

  constructor(
    readonly telephonySessionId: string,
    readonly extensionId: string,
    private objections: ObjectionEngine,
    private getBestPlays?: () => Promise<string[]>,
    private script?: ScriptEngine
  ) {
    this.streams = {
      caller: this.makeStream("caller"),
      agent: this.makeStream("agent"),
    };
    this.streams.caller.open();
    this.streams.agent.open();
    if (config.llmApiKey) {
      this.checklistTimer = setInterval(() => this.refreshChecklist(), CHECKLIST_INTERVAL_MS);
    }
    this.deadAirTimer = setInterval(() => this.checkDeadAir(), DEAD_AIR_POLL_MS);
  }

  private makeStream(speaker: SpeakerChannel): DeepgramLiveStream {
    return new DeepgramLiveStream(
      speaker,
      (r) => this.onTranscript(r),
      (e) => this.bus.emit("stt-error", e)
    );
  }

  private onTranscript(r: TranscriptResult): void {
    this.lastActivityAt = Date.now();
    this.deadAirFired = false;
    this.bus.emit("transcript", r);
    if (r.isFinal) {
      const entry = { speaker: r.speaker, text: r.text, language: r.language };
      this.history.push(entry);
      if (this.history.length > MAX_HISTORY) this.history.shift();
      this.fullTranscript.push(entry);
      this.finalCount++;
    }
    if (r.speaker !== "caller" || this.paused) return;

    if (!r.isFinal) {
      this.scheduleSpeculative(r);
      return;
    }

    clearTimeout(this.specTimer);
    // If the spec run already covered this utterance — emitted a suggestion,
    // or an AI call is still resolving (its emit is what the agent sees) —
    // the final just confirms it. Don't double-fire or burn a second LLM call.
    const norm = normalize(r.text);
    if (this.specForText && sameUtterance(this.specForText, norm)) {
      if (this.specEmitted || this.specInFlight) {
        this.specEmitted = false;
        if (!this.specInFlight) this.specForText = "";
        return;
      }
      this.specForText = ""; // spec produced nothing — fall through to normal path
    }
    this.specEmitted = false;

    const approved = this.objections.detect(r.text, r.language);
    if (approved) {
      this.suggestionCount++;
      this.bus.emit("suggestion", approved);
      return;
    }

    if (config.llmApiKey) {
      this.askAi(r);
    } else {
      const flagged = this.objections.flagQuestion(r.text, r.language);
      if (flagged) this.bus.emit("suggestion", flagged);
    }
  }

  /**
   * Caller paused mid-utterance: if the interim looks like a complete thought,
   * run detection now instead of waiting for the endpointing delay + final.
   */
  private scheduleSpeculative(r: TranscriptResult): void {
    clearTimeout(this.specTimer);
    const norm = normalize(r.text);
    if (norm.length < SPEC_MIN_CHARS) return;
    this.specTimer = setTimeout(() => this.runSpeculative(r), SPEC_STABLE_MS);
  }

  private runSpeculative(r: TranscriptResult): void {
    if (this.finalized || this.paused) return;
    const norm = normalize(r.text);
    this.specForText = norm;

    // Playbook hit on a stable interim: the objection already exists — extra
    // words won't un-say it. Emit immediately (saves the whole endpointing wait).
    const approved = this.objections.detect(r.text, r.language);
    if (approved) {
      this.specEmitted = true;
      this.suggestionCount++;
      this.bus.emit("suggestion", approved);
      return;
    }

    if (!config.llmApiKey) return;
    if (this.aiInFlight >= MAX_AI_IN_FLIGHT || Date.now() - this.lastAiAt < AI_COOLDOWN_MS) return;

    this.aiInFlight++;
    this.specInFlight = true;
    this.lastAiAt = Date.now();
    this.bus.emit("assist-thinking", {});
    const plays = this.getBestPlays?.();
    Promise.resolve(plays)
      .then((p) => assistWithAi(this.history, r.text, r.language, p))
      .then((res) => {
        if (!res) return;
        // A different utterance superseded this interim while the call ran.
        if (!sameUtterance(this.specForText, norm)) return;
        this.specEmitted = true;
        this.suggestionCount++;
        this.bus.emit("suggestion", {
          kind: "ai",
          objectionId: "ai",
          title: res.title,
          language: r.language === "es" ? "es" : "en",
          response: res.response,
          followUp: res.followUp,
          escalate: res.escalate,
          matchedText: r.text,
        } satisfies Suggestion);
      })
      .catch((e) => this.bus.emit("stt-error", e))
      .finally(() => {
        this.aiInFlight--;
        this.specInFlight = false;
      });
  }

  private askAi(r: TranscriptResult): void {
    const now = Date.now();
    if (this.aiInFlight >= MAX_AI_IN_FLIGHT || now - this.lastAiAt < AI_COOLDOWN_MS) {
      const flagged = this.objections.flagQuestion(r.text, r.language);
      if (flagged) this.bus.emit("suggestion", flagged);
      return;
    }
    this.aiInFlight++;
    this.lastAiAt = now;
    this.bus.emit("assist-thinking", {});
    Promise.resolve(this.getBestPlays?.())
      .then((p) => assistWithAi(this.history, r.text, r.language, p))
      .then((res) => {
        if (!res) return;
        const suggestion: Suggestion = {
          kind: "ai",
          objectionId: "ai",
          title: res.title,
          language: r.language === "es" ? "es" : "en",
          response: res.response,
          followUp: res.followUp,
          escalate: res.escalate,
          matchedText: r.text,
        };
        this.suggestionCount++;
        this.bus.emit("suggestion", suggestion);
      })
      .catch((e) => this.bus.emit("stt-error", e))
      .finally(() => this.aiInFlight--);
  }

  /** Agent tapped a pending script step to mark it done manually. */
  markScriptStepDone(stepId: string): void {
    if (this.finalized || !stepId) return;
    this.manualScriptDone.add(stepId.slice(0, 64));
    this.refreshScript();
  }

  /**
   * Agent-initiated assist: the UI sent a free-text question mid-call.
   * Bypasses detection cooldowns — the agent explicitly asked for help.
   */
  requestAssist(question: string): void {
    if (this.finalized || !config.llmApiKey) return;
    this.bus.emit("assist-thinking", {});
    const history = [...this.history];
    Promise.resolve(this.getBestPlays?.())
      .then((plays) => askAssistant(history, question, undefined, plays))
      .then((res) => {
        if (!res) return;
        this.suggestionCount++;
        this.bus.emit("suggestion", {
          kind: "ai",
          objectionId: `ask-${Date.now()}`,
          title: res.title,
          language: "en",
          response: res.response,
          followUp: res.followUp,
          escalate: res.escalate,
          matchedText: question,
        } satisfies Suggestion);
      })
      .catch((e) => this.bus.emit("stt-error", e));
  }

  /**
   * Silence watchdog: no transcript activity on either channel for
   * DEAD_AIR_MS -> one nudge per lull (re-arms when speech resumes).
   */
  /** Re-evaluate the dynamic script; emit only when the state changed. */
  private refreshScript(): void {
    if (!this.script?.enabled || this.finalized) return;
    const state: ScriptState = this.script.evaluate({
      covered: this.lastCovered,
      fields: this.liveFields,
      flags: this.emittedFlags,
      elapsedMs: Date.now() - this.startedAt,
      doneIds: this.manualScriptDone,
    });
    const json = JSON.stringify(state);
    if (json !== this.lastScriptJson) {
      this.lastScriptJson = json;
      this.bus.emit("script", state);
    }
  }

  private checkDeadAir(): void {
    this.refreshScript(); // autoAfter steps tick here even with no new speech
    if (this.paused || this.finalized || this.deadAirFired) return;
    if (Date.now() - this.lastActivityAt < DEAD_AIR_MS) return;
    this.deadAirFired = true;
    this.bus.emit("suggestion", {
      kind: "nudge",
      objectionId: "dead-air",
      title: "Re-engage the caller",
      language: "en",
      response:
        "Confirm the next step out loud — ask a question, recap what you have, or offer to schedule the consultation.",
      followUp: "",
      escalate: false,
      matchedText: "",
    } satisfies Suggestion);
  }

  private emitNudge(text: string): void {
    const key = normalize(text);
    if (this.seenNudges.has(key)) return;
    this.seenNudges.add(key);
    this.bus.emit("suggestion", {
      kind: "nudge",
      objectionId: `nudge-${key.slice(0, 24)}`,
      title: "Coaching nudge",
      language: "en",
      response: text,
      followUp: "",
      escalate: false,
      matchedText: "",
    } satisfies Suggestion);
  }

  private refreshChecklist(): void {
    if (this.paused || this.finalized) return;
    if (this.fullTranscript.length === this.extractedFinals) return;
    this.extractedFinals = this.fullTranscript.length;
    extractChecklist(this.fullTranscript)
      .then((result) => {
        if (!result) return;
        const items: ChecklistItem[] = INTAKE_CHECKLIST.map((f) => ({
          id: f.id,
          label: f.label,
          covered: f.id in result.covered,
          detail: result.covered[f.id],
        }));
        this.lastChecklistItems = items;
        this.lastCovered = result.covered;
        this.bus.emit("checklist", items);
        this.refreshScript();
        // Live lead-sheet values — emit only when something changed.
        const changed = Object.entries(result.fields).filter(
          ([k, v]) => this.liveFields[k] !== v
        );
        if (changed.length) {
          this.liveFields = { ...this.liveFields, ...result.fields };
          this.bus.emit("fields", this.liveFields);
        }
        for (const n of result.nudges) this.emitNudge(n.text);
        // New flags only — each pass re-scans the whole transcript window.
        const fresh = result.flags.filter(
          (f) => !this.seenFlags.has(f.label.toLowerCase())
        );
        if (fresh.length) {
          for (const f of fresh) this.seenFlags.add(f.label.toLowerCase());
          this.emittedFlags.push(...fresh);
          this.bus.emit("flags", fresh);
        }
      })
      .catch(() => {});
  }

  /** Call ended: stop capture; return summary + transcript + coverage for storage. */
  async finalize(): Promise<{
    summary: CallSummary | null;
    transcript: { speaker: string; text: string }[];
    coverage: { covered: number; total: number };
    flags: CallFlag[];
    missingFields: string[];
  } | null> {
    if (this.finalized) return null;
    this.finalized = true;
    clearInterval(this.checklistTimer);
    clearInterval(this.deadAirTimer);
    clearTimeout(this.specTimer);
    this.streams.caller.close();
    this.streams.agent.close();
    const summary = await summarizeCall(this.fullTranscript).catch(() => null);
    // Merge live-extracted caller-card values into the summary fields — the
    // live pass often catches details the one-shot summary misses.
    if (summary) {
      summary.fields = { ...this.liveFields, ...summary.fields };
    }
    const coverage = {
      covered: this.lastChecklistItems.filter((i) => i.covered).length,
      total: this.lastChecklistItems.length || INTAKE_CHECKLIST.length,
    };
    const missingFields = this.lastChecklistItems.length
      ? this.lastChecklistItems.filter((i) => !i.covered).map((i) => i.label)
      : [];
    this.bus.removeAllListeners();
    return {
      summary,
      transcript: this.fullTranscript,
      coverage,
      flags: this.emittedFlags,
      missingFields,
    };
  }

  sendAudio(channel: SpeakerChannel, pcm: Buffer): void {
    if (this.paused) return;
    this.streams[channel].send(pcm);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.bus.emit("paused", paused);
  }

  isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    this.finalized = true;
    clearInterval(this.checklistTimer);
    clearInterval(this.deadAirTimer);
    clearTimeout(this.specTimer);
    this.streams.caller.close();
    this.streams.agent.close();
    this.bus.removeAllListeners();
  }
}
