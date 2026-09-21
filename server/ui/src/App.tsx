import { useEffect, useState } from "react";
import { History, Lightbulb, Radio, ShieldAlert } from "lucide-react";
import { CallBanner } from "./components/CallBanner";
import { AskBar } from "./components/AskBar";
import { CallerCard } from "./components/CallerCard";
import { ChecklistStrip } from "./components/ChecklistStrip";
import { DispositionBar } from "./components/DispositionBar";
import { FlagStrip } from "./components/FlagStrip";
import { GuidanceCard, ThinkingCard } from "./components/GuidanceCard";
import { Header } from "./components/Header";
import { HistoryView } from "./components/HistoryView";
import { ScriptPanel } from "./components/ScriptPanel";
import { SummaryCard } from "./components/SummaryCard";
import { Transcript } from "./components/Transcript";
import { useAssistant } from "./lib/useAssistant";
import { cn } from "./lib/utils";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {children}
      </span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

type Tab = "live" | "history";

export default function App() {
  const params = new URLSearchParams(location.search);
  const extensionId = params.get("extensionId");
  const token = params.get("token");
  const { state, setPaused, dismiss, sendFeedback, ask, cardStaleMs } = useAssistant(extensionId, token);
  const [tab, setTab] = useState<Tab>("live");
  const now = Date.now();

  // A live call always takes priority — snap back to the Live tab on callStart.
  useEffect(() => {
    if (state.call.active) setTab("live");
  }, [state.call.active]);

  // Keyboard-first card actions during a call: d=dismiss, c=copy,
  // 1/2 = thumbs up/down on the newest card. Skips while typing.
  useEffect(() => {
    if (!state.call.active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const top = state.cards[0];
      if (!top) return;
      if (e.key === "d") dismiss(top.key);
      else if (e.key === "c") {
        navigator.clipboard?.writeText(top.response || top.title).catch(() => {});
      } else if (e.key === "1") sendFeedback(top, true);
      else if (e.key === "2") sendFeedback(top, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.call.active, state.cards, dismiss, sendFeedback]);

  if (!extensionId || !token) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldAlert className="h-6 w-6 text-zinc-300" />
        <p className="text-sm font-medium text-zinc-700">Missing connection details</p>
        <p className="text-xs text-zinc-500">
          This page is opened by the Intake Companion app with an extension and token.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        conn={state.conn}
        extensionId={extensionId}
        agentName={state.agentName}
        paused={state.paused}
        callActive={state.call.active}
        onPause={setPaused}
      />

      <div className="border-b border-zinc-200 bg-white px-4 py-1.5">
        <div className="flex w-fit gap-0.5 rounded-lg bg-zinc-100 p-0.5">
          {(
            [
              { id: "live", label: "Live call", icon: Radio },
              { id: "history", label: "History", icon: History },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] px-3.5 py-1.5 text-[11.5px] font-medium transition-all",
                tab === id
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", id === "live" && state.call.active && tab === "live" && "text-red-600")} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "history" ? (
        <div className="view-in flex min-h-0 flex-1 flex-col" key="history">
          <HistoryView extensionId={extensionId} token={token} callActive={state.call.active} />
        </div>
      ) : (
        <div className="view-in flex min-h-0 flex-1 flex-col" key="live">
          <CallBanner
            active={state.call.active}
            callerNumber={state.call.callerNumber}
            startedAt={state.call.startedAt}
            priorCalls={state.call.priorCalls}
            speaking={state.speaking}
          />
          <FlagStrip flags={state.flags} />
          <ScriptPanel script={state.script} callActive={state.call.active} />
          <CallerCard
            fields={state.liveFields}
            callActive={state.call.active}
            callerNumber={state.call.callerNumber}
          />
          <ChecklistStrip items={state.checklist} callActive={state.call.active} />
          {state.error && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-700">
              Transcription: {state.error}
            </div>
          )}

          <SectionLabel>Guidance</SectionLabel>
          <div className="scroll-slim max-h-[42%] shrink-0 overflow-y-auto px-4 pb-2 pt-2">
            {state.thinking && <ThinkingCard />}
            {state.summary && <SummaryCard summary={state.summary} />}
            {state.summary && !state.call.active && (
              <div className="mt-2">
                <DispositionBar
                  sessionId={state.summary.sessionId}
                  extensionId={extensionId}
                  token={token}
                />
              </div>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {state.cards.map((c, i) => (
                <GuidanceCard
                  key={c.key}
                  card={c}
                  featured={i === 0}
                  stale={now - c.receivedAt > cardStaleMs}
                  onDismiss={() => dismiss(c.key)}
                  onFeedback={(h) => sendFeedback(c, h)}
                />
              ))}
            </div>
            {!state.thinking && state.cards.length === 0 && !state.summary && (
              <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3.5 py-3 text-xs text-zinc-500">
                <Lightbulb className="h-4 w-4 shrink-0 text-zinc-300" />
                {state.call.active
                  ? "Listening — suggested responses will appear here when you need them."
                  : "Approved responses and AI suggestions will appear here during a call."}
              </div>
            )}
          </div>

          <SectionLabel>Transcript</SectionLabel>
          <Transcript
            segments={state.segments}
            interim={state.interim}
            callActive={state.call.active}
          />
          <AskBar
            callActive={state.call.active}
            thinking={state.thinking}
            onAsk={ask}
          />
        </div>
      )}

      <footer className="flex items-center justify-center gap-1.5 border-t border-zinc-200 bg-white px-4 py-1.5 text-[10px] text-zinc-500">
        <ShieldAlert className="h-3 w-3" />
        Suggestions are intake guidance, not legal advice — you are not an attorney.
      </footer>
    </div>
  );
}
