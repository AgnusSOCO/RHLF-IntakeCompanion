import WebSocket from "ws";
import { CallTracker, CallStarted } from "./ringcentral/callTracker";
import { CallPipeline } from "./audio/pipeline";
import { ObjectionEngine } from "./assist/objections";
import { SpeakerChannel } from "./audio/stt";
import { CallLog } from "./callLog";
import { Store } from "./store";

/**
 * Wires everything together:
 *   CallTracker (RingEX events) -> companion control + CallPipeline
 *   Companion WS (/audio)       -> binary PCM frames into the pipeline
 *   UI WS (/ui)                 -> transcripts, suggestions, pause control
 *   Admin WS (/admin)           -> all agent events tagged by extension
 *                                  (for supervisor monitoring / dashboards)
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

export interface AgentStatus {
  extensionId: string;
  name?: string;
  companionConnected: boolean;
  uiClients: number;
  activeSession: string | null;
  callerNumber?: string;
  callStartedAt?: number;
  paused: boolean;
}

export class Hub {
  private agents = new Map<string, AgentSockets>();
  private admins = new Set<WebSocket>();

  constructor(
    private tracker: CallTracker,
    private objections: ObjectionEngine,
    private callLog: CallLog,
    private store: Store
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

  /** Live fleet snapshot for /api/agents. */
  agentStatus(): AgentStatus[] {
    const out: AgentStatus[] = [];
    for (const [extensionId, e] of this.agents) {
      const sessionId = this.tracker.activeSessionFor(extensionId);
      const rec = sessionId ? this.callLog.get(sessionId) : undefined;
      out.push({
        extensionId,
        name: this.store.agentName(extensionId),
        companionConnected: Boolean(e.companion),
        uiClients: e.ui.size,
        activeSession: sessionId ?? null,
        callerNumber: rec?.callerNumber,
        callStartedAt: rec?.startedAt,
        paused: e.pipeline?.isPaused() ?? false,
      });
    }
    return out;
  }

  /** Companion app connection. */
  registerCompanion(extensionId: string, ws: WebSocket): void {
    const e = this.entry(extensionId);
    e.companion?.close();
    e.companion = ws;
    console.log(`[hub] companion connected for extension ${extensionId}`);
    this.broadcastAdmin({ type: "agentOnline", extensionId });

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
      // JSON control from companion (hello, capture health)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "hello") {
          this.store.upsertAgent(extensionId, msg.name);
          this.broadcastUi(extensionId, {
            type: "agentInfo",
            name: this.store.agentName(extensionId) ?? null,
          });
        } else if (msg.type === "state") {
          this.broadcastUi(extensionId, msg);
        }
      } catch {
        /* ignore malformed control */
      }
    });

    ws.on("close", () => {
      if (e.companion === ws) e.companion = undefined;
      console.log(`[hub] companion disconnected for extension ${extensionId}`);
      this.broadcastAdmin({ type: "agentOffline", extensionId });
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
        } else if (msg.type === "feedback") {
          // guidance quality signal - ids only, never transcript content
          const sessionId = this.tracker.activeSessionFor(extensionId);
          const rec = sessionId ? this.callLog.get(sessionId) : undefined;
          if (rec) rec.feedback[msg.helpful ? "helpful" : "unhelpful"]++;
          console.log(
            `[feedback] ext=${extensionId} id=${msg.objectionId} kind=${msg.kind} helpful=${msg.helpful}`
          );
          this.broadcastAdmin({ type: "feedback", extensionId, ...msg });
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

  /** Supervisor/admin connection — every agent event, tagged by extension. */
  registerAdmin(ws: WebSocket): void {
    this.admins.add(ws);
    console.log(`[hub] admin connected (${this.admins.size} clients)`);
    ws.on("close", () => this.admins.delete(ws));
    ws.send(JSON.stringify({ type: "hello", agents: this.agentStatus() }));
  }

  private onCallStarted(c: CallStarted): void {
    const e = this.agents.get(c.extensionId);
    e?.companion?.send(
      JSON.stringify({ type: "callStart", sessionId: c.telephonySessionId, caller: c.callerNumber })
    );
    const rec = this.callLog.start(c.telephonySessionId, c.extensionId, c.callerNumber);
    this.startPipeline(c.extensionId, c.telephonySessionId);
    console.log(`[hub] call started: ext=${c.extensionId} session=${c.telephonySessionId}`);

    // Repeat-caller detection: annotate the callStart broadcast so the agent
    // sees "2nd call from this number" immediately.
    const announce = (priorCalls?: { count: number; lastAt: number | null }) => {
      const payload = { type: "callStart", ...c, priorCalls };
      if (priorCalls) rec.priorCalls = priorCalls;
      this.broadcastUi(c.extensionId, payload);
      this.broadcastAdmin(payload);
    };
    if (this.store.enabled && c.callerNumber) {
      this.store.callerHistory(c.callerNumber).then((h) => {
        announce(h.count > 0 ? h : undefined);
      });
    } else {
      announce();
    }
  }

  private onCallEnded(c: { extensionId: string; telephonySessionId: string }): void {
    const e = this.agents.get(c.extensionId);
    const pipeline = e?.pipeline;
    e && (e.pipeline = undefined);
    e?.companion?.send(JSON.stringify({ type: "callEnd", sessionId: c.telephonySessionId }));
    this.broadcastUi(c.extensionId, { type: "callEnd", ...c });
    this.broadcastAdmin({ type: "callEnd", ...c });
    console.log(`[hub] call ended: ext=${c.extensionId} session=${c.telephonySessionId}`);

    // Post-call: finalize (close STT streams, build summary) then store the record.
    const rec = this.callLog.get(c.telephonySessionId);
    pipeline
      ?.finalize()
      .then((result) => {
        if (!result) return;
        const { summary, transcript, coverage } = result;
        if (rec) {
          rec.endedAt = Date.now();
          rec.transcriptSegments = pipeline.finalCount;
          rec.suggestions = pipeline.suggestionCount;
          if (summary) rec.summary = summary;
          // Persist the full record (transcript + summary + metrics).
          this.store.saveCall(rec, transcript, coverage);
        }
        if (summary) {
          this.broadcastUi(c.extensionId, {
            type: "summary",
            sessionId: c.telephonySessionId,
            ...summary,
          });
          this.broadcastAdmin({
            type: "summary",
            extensionId: c.extensionId,
            sessionId: c.telephonySessionId,
            ...summary,
          });
        }
      })
      .catch(() => {});
  }

  private startPipeline(extensionId: string, sessionId: string): void {
    const e = this.entry(extensionId);
    e.pipeline?.dispose();
    const pipeline = new CallPipeline(sessionId, extensionId, this.objections);
    e.pipeline = pipeline;

    const fanOut = (msg: unknown) => {
      this.broadcastUi(extensionId, msg);
      this.broadcastAdmin({ extensionId, ...(msg as object) });
    };
    pipeline.bus.on("transcript", (t) => fanOut({ type: "transcript", ...t }));
    pipeline.bus.on("suggestion", (s) => fanOut({ type: "suggestion", ...s }));
    pipeline.bus.on("checklist", (items) => fanOut({ type: "checklist", items }));
    pipeline.bus.on("flags", (flags) => fanOut({ type: "flags", flags }));
    pipeline.bus.on("stt-error", (err) => {
      console.error(`[stt] ext=${extensionId}: ${err.message}`);
      fanOut({ type: "stt-error", message: err.message });
    });
    pipeline.bus.on("assist-thinking", () => fanOut({ type: "assist-thinking" }));
    pipeline.bus.on("paused", (p) => fanOut({ type: "paused", paused: p }));
  }

  private broadcastUi(extensionId: string, msg: unknown): void {
    const e = this.agents.get(extensionId);
    if (!e) return;
    const payload = JSON.stringify(msg);
    for (const ws of e.ui) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private broadcastAdmin(msg: unknown): void {
    if (this.admins.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const ws of this.admins) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}
