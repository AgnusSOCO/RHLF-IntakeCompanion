import { useEffect, useState } from "react";
import { History, Phone } from "lucide-react";
import { formatDuration } from "../lib/utils";

export function CallBanner({
  active,
  callerNumber,
  startedAt,
  priorCalls,
}: {
  active: boolean;
  callerNumber?: string;
  startedAt?: number;
  priorCalls?: { count: number; lastAt: number | null };
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="flex items-center gap-2.5 border-b border-red-200 bg-red-50 px-4 py-2">
      <span className="live-pulse h-2 w-2 rounded-full bg-red-600" />
      <span className="text-[11px] font-bold tracking-[0.14em] text-red-600">
        LIVE
      </span>
      {callerNumber && (
        <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-zinc-800">
          <Phone className="h-3 w-3 text-zinc-400" />
          {callerNumber}
        </span>
      )}
      {priorCalls && priorCalls.count > 0 && (
        <span
          className="flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700"
          title={
            priorCalls.lastAt
              ? `Last call ${new Date(priorCalls.lastAt).toLocaleDateString()}`
              : undefined
          }
        >
          <History className="h-2.5 w-2.5" />
          Called {priorCalls.count}x before
        </span>
      )}
      <span className="ml-auto text-xs tabular-nums text-zinc-500">
        {startedAt ? formatDuration(now - startedAt) : "0:00"}
      </span>
    </div>
  );
}
