import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  GuidanceItem,
  ServerEvent,
  Speaker,
  TranscriptSegment,
} from "./types";

export type ConnStatus = "connecting" | "online" | "offline";

interface Interim {
  text: string;
  language?: string;
}

interface State {
  conn: ConnStatus;
  call: { active: boolean; callerNumber?: string; startedAt?: number };
  paused: boolean;
  thinking: boolean;
  segments: TranscriptSegment[];
  interim: Partial<Record<Speaker, Interim>>;
  cards: GuidanceItem[];
  error?: string;
}

type Action =
  | { t: "conn"; v: ConnStatus }
  | { t: "callStart"; callerNumber?: string }
  | { t: "callEnd" }
  | { t: "paused"; v: boolean }
  | { t: "thinking" }
  | { t: "error"; v?: string }
  | { t: "interim"; speaker: Speaker; text: string; language?: string }
  | { t: "final"; speaker: Speaker; text: string; language?: string }
  | { t: "card"; card: GuidanceItem }
  | { t: "dismiss"; key: string }
  | { t: "feedback"; key: string; v: "helpful" | "unhelpful" }
  | { t: "ageCards" };

const CARD_STALE_MS = 90_000;
const CARD_REMOVE_MS = 150_000;
const MAX_SEGMENTS = 300;

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "conn":
      return { ...s, conn: a.v };
    case "callStart":
      return {
        ...s,
        call: { active: true, callerNumber: a.callerNumber, startedAt: Date.now() },
        cards: [],
        thinking: false,
        segments: [],
        interim: {},
        error: undefined,
      };
    case "callEnd":
      return {
        ...s,
        call: { ...s.call, active: false },
        thinking: false,
        interim: {},
      };
    case "paused":
      return { ...s, paused: a.v };
    case "thinking":
      return s.call.active ? { ...s, thinking: true } : s;
    case "error":
      return { ...s, error: a.v };
    case "interim":
      return {
        ...s,
        interim: { ...s.interim, [a.speaker]: { text: a.text, language: a.language } },
      };
    case "final": {
      const interim = { ...s.interim };
      delete interim[a.speaker];
      const seg: TranscriptSegment = {
        id: Date.now() + Math.random(),
        speaker: a.speaker,
        text: a.text,
        language: a.language,
        ts: Date.now(),
      };
      const segments = [...s.segments, seg].slice(-MAX_SEGMENTS);
      return { ...s, interim, segments };
    }
    case "card": {
      if (s.cards.some((c) => c.key === a.card.key)) return s;
      return { ...s, thinking: false, cards: [a.card, ...s.cards] };
    }
    case "dismiss":
      return { ...s, cards: s.cards.filter((c) => c.key !== a.key) };
    case "feedback":
      return {
        ...s,
        cards: s.cards.map((c) => (c.key === a.key ? { ...c, feedback: a.v } : c)),
      };
    case "ageCards":
      return { ...s, cards: s.cards.filter((c) => Date.now() - c.receivedAt < CARD_REMOVE_MS) };
    default:
      return s;
  }
}

const initial: State = {
  conn: "connecting",
  call: { active: false },
  paused: false,
  thinking: false,
  segments: [],
  interim: {},
  cards: [],
};

export function useAssistant(extensionId: string | null, token: string | null) {
  const [state, dispatch] = useReducer(reducer, initial);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!extensionId || !token) return;
    let dead = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (dead) return;
      dispatch({ t: "conn", v: "connecting" });
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${proto}://${location.host}/ui?extensionId=${extensionId}&token=${token}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        dispatch({ t: "conn", v: "online" });
      };
      ws.onclose = () => {
        if (dead) return;
        dispatch({ t: "conn", v: "offline" });
        dispatch({ t: "callEnd" });
        const delay = Math.min(8000, 500 * 2 ** retryRef.current++);
        retryTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data as string) as ServerEvent;
        switch (m.type) {
          case "callStart":
            dispatch({ t: "callStart", callerNumber: m.callerNumber });
            break;
          case "callEnd":
            dispatch({ t: "callEnd" });
            break;
          case "state":
            if (typeof m.paused === "boolean") dispatch({ t: "paused", v: m.paused });
            break;
          case "paused":
            dispatch({ t: "paused", v: m.paused });
            break;
          case "assist-thinking":
            dispatch({ t: "thinking" });
            break;
          case "stt-error":
            dispatch({ t: "error", v: m.message });
            break;
          case "transcript":
            if (!m.text?.trim()) break;
            if (m.isFinal) {
              dispatch({ t: "final", speaker: m.speaker, text: m.text, language: m.language });
            } else {
              dispatch({ t: "interim", speaker: m.speaker, text: m.text, language: m.language });
            }
            break;
          case "suggestion":
            dispatch({
              t: "card",
              card: {
                key: `${m.objectionId}|${m.title}`,
                kind: m.kind ?? "objection",
                title: m.title,
                response: m.response,
                followUp: m.followUp,
                escalate: m.escalate,
                matchedText: m.matchedText,
                language: m.language,
                objectionId: m.objectionId,
                receivedAt: Date.now(),
              },
            });
            break;
        }
      };
    };

    connect();
    const ageTimer = window.setInterval(() => dispatch({ t: "ageCards" }), 5000);
    return () => {
      dead = true;
      clearInterval(ageTimer);
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [extensionId, token]);

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const setPaused = useCallback(
    (v: boolean) => {
      dispatch({ t: "paused", v });
      send({ type: "pause", paused: v });
    },
    [send]
  );

  const dismiss = useCallback((key: string) => dispatch({ t: "dismiss", key }), []);

  const sendFeedback = useCallback(
    (card: GuidanceItem, helpful: boolean) => {
      dispatch({ t: "feedback", key: card.key, v: helpful ? "helpful" : "unhelpful" });
      send({
        type: "feedback",
        objectionId: card.objectionId,
        kind: card.kind,
        helpful,
      });
    },
    [send]
  );

  return { state, setPaused, dismiss, sendFeedback, cardStaleMs: CARD_STALE_MS };
}
