import fs from "node:fs";
import { config } from "../config";
import type { CallFlag } from "./ai";

/**
 * Dynamic intake script: a guided, ordered flow that evaluates itself against
 * the live extraction state. Sections appear/disappear on conditions (case
 * type, flags); steps complete when their linked intake field is covered or
 * their time-based auto-complete elapses. No extra LLM calls — derived from
 * the checklist pass that already runs every ~12s.
 */

export interface ScriptStepDef {
  id: string;
  label: string;
  text: string;
  /** Checklist field id that marks this step done. */
  field?: string;
  /** Auto-complete N seconds after call start (-1 = never auto-complete). */
  autoAfter?: number;
}

export interface ScriptSectionDef {
  id: string;
  title: string;
  when?: { field?: string; matches?: string; flag?: string };
  steps: ScriptStepDef[];
}

export interface ScriptStep {
  id: string;
  label: string;
  text: string;
  done: boolean;
}

export interface ScriptSection {
  id: string;
  title: string;
  steps: ScriptStep[];
}

export interface ScriptState {
  sections: ScriptSection[];
  /** First incomplete step across visible sections — the current beat. */
  currentStepId: string | null;
  completed: number;
  total: number;
}

interface EvalInput {
  covered: Record<string, string>;
  fields: Record<string, string>;
  flags: CallFlag[];
  elapsedMs: number;
  /** Steps the agent manually checked off in the UI. */
  doneIds?: ReadonlySet<string>;
}

export class ScriptEngine {
  private sections: ScriptSectionDef[] = [];

  load(path?: string): void {
    const p = path ?? config.scriptPath;
    try {
      const raw = fs.readFileSync(p, "utf8");
      this.sections = (JSON.parse(raw).sections ?? []) as ScriptSectionDef[];
      console.log(`[script] loaded ${this.sections.length} sections from ${p}`);
    } catch (e) {
      console.warn(`[script] no script at ${p} — dynamic script disabled`);
      this.sections = [];
    }
  }

  get enabled(): boolean {
    return this.sections.length > 0;
  }

  private sectionVisible(s: ScriptSectionDef, input: EvalInput): boolean {
    if (!s.when) return true;
    if (s.when.flag) {
      const re = new RegExp(s.when.flag, "i");
      if (input.flags.some((f) => re.test(f.label))) return true;
      if (!s.when.field) return false;
    }
    if (s.when.field) {
      const v = input.fields[s.when.field] ?? input.covered[s.when.field];
      if (!v) return false;
      if (s.when.matches) return new RegExp(s.when.matches, "i").test(v);
      return true;
    }
    return false;
  }

  evaluate(input: EvalInput): ScriptState {
    const sections: ScriptSection[] = [];
    for (const s of this.sections) {
      if (!this.sectionVisible(s, input)) continue;
      sections.push({
        id: s.id,
        title: s.title,
        steps: s.steps.map((st) => ({
          id: st.id,
          label: st.label,
          text: st.text,
          done:
            (st.field ? st.field in input.covered : false) ||
            (input.doneIds?.has(st.id) ?? false) ||
            (typeof st.autoAfter === "number" &&
              st.autoAfter >= 0 &&
              input.elapsedMs >= st.autoAfter * 1000),
        })),
      });
    }
    let currentStepId: string | null = null;
    let completed = 0;
    let total = 0;
    for (const s of sections) {
      for (const st of s.steps) {
        total++;
        if (st.done) completed++;
        else if (!currentStepId) currentStepId = st.id;
      }
    }
    return { sections, currentStepId, completed, total };
  }
}
