import { useEffect, useState } from "react";
import { Flame, Gauge, Hourglass } from "lucide-react";
import { cn } from "../lib/utils";
import type { CaseScore } from "../lib/types";

/**
 * Live case score: a 0–100 read on how strong this intake looks, ticking up
 * as the lead sheet fills. The SOL chip appears when the caller gave a real
 * incident date — NRS 11.190 two-year window.
 */
const TIER_META = {
  low: { label: "Low", bar: "bg-zinc-400", text: "text-zinc-500", chip: "border-zinc-300 bg-zinc-100 text-zinc-600" },
  warm: { label: "Warm", bar: "bg-amber-500", text: "text-amber-600", chip: "border-amber-300 bg-amber-50 text-amber-700" },
  hot: { label: "Hot", bar: "bg-emerald-500", text: "text-emerald-600", chip: "border-emerald-300 bg-emerald-50 text-emerald-700" },
} as const;

const SOL_META = {
  open: "border-emerald-300 bg-emerald-50 text-emerald-700",
  approaching: "border-amber-300 bg-amber-50 text-amber-700",
  critical: "border-red-300 bg-red-50 text-red-700",
  expired: "border-red-400 bg-red-100 text-red-800",
} as const;

export function ScoreBar({ score, callActive }: { score?: CaseScore; callActive: boolean }) {
  // Smooth the bar: display value eases toward the latest emitted score.
  const [shown, setShown] = useState(score?.value ?? 0);
  useEffect(() => {
    if (score == null) { setShown(0); return; }
    const target = score.value;
    if (Math.abs(target - shown) < 1) return;
    const t = setInterval(() => {
      setShown((v) => {
        const next = v + (target - v) * 0.25;
        return Math.abs(target - next) < 0.5 ? target : next;
      });
    }, 40);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score?.value]);

  if (!score || (!callActive && !score.drivers.length)) return null;
  const meta = TIER_META[score.tier] ?? TIER_META.low;
  const sol = score.sol;

  return (
    <section
      className="border-b border-zinc-200 bg-white px-4 py-2"
      title={score.drivers.length ? `Drivers: ${score.drivers.join(" · ")}` : undefined}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <Gauge className={cn("h-3.5 w-3.5", meta.text)} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Case score
          </span>
        </div>
        <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className={cn("h-full rounded-full transition-[width] duration-150", meta.bar)}
            style={{ width: `${Math.max(2, Math.min(100, shown))}%` }}
          />
        </div>
        <span className={cn("w-8 text-right text-[13px] font-bold tabular-nums", meta.text)}>
          {Math.round(shown)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            meta.chip
          )}
        >
          {score.tier === "hot" && <Flame className="h-3 w-3" />}
          {meta.label}
        </span>
        {sol && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              SOL_META[sol.status]
            )}
            title={`Statute window (${sol.deadline}) — NRS 11.190`}
          >
            <Hourglass className="h-3 w-3" />
            {sol.status === "expired"
              ? "SOL expired"
              : `SOL ${sol.daysLeft}d`}
          </span>
        )}
      </div>
    </section>
  );
}
