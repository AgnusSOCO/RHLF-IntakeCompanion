import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { formatDuration } from "../lib/utils";

export function CallBanner({
  active,
  callerNumber,
  startedAt,
}: {
  active: boolean;
  callerNumber?: string;
  startedAt?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;
  return (
    <div className="flex items-center gap-2.5 border-b border-red-500/20 bg-red-500/[0.06] px-4 py-2">
      <span className="live-pulse h-2 w-2 rounded-full bg-red-500" />
      <span className="text-[11px] font-bold tracking-[0.14em] text-red-400">
        LIVE
      </span>
      {callerNumber && (
        <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-zinc-200">
          <Phone className="h-3 w-3 text-zinc-500" />
          {callerNumber}
        </span>
      )}
      <span className="ml-auto text-xs tabular-nums text-zinc-500">
        {startedAt ? formatDuration(now - startedAt) : "0:00"}
      </span>
    </div>
  );
}
