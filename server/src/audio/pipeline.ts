import { EventEmitter } from "node:events";
import { DeepgramLiveStream, SpeakerChannel, TranscriptResult } from "./stt";
import { ObjectionEngine, Suggestion } from "../assist/objections";
import { assistWithAi } from "../assist/ai";
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
 * Emits on `bus`:
 *   "transcript"       TranscriptResult
 *   "suggestion"       Suggestion
 *   "assist-thinking"  {} — UI shows a pending card while the LLM runs
 *   "stt-error"        Error
 */
const MAX_HISTORY = 12;
const MAX_AI_IN_FLIGHT = 2;
const AI_COOLDOWN_MS = 8_000;

export class CallPipeline {
  readonly bus = new EventEmitter();
  private streams: Record<SpeakerChannel, DeepgramLiveStream>;
  private paused = false;
  private history: { speaker: string; text: string }[] = [];
  private aiInFlight = 0;
  private lastAiAt = 0;

  constructor(
    readonly telephonySessionId: string,
    readonly extensionId: string,
    private objections: ObjectionEngine
  ) {
    this.streams = {
      caller: this.makeStream("caller"),
      agent: this.makeStream("agent"),
    };
    this.streams.caller.open();
    this.streams.agent.open();
  }

  private makeStream(speaker: SpeakerChannel): DeepgramLiveStream {
    return new DeepgramLiveStream(
      speaker,
      (r) => this.onTranscript(r),
      (e) => this.bus.emit("stt-error", e)
    );
  }

  private onTranscript(r: TranscriptResult): void {
    this.bus.emit("transcript", r);
    if (r.isFinal) {
      this.history.push({ speaker: r.speaker, text: r.text });
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    if (r.speaker !== "caller" || !r.isFinal || this.paused) return;

    const approved = this.objections.detect(r.text, r.language);
    if (approved) {
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
    assistWithAi(this.history, r.text, r.language)
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
        this.bus.emit("suggestion", suggestion);
      })
      .catch((e) => this.bus.emit("stt-error", e))
      .finally(() => this.aiInFlight--);
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
    this.streams.caller.close();
    this.streams.agent.close();
    this.bus.removeAllListeners();
  }
}
