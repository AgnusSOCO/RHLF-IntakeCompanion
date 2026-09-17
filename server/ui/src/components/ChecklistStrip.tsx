import { useEffect, useRef, useState } from "react";
import { Check, CircleDashed, ClipboardList, MessageCircleQuestion } from "lucide-react";
import { cn } from "../lib/utils";
import type { ChecklistItem } from "../lib/types";

/** Deterministic next-question prompts keyed by uncovered checklist field. */
const ASK_NEXT: Record<string, string> = {
  caller_identity: "May I get your full name and the best number to reach you?",
  incident_type: "Can you tell me what happened — what kind of incident was it?",
  incident_date: "When did this happen?",
  location: "Where did it happen — do you remember the street or area?",
  how_it_happened: "Can you walk me through how it happened?",
  injuries: "Were you injured? What hurts?",
  medical: "Have you seen a doctor or gotten any medical treatment yet?",
  police_report: "Did the police come — was a report filed?",
  insurance: "Do you have the other party's insurance information?",
  representation: "Are you currently working with another attorney?",
  employment: "Who is your employer?",
};

/**
 * Intake-progress chips: which standard fields the call has covered so far.
 * Updates in the background — the agent glances and knows what to still collect.
 */
export function ChecklistStrip({ items, callActive }: { items: ChecklistItem[]; callActive: boolean }) {
  const prevCovered = useRef<Set<string>>(new Set());
  const [justCovered, setJustCovered] = useState<Set<string>>(new Set());

  // Track which fields flipped to covered so they can pop.
  useEffect(() => {
    const now = new Set(items.filter((i) => i.covered).map((i) => i.id));
    const fresh = new Set([...now].filter((id) => !prevCovered.current.has(id)));
    prevCovered.current = now;
    if (fresh.size) {
      setJustCovered(fresh);
      const t = window.setTimeout(() => setJustCovered(new Set()), 600);
      return () => clearTimeout(t);
    }
  }, [items]);

  if (items.length === 0) return null;
  const covered = items.filter((i) => i.covered).length;
  const nextGap = items.find((i) => !i.covered && i.id !== "employment");
  const pct = Math.round((covered / items.length) * 100);
  return (
    <div className="border-b border-zinc-200 bg-white px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        <ClipboardList className="h-3 w-3" />
        Intake progress
        <span className="ml-auto font-normal normal-case tracking-normal tabular-nums text-zinc-400">
          {covered}/{items.length}
        </span>
      </div>
      <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item.id}
            title={item.covered ? item.detail || item.label : `${item.label} — not yet collected`}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
              item.covered
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-dashed border-zinc-300 text-zinc-400",
              justCovered.has(item.id) && "chip-pop",
              !callActive && "opacity-60"
            )}
          >
            {item.covered ? <Check className="h-2.5 w-2.5" /> : <CircleDashed className="h-2.5 w-2.5" />}
            {item.label}
          </span>
        ))}
      </div>
      {callActive && nextGap && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[10.5px] text-zinc-500">
          <MessageCircleQuestion className="mt-px h-3 w-3 shrink-0 text-zinc-400" />
          <span>
            <span className="font-medium text-zinc-600">Ask next:</span>{" "}
            {ASK_NEXT[nextGap.id] ?? `Collect ${nextGap.label.toLowerCase()}`}
          </span>
        </div>
      )}
    </div>
  );
}
