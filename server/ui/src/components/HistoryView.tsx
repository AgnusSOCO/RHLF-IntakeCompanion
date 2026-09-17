import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Flag,
  Inbox,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  ThumbsUp,
} from "lucide-react";
import { cn, formatDuration } from "../lib/utils";
import type { HistoryCall } from "../lib/types";

type Range = "today" | "7d" | "30d" | "all";

const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];

function rangeFrom(r: Range): number | undefined {
  const d = new Date();
  if (r === "today") {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (r === "7d") return Date.now() - 7 * 86400e3;
  if (r === "30d") return Date.now() - 30 * 86400e3;
  return undefined;
}

/** Group calls under Today / Yesterday / <date> headers. */
function groupByDay(calls: HistoryCall[]): [string, HistoryCall[]][] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400e3);
  const groups = new Map<string, HistoryCall[]>();
  for (const c of calls) {
    const d = new Date(c.startedAt);
    const key =
      d >= today ? "Today"
      : d >= yesterday ? "Yesterday"
      : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return [...groups.entries()];
}

function CallRow({ call }: { call: HistoryCall }) {
  const [open, setOpen] = useState(false);
  const s = call.summary;
  const coveragePct =
    call.coverageTotal ? Math.round(((call.coverage ?? 0) / call.coverageTotal) * 100) : null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
      >
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-zinc-100">
          <Phone className="h-3.5 w-3.5 text-zinc-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-medium text-zinc-800">
              {call.callerNumber ?? "Unknown caller"}
            </span>
            <span className="text-[10.5px] tabular-nums text-zinc-400">
              {new Date(call.startedAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          {s && (
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{s.summary}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-500">
          {coveragePct !== null && (
            <span
              className="flex items-center gap-1"
              title={`Intake fields covered: ${call.coverage}/${call.coverageTotal}`}
            >
              <ClipboardCheck className="h-3 w-3 text-zinc-400" />
              {coveragePct}%
            </span>
          )}
          {call.suggestions > 0 && (
            <span title={`${call.suggestions} suggestions served`}>
              {call.suggestions} sugg
            </span>
          )}
          {call.feedback.helpful > 0 && (
            <span className="flex items-center gap-0.5 text-emerald-600">
              <ThumbsUp className="h-3 w-3" />
              {call.feedback.helpful}
            </span>
          )}
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="h-3 w-3 text-zinc-400" />
            {formatDuration(call.durationMs)}
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-zinc-400 transition-transform", open && "rotate-180")}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-zinc-100 px-3.5 py-3">
          {s?.fields && Object.values(s.fields).some((v) => v?.trim()) && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              {Object.entries(s.fields)
                .filter(([, v]) => v?.trim())
                .map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[9.5px] font-semibold uppercase tracking-wider text-zinc-500">
                      {k.replace(/_/g, " ")}
                    </dt>
                    <dd className="truncate text-[11.5px] text-zinc-800" title={v}>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
          {s?.keyMoments && s.keyMoments.length > 0 && (
            <ul className="space-y-1">
              {s.keyMoments.map((m, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-zinc-600">
                  <Flag className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  {m}
                </li>
              ))}
            </ul>
          )}
          {s?.coaching && (
            <p className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] italic text-sky-800">
              Coaching: {s.coaching}
            </p>
          )}
          {call.transcript && call.transcript.length > 0 && (
            <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-zinc-100 bg-zinc-50/60 p-2.5 scroll-slim">
              {call.transcript.map((seg, i) => (
                <div
                  key={i}
                  className={cn("flex", seg.speaker === "agent" ? "justify-end" : "justify-start")}
                >
                  <span
                    className={cn(
                      "max-w-[85%] rounded-lg px-2.5 py-1 text-[11px] leading-snug",
                      seg.speaker === "agent"
                        ? "bg-emerald-600 text-white"
                        : "bg-white text-zinc-800 border border-zinc-200"
                    )}
                  >
                    {seg.text}
                  </span>
                </div>
              ))}
            </div>
          )}
          {!s && <p className="text-[11px] text-zinc-400">No summary recorded for this call.</p>}
        </div>
      )}
    </div>
  );
}

/** Agent's own call history — persistent, grouped by day, filterable. */
export function HistoryView({
  extensionId,
  token,
  callActive,
}: {
  extensionId: string;
  token: string;
  /** Refetches when a live call ends so the new record shows up. */
  callActive: boolean;
}) {
  const [calls, setCalls] = useState<HistoryCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("7d");
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState("");
  const wasActive = useRef(callActive);
  const debounce = useRef<number>();

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ extensionId, token });
    const from = rangeFrom(range);
    if (from) p.set("from", String(from));
    if (q) p.set("q", q);
    fetch(`/api/history?${p}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setCalls(d.calls ?? []))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [extensionId, token, range, q]);

  useEffect(load, [load]);
  // Refetch when a call ends so its record appears.
  useEffect(() => {
    if (wasActive.current && !callActive) {
      const t = window.setTimeout(load, 4000); // summary lands a few s after callEnd
      wasActive.current = callActive;
      return () => clearTimeout(t);
    }
    wasActive.current = callActive;
  }, [callActive, load]);
  // Debounced search.
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => setQ(qLive.trim()), 300);
    return () => clearTimeout(debounce.current);
  }, [qLive]);

  const groups = useMemo(() => groupByDay(calls), [calls]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex gap-1 rounded-md bg-zinc-100 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition-colors",
                range === r.id
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={qLive}
            onChange={(e) => setQLive(e.target.value)}
            placeholder="Search calls, names, notes…"
            className="h-7.5 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
        </div>
        <button
          onClick={load}
          className="grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {loading && calls.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="h-6 w-6 text-zinc-300" />
            <p className="text-xs text-zinc-500">
              {q ? "No calls match your search." : "No calls in this range yet."}
            </p>
          </div>
        ) : (
          groups.map(([day, dayCalls]) => (
            <div key={day}>
              <div className="flex items-center gap-2 pb-1.5 pt-3">
                <CalendarDays className="h-3 w-3 text-zinc-400" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  {day}
                </span>
                <span className="text-[10px] text-zinc-400">{dayCalls.length}</span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>
              <div className="flex flex-col gap-1.5">
                {dayCalls.map((c) => (
                  <CallRow key={c.sessionId} call={c} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
