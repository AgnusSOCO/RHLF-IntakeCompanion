import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History, Phone } from "lucide-react";
import { cn, formatDuration } from "../lib/utils";

function AudioBars({ active }: { active: boolean }) {
  return (
    <span className={cn("audio-bars text-red-600", active && "active")} aria-hidden>
      <span /><span /><span /><span /><span />
    </span>
  );
}

export function CallBanner({
  active,
  callerNumber,
  startedAt,
  priorCalls,
  speaking,
}: {
  active: boolean;
  callerNumber?: string;
  startedAt?: number;
  priorCalls?: {
    count: number;
    lastAt: number | null;
    lastSummary?: string;
    lastDisposition?: string;
  };
  speaking: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  const [showPrior, setShowPrior] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="relative border-b border-red-200 bg-gradient-to-r from-red-50 via-red-50/70 to-white px-4 py-2">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-red-600" />
      <div className="flex items-center gap-2.5 pl-1">
        <span className="live-pulse h-2 w-2 rounded-full bg-red-600" />
        <span className="text-[11px] font-bold tracking-[0.14em] text-red-600">LIVE</span>
        <AudioBars active={speaking} />
        {callerNumber && (
          <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-zinc-800">
            <Phone className="h-3 w-3 text-zinc-400" />
            {callerNumber}
          </span>
        )}
        {priorCalls && priorCalls.count > 0 && (
          <button
            onClick={() => setShowPrior((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 transition-colors hover:bg-violet-100"
            title={
              priorCalls.lastAt
                ? `Last call ${new Date(priorCalls.lastAt).toLocaleDateString()}`
                : undefined
            }
          >
            <History className="h-2.5 w-2.5" />
            Called {priorCalls.count}x before
            {priorCalls.lastSummary &&
              (showPrior ? (
                <ChevronUp className="h-2.5 w-2.5" />
              ) : (
                <ChevronDown className="h-2.5 w-2.5" />
              ))}
          </button>
        )}
        <span className="ml-auto text-[13px] font-semibold tabular-nums text-zinc-700">
          {startedAt ? formatDuration(now - startedAt) : "0:00"}
        </span>
      </div>
      {showPrior && priorCalls?.lastSummary && (
        <div className="fade-in mt-2 rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2 pl-3 text-[11.5px] leading-relaxed text-violet-900">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-500">
            Last call
            {priorCalls.lastAt &&
              ` · ${new Date(priorCalls.lastAt).toLocaleDateString([], { month: "short", day: "numeric" })}`}
            {priorCalls.lastDisposition && ` · ${priorCalls.lastDisposition.replace(/_/g, " ")}`}
          </div>
          {priorCalls.lastSummary}
        </div>
      )}
    </div>
  );
}
