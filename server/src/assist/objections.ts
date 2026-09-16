import fs from "node:fs";
import { config } from "../config";

/**
 * Firm-approved assist playbook. Two entry types:
 *   - objections: caller hesitation -> approved response + follow-up
 *   - faqs:       caller questions   -> approved answer
 *
 * PoC detection is deterministic keyword matching; swap `detect` for an
 * LLM/classifier call later without changing the surrounding pipeline.
 * Caller questions with no approved answer still produce a suggestion of
 * kind "question" (no scripted response) so the agent knows to escalate
 * rather than improvise.
 */

export interface PlaybookEntry {
  id: string;
  title: string;
  /** Any matching phrase (case-insensitive) triggers the entry. */
  patterns: string[];
  responses?: { en: string; es: string };
  answers?: { en: string; es: string };
  followUp?: { en: string; es: string };
  escalate?: boolean;
}

export type SuggestionKind = "objection" | "faq" | "question" | "ai";

export interface Suggestion {
  kind: SuggestionKind;
  objectionId: string;
  title: string;
  language: "en" | "es";
  /** Empty when there is no approved answer on file. */
  response: string;
  followUp: string;
  escalate: boolean;
  matchedText: string;
}

const COOLDOWN_MS = 45_000;
const UNMATCHED_QUESTION_COOLDOWN_MS = 20_000;

// Rough interrogative detector for EN/ES caller speech.
const QUESTION_RE =
  /(^(what|how|when|where|why|who|which|can|could|will|would|do|does|did|is|are|should|am)\b|\?\s*$|\b(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|por qu[eé]|puedo|pueden|puede|necesito|debo)\b)/i;

export class ObjectionEngine {
  private objections: PlaybookEntry[] = [];
  private faqs: PlaybookEntry[] = [];
  private lastFired = new Map<string, number>();
  private lastUnmatchedQuestion = 0;

  load(): void {
    const raw = fs.readFileSync(config.playbookPath, "utf8");
    const parsed = JSON.parse(raw);
    this.objections = (parsed.objections ?? []) as PlaybookEntry[];
    this.faqs = (parsed.faqs ?? []) as PlaybookEntry[];
    console.log(
      `[assist] loaded ${this.objections.length} objections + ${this.faqs.length} faqs from ${config.playbookPath}`
    );
  }

  /** Returns a suggestion for newly detected objections/questions in caller text. */
  detect(text: string, language?: string): Suggestion | undefined {
    const lower = text.toLowerCase();
    const now = Date.now();
    const lang: "en" | "es" = language === "es" ? "es" : "en";

    const matched = this.match(this.objections, lower, now) ?? this.match(this.faqs, lower, now);
    if (matched) {
      const isFaq = this.faqs.includes(matched);
      const body = matched.answers ?? matched.responses;
      return {
        kind: isFaq ? "faq" : "objection",
        objectionId: matched.id,
        title: matched.title,
        language: lang,
        response: body?.[lang] ?? "",
        followUp: matched.followUp?.[lang] ?? "",
        escalate: Boolean(matched.escalate),
        matchedText: text,
      };
    }

    return undefined;
  }

  /**
   * Fallback when nothing matched and no LLM is configured: flag apparent
   * caller questions so the agent knows to escalate rather than improvise.
   */
  flagQuestion(text: string, language?: string): Suggestion | undefined {
    const now = Date.now();
    if (!QUESTION_RE.test(text) || now - this.lastUnmatchedQuestion <= UNMATCHED_QUESTION_COOLDOWN_MS)
      return undefined;
    this.lastUnmatchedQuestion = now;
    return {
      kind: "question",
      objectionId: "unmatched-question",
      title: "Caller question — no approved answer on file",
      language: language === "es" ? "es" : "en",
      response: "",
      followUp: "",
      escalate: true,
      matchedText: text,
    };
  }

  private match(entries: PlaybookEntry[], lower: string, now: number): PlaybookEntry | undefined {
    for (const o of entries) {
      if (now - (this.lastFired.get(o.id) ?? 0) < COOLDOWN_MS) continue;
      if (!o.patterns.some((p) => lower.includes(p.toLowerCase()))) continue;
      this.lastFired.set(o.id, now);
      return o;
    }
    return undefined;
  }
}
