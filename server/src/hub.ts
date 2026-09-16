import WebSocket from "ws";
import { CallTracker, CallStarted } from "./ringcentral/callTracker";
import { CallPipeline } from "./audio/pipeline";
import { ObjectionEngine } from "./assist/objections";
import { SpeakerChannel } from "./audio/stt";

/**
 * Wires everything together:
 *   CallTracker (RingEX events) -> companion control + CallPipeline
 *   Companion WS (/audio)       -> binary PCM frames into the pipeline
 *   UI WS (/ui)                 -> transcripts, suggestions, pause control
 *
 * Audio frame protocol from the companion:
 *   binary frame, byte[0] = channel (0 = caller/playback, 1 = agent/mic),
 *   byte[1..] = s16le 16 kHz mono PCM.
 */

interface AgentSockets {
  companion?: WebSocket;
  ui: Set<WebSocket>;
  pipeline?: CallPipeline;
}

export class Hub {
  private agents = new Map<string, AgentSockets>();

  constructor(
    private tracker: CallTracker,
    private objections: ObjectionEngine
  ) {
    tracker.on("callStarted", (c: CallStarted) => this.onCallStarted(c));
    tracker.on("callEnded", (c: { extensionId: string; telephonySessionId: string }) =>
      this.onCallEnded(c)
    );
  }

  private entry(extensionId: string): AgentSockets {
    let e = this.agents.get(extensionId);
    if (!e) {
      e = { ui: new Set() };
      this.agents.set(extensionId, e);
    }
    return e;
  }

  /** Companion app connection. */
  registerCompanion(extensionId: string, ws: WebSocket): void {
    const e = this.entry(extensionId);
    e.companion?.close();
    e.companion = ws;
    console.log(`[hub] companion connected for extension ${extensionId}`);

    let audioBytes = { caller: 0, agent: 0 };
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        if (buf.length < 2) return;
        const channel: SpeakerChannel = buf[0] === 0 ? "caller" : "agent";
        audioBytes[channel] += buf.length;
        const total = audioBytes.caller + audioBytes.agent;
        if (total === buf.length || total % 250_000 < buf.length) {
          // first frame + ~250KB milestones (~8s of audio/channel at 16kHz mono)
          console.log(
            `[audio] ext=${extensionId} caller=${(audioBytes.caller / 1e3).toFixed(0)}KB agent=${(audioBytes.agent / 1e3).toFixed(0)}KB`
          );
        }
        e.pipeline?.sendAudio(channel, buf.subarray(1));
        return;
      }
      // JSON control from companion (e.g. capture health)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "state") this.broadcastUi(extensionId, msg);
      } catch {
        /* ignore malformed control */
      }
    });

    ws.on("close", () => {
      if (e.companion === ws) e.companion = undefined;
      console.log(`[hub] companion disconnected for extension ${extensionId}`);
    });

    // If a call is already active (companion reconnected mid-call), resume.
    const active = this.tracker.activeSessionFor(extensionId);
    if (active) {
      ws.send(JSON.stringify({ type: "callStart", sessionId: active }));
      this.startPipeline(extensionId, active);
    }
  }

  /** Agent sidebar/UI connection. */
  registerUi(extensionId: string, ws: WebSocket): void {
    const e = this.entry(extensionId);
    e.ui.add(ws);
    console.log(`[hub] UI connected for extension ${extensionId} (${e.ui.size} clients)`);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pause" && typeof msg.paused === "boolean") {
          e.pipeline?.setPaused(msg.paused);
          e.companion?.send(JSON.stringify({ type: "pause", paused: msg.paused }));
        }
      } catch {
        /* ignore malformed control */
      }
    });

    ws.on("close", () => e.ui.delete(ws));
    ws.send(
      JSON.stringify({
        type: "hello",
        extensionId,
        activeSession: this.tracker.activeSessionFor(extensionId) ?? null,
      })
    );
  }

  private onCallStarted(c: CallStarted): void {
    const e = this.agents.get(c.extensionId);
    e?.companion?.send(
      JSON.stringify({ type: "callStart", sessionId: c.telephonySessionId, caller: c.callerNumber })
    );
    this.startPipeline(c.extensionId, c.telephonySessionId);
    this.broadcastUi(c.extensionId, { type: "callStart", ...c });
    console.log(`[hub] call started: ext=${c.extensionId} session=${c.telephonySessionId}`);
  }

  private onCallEnded(c: { extensionId: string; telephonySessionId: string }): void {
    const e = this.agents.get(c.extensionId);
    e?.pipeline?.dispose();
    e && (e.pipeline = undefined);
    e?.companion?.send(JSON.stringify({ type: "callEnd", sessionId: c.telephonySessionId }));
    this.broadcastUi(c.extensionId, { type: "callEnd", ...c });
    console.log(`[hub] call ended: ext=${c.extensionId} session=${c.telephonySessionId}`);
  }

  private startPipeline(extensionId: string, sessionId: string): void {
    const e = this.entry(extensionId);
    e.pipeline?.dispose();
    const pipeline = new CallPipeline(sessionId, extensionId, this.objections);
    e.pipeline = pipeline;

    pipeline.bus.on("transcript", (t) => this.broadcastUi(extensionId, { type: "transcript", ...t }));
    pipeline.bus.on("suggestion", (s) =>
      this.broadcastUi(extensionId, { type: "suggestion", ...s })
    );
    pipeline.bus.on("stt-error", (err) => {
      console.error(`[stt] ext=${extensionId}: ${err.message}`);
      this.broadcastUi(extensionId, { type: "stt-error", message: err.message });
    });
    pipeline.bus.on("assist-thinking", () =>
      this.broadcastUi(extensionId, { type: "assist-thinking" })
    );
    pipeline.bus.on("paused", (p) => this.broadcastUi(extensionId, { type: "paused", paused: p }));
  }

  private broadcastUi(extensionId: string, msg: unknown): void {
    const e = this.agents.get(extensionId);
    if (!e) return;
    const payload = JSON.stringify(msg);
    for (const ws of e.ui) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}
