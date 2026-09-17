import { CircleAlert, Info } from "lucide-react";
import { cn } from "../lib/utils";
import type { CallFlag } from "../lib/types";

/**
 * Live key-moment flags detected during the call — alerts (red) need the
 * agent's attention now; info flags (amber) are useful context.
 */
export function FlagStrip({ flags }: { flags: CallFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-white px-4 py-1.5">
      {flags.map((f, i) => (
        <span
          key={`${f.label}-${i}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
            f.severity === "alert"
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-amber-300 bg-amber-50 text-amber-700"
          )}
        >
          {f.severity === "alert" ? (
            <CircleAlert className="h-3 w-3" />
          ) : (
            <Info className="h-3 w-3" />
          )}
          {f.label}
        </span>
      ))}
    </div>
  );
}
