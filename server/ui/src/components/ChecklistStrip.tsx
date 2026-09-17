import { Check, CircleDashed, ClipboardList } from "lucide-react";
import { cn } from "../lib/utils";
import type { ChecklistItem } from "../lib/types";

/**
 * Intake-progress chips: which standard fields the call has covered so far.
 * Updates in the background — the agent glances and knows what to still collect.
 */
export function ChecklistStrip({ items, callActive }: { items: ChecklistItem[]; callActive: boolean }) {
  if (items.length === 0) return null;
  const covered = items.filter((i) => i.covered).length;
  return (
    <div className="border-b border-zinc-200 bg-white px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        <ClipboardList className="h-3 w-3" />
        Intake progress
        <span className="ml-auto font-normal normal-case tracking-normal tabular-nums text-zinc-400">
          {covered}/{items.length}
        </span>
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
              !callActive && "opacity-60"
            )}
          >
            {item.covered ? <Check className="h-2.5 w-2.5" /> : <CircleDashed className="h-2.5 w-2.5" />}
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
