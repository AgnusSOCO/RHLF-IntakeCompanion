import { useEffect, useRef, useState } from "react";
import { ArrowDown, PhoneOff } from "lucide-react";
import { cn, formatClock } from "../lib/utils";
import type { Speaker, TranscriptSegment } from "../lib/types";

interface Interim {
  text: string;
  language?: string;
}

function Bubble({
  speaker,
  text,
  language,
  ts,
  interim,
}: {
  speaker: Speaker;
  text: string;
  language?: string;
  ts?: number;
  interim?: boolean;
}) {
  const isCaller = speaker === "caller";
  return (
    <div className={cn("flex gap-2", !isCaller && "flex-row-reverse")}>
      <div
        className={cn(
          "mt-4 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-bold",
          isCaller ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
        )}
      >
        {isCaller ? "C" : "A"}
      </div>
      <div className={cn("min-w-0 max-w-[80%]", !isCaller && "flex flex-col items-end")}>
        <div
          className={cn(
            "mb-0.5 flex items-center gap-1.5 text-[10px] text-zinc-400",
            !isCaller && "flex-row-reverse"
          )}
        >
          <span className="font-medium text-zinc-500">{isCaller ? "Caller" : "You"}</span>
          {language === "es" && (
            <span className="rounded border border-zinc-300 px-1 text-[9px] font-semibold text-zinc-500">
              ES
            </span>
          )}
          {ts && <span className="tabular-nums">{formatClock(ts)}</span>}
        </div>
        <div
          className={cn(
            "rounded-xl px-3 py-2 text-[13px] leading-relaxed",
            isCaller
              ? "rounded-tl-sm bg-zinc-100 text-zinc-900"
              : "rounded-tr-sm bg-emerald-600 text-white",
            interim &&
              "border border-dashed border-zinc-300 bg-white italic text-zinc-500"
          )}
        >
          {text}
          {interim && <span className="caret-blink ml-0.5 text-zinc-400">▍</span>}
        </div>
      </div>
    </div>
  );
}

export function Transcript({
  segments,
  interim,
  callActive,
}: {
  segments: TranscriptSegment[];
  interim: Partial<Record<Speaker, Interim>>;
  callActive: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [segments, interim, pinned]);

  const jump = () => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setPinned(true);
  };

  const empty = segments.length === 0 && !interim.caller && !interim.agent;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} onScroll={onScroll} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <PhoneOff className="h-5 w-5 text-zinc-300" />
            <p className="text-xs text-zinc-400">
              {callActive ? "Listening…" : "Waiting for a call…"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pb-1">
            {segments.map((s) => (
              <Bubble key={s.id} speaker={s.speaker} text={s.text} language={s.language} ts={s.ts} />
            ))}
            {interim.caller && (
              <Bubble speaker="caller" text={interim.caller.text} language={interim.caller.language} interim />
            )}
            {interim.agent && (
              <Bubble speaker="agent" text={interim.agent.text} language={interim.agent.language} interim />
            )}
          </div>
        )}
      </div>

      {!pinned && !empty && (
        <button
          onClick={jump}
          className="fade-in absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-600 shadow-md hover:bg-zinc-50"
        >
          <ArrowDown className="h-3 w-3" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
