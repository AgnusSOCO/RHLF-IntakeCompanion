import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, ListChecks, Quote } from "lucide-react";
import { cn } from "../lib/utils";
import type { ScriptState } from "../lib/types";

/**
 * Dynamic intake script: a guided, ordered flow. The current beat is always
 * visible with verbatim language; expand for the full stepper. Steps check
 * off automatically as extraction covers their fields; conditional sections
 * (vehicle details, already-represented wrap) appear when they become relevant.
 */
export function ScriptPanel({
  script,
  callActive,
  onMarkDone,
}: {
  script?: ScriptState;
  callActive: boolean;
  onMarkDone?: (stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [justDone, setJustDone] = useState<string | null>(null);
  const prevDone = useRef<Set<string>>(new Set());

  // Pop-animate a step the moment it completes.
  useEffect(() => {
    if (!script) return;
    const nowDone = new Set(
      script.sections.flatMap((s) => s.steps.filter((st) => st.done).map((st) => st.id))
    );
    for (const id of nowDone) {
      if (!prevDone.current.has(id)) {
        setJustDone(id);
        setTimeout(() => setJustDone((c) => (c === id ? null : c)), 700);
        break;
      }
    }
    prevDone.current = nowDone;
  }, [script]);

  if (!script || !script.sections.length || (!callActive && !script.total)) return null;

  const current = script.sections
    .flatMap((s) => s.steps.map((st) => ({ ...st, section: s.title })))
    .find((st) => st.id === script.currentStepId);

  const pct = script.total ? Math.round((script.completed / script.total) * 100) : 0;

  return (
    <section className="border-b border-zinc-200 bg-white">
      {/* header row: progress + expand */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 pt-2.5 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Script
        </span>
        <span className="text-[10px] tabular-nums text-zinc-400">
          {script.completed}/{script.total}
        </span>
        <div className="mx-1 h-1 flex-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-800 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        )}
      </button>

      {/* current beat — always visible while the call is live */}
      {callActive && current && (
        <div className="px-4 pb-2.5 pt-2">
          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2.5 shadow-sm">
            <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-widest text-zinc-400">
              <Quote className="h-3 w-3" />
              Now — {current.section} · {current.label}
            </div>
            <p className="text-[13px] leading-relaxed text-zinc-50">{current.text}</p>
          </div>
        </div>
      )}
      {callActive && !current && script.total > 0 && (
        <p className="px-4 pb-2.5 pt-1 text-[11px] text-emerald-600">
          All script steps covered — wrap when ready.
        </p>
      )}

      {/* expanded stepper */}
      {expanded && (
        <div className="view-in max-h-56 overflow-y-auto px-4 pb-3">
          {script.sections.map((s) => (
            <div key={s.id} className="mt-1.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-400">
                {s.title}
              </div>
              {s.steps.map((st) => {
                const isCurrent = st.id === script.currentStepId;
                return (
                  <div
                    key={st.id}
                    className={cn(
                      "group mt-1 flex items-start gap-2 rounded px-1.5 py-1",
                      isCurrent && "bg-zinc-100"
                    )}
                  >
                    <button
                      onClick={() => !st.done && onMarkDone?.(st.id)}
                      disabled={st.done || !onMarkDone}
                      title={st.done ? "Covered" : "Mark done"}
                      className={cn(
                        "mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-colors",
                        st.done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : isCurrent
                            ? "border-zinc-800 hover:bg-zinc-800 hover:text-white"
                            : "border-zinc-300 text-transparent hover:border-emerald-500 hover:bg-emerald-500 hover:text-white",
                        justDone === st.id && "chip-pop"
                      )}
                    >
                      {(st.done || onMarkDone) && <Check className="h-2.5 w-2.5" />}
                    </button>
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-[11.5px] leading-snug",
                          st.done ? "text-zinc-400 line-through" : isCurrent ? "font-semibold text-zinc-900" : "text-zinc-600"
                        )}
                      >
                        {st.label}
                      </div>
                      {(isCurrent || expanded) && !st.done && (
                        <p className="text-[10.5px] italic leading-snug text-zinc-400">{st.text}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
