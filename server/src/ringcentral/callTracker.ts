import { EventEmitter } from "node:events";

/**
 * Tracks active RingEX calls from Telephony Session Notification payloads.
 *
 * Emits:
 *   "callStarted"  { extensionId, telephonySessionId, agentPartyId, callerNumber }
 *   "callEnded"    { extensionId, telephonySessionId }
 *
 * A call is "active" for an agent while that agent's party is Answered/Held.
 * "Gone" covers transfers, monitoring joins, and call flips - treated as end
 * for the PoC; revisit if transfers mid-call must keep assisting.
 */

export interface CallStarted {
  extensionId: string;
  telephonySessionId: string;
  agentPartyId: string;
  callerNumber?: string;
}

interface Party {
  id: string;
  direction?: string;
  status?: { code?: string; reason?: string };
  owner?: { accountId?: string; extensionId?: string };
  from?: { phoneNumber?: string; name?: string };
  to?: { phoneNumber?: string; name?: string };
  muted?: boolean;
}

interface TelephonyEvent {
  body?: {
    telephonySessionId?: string;
    parties?: Party[];
    eventTime?: string;
  };
}

interface SessionState {
  agentExtensionId: string;
  agentPartyId: string;
  active: boolean;
  seenStatuses: Map<string, string>;
  callerNumber?: string;
}

const END_STATES = new Set(["Disconnected", "Gone"]);
const ACTIVE_STATES = new Set(["Answered", "Hold"]);

export class CallTracker extends EventEmitter {
  private sessions = new Map<string, SessionState>();

  handleTelephonyEvent(evt: TelephonyEvent): void {
    const body = evt.body;
    if (!body?.telephonySessionId || !Array.isArray(body.parties)) return;

    const sessionId = body.telephonySessionId;

    for (const party of body.parties) {
      const ext = party.owner?.extensionId;
      const code = party.status?.code;
      if (!ext || !party.id || !code) continue;

      const existing = this.sessions.get(sessionId);
      if (existing?.seenStatuses.get(party.id) === code) continue;
      existing?.seenStatuses.set(party.id, code);

      const isAgentParty = Boolean(party.owner?.extensionId);

      if (!existing && isAgentParty && ACTIVE_STATES.has(code)) {
        const caller = body.parties.find((p) => p.id !== party.id);
        const next: SessionState = {
          agentExtensionId: ext,
          agentPartyId: party.id,
          active: true,
          seenStatuses: new Map([[party.id, code]]),
          callerNumber: caller?.from?.phoneNumber ?? caller?.to?.phoneNumber,
        };
        this.sessions.set(sessionId, next);
        this.emit("callStarted", {
          extensionId: ext,
          telephonySessionId: sessionId,
          agentPartyId: party.id,
          callerNumber: next.callerNumber,
        } satisfies CallStarted);
        continue;
      }

      if (existing && party.id === existing.agentPartyId && END_STATES.has(code)) {
        existing.active = false;
        this.sessions.delete(sessionId);
        this.emit("callEnded", {
          extensionId: existing.agentExtensionId,
          telephonySessionId: sessionId,
        });
      }
    }

    // Defensive cleanup: no remaining active-looking parties at all.
    const s = this.sessions.get(sessionId);
    if (s && body.parties.every((p) => END_STATES.has(p.status?.code ?? ""))) {
      this.sessions.delete(sessionId);
      this.emit("callEnded", {
        extensionId: s.agentExtensionId,
        telephonySessionId: sessionId,
      });
    }
  }

  activeSessionFor(extensionId: string): string | undefined {
    for (const [id, s] of this.sessions) {
      if (s.active && s.agentExtensionId === extensionId) return id;
    }
    return undefined;
  }
}
