import { useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CircleSlash,
  Scale,
  ShieldCheck,
  XOctagon,
} from "lucide-react";
import { cn } from "../lib/utils";

const OPTIONS = [
  { id: "signed", label: "Signed up", Icon: BadgeCheck, tone: "emerald" },
  { id: "callback", label: "Call back", Icon: CalendarClock, tone: "sky" },
  { id: "attorney_review", label: "Attorney review", Icon: Scale, tone: "violet" },
  { id: "not_qualified", label: "Not qualified", Icon: CircleSlash, tone: "zinc" },
  { id: "spam", label: "Spam", Icon: XOctagon, tone: "red" },
] as const;

const TONES: Record<string, string> = {
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  sky: "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100",
  violet: "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100",
  zinc: "border-zinc-300 bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
  red: "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
};

/**
 * Post-call outcome picker — one click tags the call for the funnel/QA views.
 * This is what turns call records into conversion data.
 */
export function DispositionBar({
  sessionId,
  extensionId,
  token,
}: {
  sessionId: string;
  extensionId: string;
  token: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const pick = (id: string) => {
    setPicked(id);
    const p = new URLSearchParams({ extensionId, token });
    fetch(`/api/disposition?${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, disposition: id }),
    })
      .then((r) => r.ok && setSent(true))
      .catch(() => {});
  };

  if (sent) {
    return (
      <div className="fade-in flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[11.5px] font-medium text-emerald-700">
        <ShieldCheck className="h-3.5 w-3.5" />
        Outcome recorded — {OPTIONS.find((o) => o.id === picked)?.label}
      </div>
    );
  }

  return (
    <div className="fade-in rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        How did the call end?
      </div>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map(({ id, label, Icon, tone }) => (
          <button
            key={id}
            onClick={() => pick(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              TONES[tone],
              picked === id && "ring-1 ring-offset-1 ring-zinc-400"
            )}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
