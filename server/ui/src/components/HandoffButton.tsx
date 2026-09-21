import { useEffect, useRef, useState } from "react";
import { Check, Copy, PhoneForwarded, X } from "lucide-react";
import type { CallFlag, ChecklistItem, TranscriptSegment } from "../lib/types";

/**
 * Warm handoff brief: one click composes a transfer summary from the live
 * call state — lead fields, coverage gaps, flags, and the last exchanges —
 * so the agent can paste it into RC team chat or read it to the attorney.
 * Pure client-side: no round trip, instant.
 */
export function HandoffButton({
  callActive,
  callerNumber,
  fields,
  checklist,
  flags,
  segments,
}: {
  callActive: boolean;
  callerNumber?: string;
  fields: Record<string, string>;
  checklist: ChecklistItem[];
  flags: CallFlag[];
  segments: TranscriptSegment[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!callActive) return null;

  const brief = (): string => {
    const lines = [
      `RHLF INTAKE HANDOFF — ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      `Caller: ${fields.caller_name || callerNumber || "unknown"}${fields.contact ? ` — ${fields.contact}` : ""}`,
    ];
    if (fields.incident_type)
      lines.push(
        `Incident: ${fields.incident_type}${fields.incident_date ? ` (${fields.incident_date})` : ""}${fields.location ? ` — ${fields.location}` : ""}`
      );
    if (fields.injuries) lines.push(`Injuries: ${fields.injuries}`);
    if (fields.medical) lines.push(`Treatment: ${fields.medical}`);
    if (fields.insurance) lines.push(`Insurance: ${fields.insurance}`);
    const alerts = flags.filter((f) => f.severity === "alert").map((f) => f.label);
    if (alerts.length) lines.push(`Flags: ${alerts.join("; ")}`);
    const missing = checklist.filter((c) => !c.covered).map((c) => c.label);
    if (missing.length) lines.push(`Not yet collected: ${missing.join(", ")}`);
    const tail = segments
      .slice(-6)
      .map((s) => `${s.speaker === "agent" ? "Agent" : "Caller"}: ${s.text}`);
    if (tail.length) lines.push("", "Recent exchange:", ...tail);
    return lines.join("\n");
  };

  const copy = () => {
    navigator.clipboard?.writeText(brief()).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {}
    );
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Warm handoff brief — paste into team chat when transferring"
        className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10.5px] font-medium text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800"
      >
        <PhoneForwarded className="h-3 w-3" />
        Handoff
      </button>
      {open && (
        <div className="view-in absolute bottom-8 right-0 z-30 w-80 rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Transfer brief
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[10px] font-medium text-white hover:bg-zinc-700"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-400 hover:text-zinc-700"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <pre className="scroll-slim max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-sans text-[11px] leading-relaxed text-zinc-700">
            {brief()}
          </pre>
        </div>
      )}
    </div>
  );
}
