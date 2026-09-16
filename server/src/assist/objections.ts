import fs from "node:fs";
import { config } from "../config";

/**
 * Firm-approved objection playbook. PoC detection is deterministic keyword
 * matching; swap `detect` for an LLM/classifier call later without changing
 * the surrounding pipeline.
 */

export interface Objection {
  id: string;
  title: string;
  /** Any matching phrase (case-insensitive) triggers the objection. */
  patterns: string[];
  responses: { en: string; es: string };
  followUp: { en: string; es: string };
  escalate?: boolean;
}

export interface Suggestion {
  objectionId: string;
  title: string;
  language: "en" | "es";
  response: string;
  followUp: string;
  escalate: boolean;
  matchedText: string;
}

const COOLDOWN_MS = 45_000;

export class ObjectionEngine {
  private objections: Objection[] = [];
  private lastFired = new Map<string, number>();

  load(): void {
    const raw = fs.readFileSync(config.playbookPath, "utf8");
    this.objections = JSON.parse(raw).objections as Objection[];
    console.log(`[assist] loaded ${this.objections.length} objections from ${config.playbookPath}`);
  }

  /** Returns a suggestion for newly detected objections in caller text. */
  detect(text: string, language?: string): Suggestion | undefined {
    const lower = text.toLowerCase();
    const now = Date.now();
    const lang: "en" | "es" = language === "es" ? "es" : "en";

    for (const o of this.objections) {
      if (now - (this.lastFired.get(o.id) ?? 0) < COOLDOWN_MS) continue;
      if (!o.patterns.some((p) => lower.includes(p.toLowerCase()))) continue;

      this.lastFired.set(o.id, now);
      return {
        objectionId: o.id,
        title: o.title,
        language: lang,
        response: o.responses[lang],
        followUp: o.followUp[lang],
        escalate: Boolean(o.escalate),
        matchedText: text,
      };
    }
    return undefined;
  }
}
