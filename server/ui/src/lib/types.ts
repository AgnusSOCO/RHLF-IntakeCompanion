// Wire protocol shared with server/src/hub.ts — keep in sync.

export type Speaker = "caller" | "agent";
export type SuggestionKind = "objection" | "faq" | "question" | "ai";

export interface TranscriptEvent {
  type: "transcript";
  speaker: Speaker;
  text: string;
  isFinal: boolean;
  speechFinal?: boolean;
  start?: number;
  duration?: number;
  language?: string;
  confidence?: number;
}

export interface SuggestionEvent {
  type: "suggestion";
  kind: SuggestionKind;
  objectionId: string;
  title: string;
  language?: string;
  response?: string;
  followUp?: string;
  escalate?: boolean;
  matchedText?: string;
}

export interface CallStartEvent {
  type: "callStart";
  extensionId: string;
  telephonySessionId: string;
  agentPartyId?: string;
  callerNumber?: string;
  priorCalls?: { count: number; lastAt: number | null };
}

export interface CallFlag {
  label: string;
  severity: "alert" | "info";
}

export interface HistoryCall {
  sessionId: string;
  extensionId: string;
  callerNumber?: string;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  transcriptSegments: number;
  suggestions: number;
  feedback: { helpful: number; unhelpful: number };
  summary?: {
    summary: string;
    fields: Record<string, string>;
    keyMoments: string[];
    coaching?: string;
  };
  transcript?: { speaker: string; text: string }[];
  coverage?: number;
  coverageTotal?: number;
  flags?: CallFlag[];
  disposition?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  covered: boolean;
  detail?: string;
}

export interface SummaryEvent {
  type: "summary";
  sessionId: string;
  summary: string;
  fields: Record<string, string>;
  keyMoments: string[];
  coaching?: string;
}

export type ServerEvent =
  | { type: "hello"; extensionId: string; activeSession: string | null }
  | { type: "agentInfo"; name: string | null }
  | { type: "flags"; flags: CallFlag[] }
  | CallStartEvent
  | { type: "callEnd"; extensionId: string; telephonySessionId: string }
  | { type: "state"; capturing?: boolean; mode?: string; paused?: boolean }
  | TranscriptEvent
  | SuggestionEvent
  | { type: "checklist"; items: ChecklistItem[] }
  | SummaryEvent
  | { type: "assist-thinking" }
  | { type: "paused"; paused: boolean }
  | { type: "stt-error"; message: string };

export interface TranscriptSegment {
  id: number;
  speaker: Speaker;
  text: string;
  language?: string;
  ts: number;
}

export interface GuidanceItem {
  key: string;
  kind: SuggestionKind;
  title: string;
  response?: string;
  followUp?: string;
  escalate?: boolean;
  matchedText?: string;
  language?: string;
  objectionId: string;
  receivedAt: number;
  feedback?: "helpful" | "unhelpful";
}
