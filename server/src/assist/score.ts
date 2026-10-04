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

export function solClock(incidentDateIso?: string): SolClock | undefined {
  const incident = parseIsoDate(incidentDateIso);
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
  const sol = solClock(fields.incident_date_iso);
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
