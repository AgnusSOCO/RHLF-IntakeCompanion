import { useEffect, useRef, useState } from "react";
import { ClipboardList, PencilLine } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Live caller card: the intake lead sheet fills itself as extraction runs.
 * Agents can correct any field — manual edits win over AI fills until the
 * AI reports a different value again.
 */
const FIELDS: { id: string; label: string }[] = [
  { id: "caller_name", label: "Caller" },
  { id: "contact", label: "Contact" },
  { id: "incident_type", label: "Incident" },
  { id: "incident_date", label: "When" },
  { id: "location", label: "Where" },
  { id: "injuries", label: "Injuries" },
  { id: "insurance", label: "Insurance" },
];

export function CallerCard({
  fields,
  callActive,
  callerNumber,
}: {
  fields: Record<string, string>;
  callActive: boolean;
  callerNumber?: string;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prev = useRef<Record<string, string>>({});

  // Flash a field green for a moment when the AI fills/changes it.
  useEffect(() => {
    const changed = Object.entries(fields)
      .filter(([k, v]) => v && prev.current[k] !== v)
      .map(([k]) => k);
    prev.current = fields;
    if (!changed.length) return;
    setFlash(new Set(changed));
    const t = setTimeout(() => setFlash(new Set()), 1600);
    return () => clearTimeout(t);
  }, [fields]);

  // A field shows the agent's manual edit if present, else the AI value.
  const value = (id: string) =>
    edits[id] ?? fields[id] ?? (id === "contact" ? callerNumber ?? "" : "");
  const hasAny = FIELDS.some((f) => value(f.id));
  if (!callActive && !hasAny) return null;

  return (
    <section className="border-b border-zinc-200 bg-white px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <ClipboardList className="h-3.5 w-3.5 text-zinc-400" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Lead sheet
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-400">
          <PencilLine className="h-3 w-3" />
          click a field to correct
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {FIELDS.map((f) => {
          const v = value(f.id);
          return (
            <label key={f.id} className="group flex min-w-0 items-baseline gap-1.5">
              <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                {f.label}
              </span>
              <input
                value={v}
                placeholder="—"
                onChange={(e) => setEdits((p) => ({ ...p, [f.id]: e.target.value }))}
                className={cn(
                  "min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-zinc-800 transition-colors placeholder:text-zinc-300 hover:border-zinc-200 focus:border-zinc-300 focus:bg-white focus:outline-none",
                  flash.has(f.id) && "field-flash"
                )}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}
