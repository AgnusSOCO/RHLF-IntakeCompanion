import { EventEmitter } from "node:events";
import { DeepgramLiveStream, SpeakerChannel } from "./stt";
import { ObjectionEngine } from "../assist/objections";

/**
 * Per-call processing pipeline: two STT streams (caller = RingCentral
 * playback, agent = headset mic) plus objection detection on caller finals.
 *
 * Emits on `bus`:
 *   "transcript"  TranscriptResult
 *   "suggestion"  Suggestion
 *   "stt-error"   Error
 */
export class CallPipeline {
  readonly bus = new EventEmitter();
  private streams: Record<SpeakerChannel, DeepgramLiveStream>;
  private paused = false;

  constructor(
    readonly telephonySessionId: string,
    readonly extensionId: string,
    objections: ObjectionEngine
  ) {
    this.streams = {
      caller: this.makeStream("caller", objections),
      agent: this.makeStream("agent", objections),
    };
    this.streams.caller.open();
    this.streams.agent.open();
  }

  private makeStream(speaker: SpeakerChannel, objections: ObjectionEngine): DeepgramLiveStream {
    return new DeepgramLiveStream(
      speaker,
      (r) => {
        this.bus.emit("transcript", r);
        if (r.speaker === "caller" && r.isFinal && !this.paused) {
          const suggestion = objections.detect(r.text, r.language);
          if (suggestion) this.bus.emit("suggestion", suggestion);
        }
      },
      (e) => this.bus.emit("stt-error", e)
    );
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
