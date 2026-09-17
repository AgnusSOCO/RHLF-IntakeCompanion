import { useState } from "react";
import { Check, ClipboardCopy, FileText, Flag } from "lucide-react";
import type { SummaryEvent } from "../lib/types";
import { Button } from "./ui/button";

const FIELD_LABELS: Record<string, string> = {
  caller_name: "Caller",
  contact: "Contact",
  incident_type: "Incident",
  incident_date: "Date",
  location: "Location",
  injuries: "Injuries",
  insurance: "Insurance",
  urgent_flags: "Urgent",
};

/** Post-call wrap card: AI summary + extracted fields, one-click copy for CRM. */
export function SummaryCard({ summary }: { summary: Omit<SummaryEvent, "type"> }) {
  const [copied, setCopied] = useState(false);
  const fields = Object.entries(summary.fields ?? {}).filter(([, v]) => v?.trim());

  const copyAll = () => {
    const lines = [
      summary.summary,
      "",
      ...fields.map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${v}`),
      ...(summary.keyMoments?.length
        ? ["", "Key moments:", ...summary.keyMoments.map((m) => `- ${m}`)]
        : []),
    ];
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article className="card-in rounded-lg border border-zinc-200 border-l-2 border-l-zinc-400 bg-white shadow-sm">
      <div className="flex items-start gap-2 px-3.5 pt-3">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-zinc-900">Call summary — ready for notes</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-700">{summary.summary}</p>
        </div>
      </div>

      <div className="px-3.5 pb-3 pt-2">
        {fields.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-500">
                  {FIELD_LABELS[k] ?? k}
                </dt>
                <dd className="truncate text-[11.5px] text-zinc-800" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {summary.keyMoments?.length > 0 && (
          <ul className="mt-2 space-y-1">
            {summary.keyMoments.map((m, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-zinc-600">
                <Flag className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                {m}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex justify-end">
          <Button variant="outline" size="sm" onClick={copyAll}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy for case notes"}
          </Button>
        </div>
      </div>
    </article>
  );
}
