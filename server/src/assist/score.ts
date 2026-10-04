import type { CallFlag } from "./ai";
import type { ChecklistItem, ChecklistItemId } from "./checklist";

/**
 * Live case score: a deterministic 0–100 read on how strong this intake looks
 * right now, recomputed on every extraction pass and pushed to the UI +
 * dashboard. No extra LLM calls — pure signal math over the checklist,
 * lead-sheet fields, and live flags.
 *
 * Also carries the statute-of-limitations countdown when the caller gave a
 * real incident date (incident_date_iso from the extraction prompt).
 */

export interface SolClock {
  deadline: string; // ISO date
  daysLeft: number;
  status: "open" | "approaching" | "critical" | "expired";
}

export interface CaseScore {
  value: number;
  tier: "low" | "warm" | "hot";
  /** ≤4 short labels explaining what moved the score. */
  drivers: string[];
  sol?: SolClock;
}

const SOL_YEARS = 2; // NRS 11.190 — general Nevada personal-injury window

function parseIsoDate(text?: string): Date | null {
  if (!text) return null;
  const m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[0]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};
const NUMWORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Recover an incident date from free-text extraction when the ISO field came
 * back empty — callers say "December 12th of last year", "about 2 months ago",
 * "last week" far more often than they give a calendar date. Returns ISO.
 */
export function inferIncidentDate(raw?: string, now = new Date()): string | undefined {
  if (!raw) return undefined;
  const text = raw.toLowerCase();
  const day = 86_400_000;
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  let m = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]).toISOString().slice(0, 10);
  m = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return utc(y, +m[1] - 1, +m[2]).toISOString().slice(0, 10);
  }

  // Relative: "N days/weeks/months/years ago", "a year ago", "yesterday".
  m = text.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(day|week|month|year)s?\s+ago/);
  if (m) {
    const n = NUMWORDS[m[1]] ?? parseInt(m[1], 10);
    if (n > 0) {
      const per = m[2] === "day" ? n : m[2] === "week" ? n * 7 : m[2] === "month" ? n * 30 : n * 365;
      return new Date(now.getTime() - per * day).toISOString().slice(0, 10);
    }
  }
  if (/yesterday/.test(text)) return new Date(now.getTime() - day).toISOString().slice(0, 10);
  if (/last week/.test(text)) return new Date(now.getTime() - 7 * day).toISOString().slice(0, 10);
  m = text.match(/last\s+(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)/);
  if (m) {
    // "last December" → that month in the most recent past year it occurred.
    const mo = MONTHS[m[1].slice(0, 3) === "sep" ? "sep" : m[1]];
    if (mo !== undefined) {
      let y = now.getUTCFullYear();
      if (mo >= now.getUTCMonth()) y -= 1;
      return utc(y, mo, 15).toISOString().slice(0, 10);
    }
  }

  // Month name + day, optional year/relative-year tail.
  m = text.match(
    /(jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\w*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:,|of)?\s*(\d{4}))?/,
  );
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3) === "sep" ? "sep" : m[1]];
    if (mo !== undefined) {
      const dayN = Math.min(28, +m[2] > 28 ? 28 : +m[2]);
      let y: number;
      if (m[3]) y = +m[3];
      else if (/last year|prior year|previous year|year ago/.test(text)) y = now.getUTCFullYear() - 1;
      else {
        // Most recent occurrence: same day-of-year this year, else last year.
        y = now.getUTCFullYear();
        if (utc(y, mo, dayN).getTime() > now.getTime()) y -= 1;
      }
      return utc(y, mo, dayN).toISOString().slice(0, 10);
    }
  }
  return undefined;
}

/** Dedupe key for live flags — the model rewords the same risk each pass. */
export function flagKey(label: string): string {
  const t = label.toLowerCase();
  if (/statute|limitation|deadline|sol\b|expir/.test(t)) return "statute";
  if (/recorded statement/.test(t)) return "recorded-statement";
  if (/fear|afraid|scared|anxiet|avoid|hesitat|delay/.test(t)) return "fear";
  if (/attorney|lawyer|represent|another firm/.test(t)) return "attorney";
  if (/insur/.test(t)) return "insurance";
  if (/minor|child/.test(t)) return "minor";
  if (/injur|pain|hurt/.test(t)) return "injury";
  return t.slice(0, 36);
}

export function solClock(incidentDateIso?: string, fallbackText?: string): SolClock | undefined {
  const incident = parseIsoDate(incidentDateIso) ?? (() => {
    const iso = inferIncidentDate(fallbackText ?? incidentDateIso);
    return iso ? parseIsoDate(iso) : null;
  })();
  if (!incident) return undefined;
  const deadline = new Date(incident);
  deadline.setUTCFullYear(deadline.getUTCFullYear() + SOL_YEARS);
  const daysLeft = Math.floor((deadline.getTime() - Date.now()) / 86_400_000);
  return {
    deadline: deadline.toISOString().slice(0, 10),
    daysLeft,
    status:
      daysLeft < 0
        ? "expired"
        : daysLeft <= 90
          ? "critical"
          : daysLeft <= 365
            ? "approaching"
            : "open",
  };
}

export function computeCaseScore(args: {
  checklist: ChecklistItem[];
  fields: Record<string, string>;
  flags: CallFlag[];
}): CaseScore {
  const { checklist, fields, flags } = args;
  const covered = new Set(checklist.filter((i) => i.covered).map((i) => i.id));
  const has = (id: ChecklistItemId) => covered.has(id);

  let score = 0;
  const drivers: { pts: number; label: string }[] = [];
  const add = (pts: number, label: string) => {
    score += pts;
    drivers.push({ pts, label });
  };

  // Completeness backbone: how much of the standard intake is done.
  const total = checklist.length || 1;
  add(Math.round((covered.size / total) * 30), `${covered.size}/${total} intake fields`);

  // Case-value signals.
  if (has("injuries")) add(15, "Injuries documented");
  if (has("medical")) add(10, "Medical care confirmed");
  if (has("insurance")) add(10, "Insurance identified");
  if (has("police_report")) add(10, "Report on file");
  if (has("incident_type") && has("how_it_happened")) add(10, "Fault story clear");

  // Representation: "has another attorney" hurts conversion; unrepresented helps.
  if (has("representation")) {
    const rep = (
      checklist.find((i) => i.id === "representation")?.detail ?? ""
    ).toLowerCase();
    if (
      /already|has (an |another )?attorney|represented|retained|signed/.test(rep) ||
      flags.some((f) => /represented|another (firm|attorney)/i.test(f.label))
    ) {
      add(-10, "Already represented");
    } else {
      add(5, "Unrepresented");
    }
  }

  // Statute pressure: a ticking clock is a real reason to move now.
  const sol = solClock(fields.incident_date_iso, fields.incident_date);
  if (sol) {
    if (sol.status === "expired") add(-15, "SOL likely expired");
    else if (sol.status === "critical") add(5, `SOL in ${sol.daysLeft}d — urgent`);
  }

  // Live risk flags pull the score down.
  const alerts = flags.filter((f) => f.severity === "alert").length;
  if (alerts) add(-Math.min(24, alerts * 8), `${alerts} alert flag${alerts > 1 ? "s" : ""}`);

  const value = Math.max(0, Math.min(100, score));
  const tier = value >= 70 ? "hot" : value >= 40 ? "warm" : "low";
  const topDrivers = drivers
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 4)
    .map((d) => d.label);
  return { value, tier, drivers: topDrivers, sol };
}
