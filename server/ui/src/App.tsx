import { Lightbulb, ShieldAlert } from "lucide-react";
import { CallBanner } from "./components/CallBanner";
import { ChecklistStrip } from "./components/ChecklistStrip";
import { GuidanceCard, ThinkingCard } from "./components/GuidanceCard";
import { Header } from "./components/Header";
import { SummaryCard } from "./components/SummaryCard";
import { Transcript } from "./components/Transcript";
import { useAssistant } from "./lib/useAssistant";

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

export default function App() {
  const params = new URLSearchParams(location.search);
  const extensionId = params.get("extensionId");
  const token = params.get("token");
  const { state, setPaused, dismiss, sendFeedback, cardStaleMs } = useAssistant(extensionId, token);
  const now = Date.now();

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
        paused={state.paused}
        callActive={state.call.active}
        onPause={setPaused}
      />
      <CallBanner
        active={state.call.active}
        callerNumber={state.call.callerNumber}
        startedAt={state.call.startedAt}
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
        <div className="mt-2 flex flex-col gap-2">
          {state.cards.map((c) => (
            <GuidanceCard
              key={c.key}
              card={c}
              stale={now - c.receivedAt > cardStaleMs}
              onDismiss={() => dismiss(c.key)}
              onFeedback={(h) => sendFeedback(c, h)}
            />
          ))}
        </div>
        {!state.thinking && state.cards.length === 0 && (
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-zinc-300 bg-white px-3.5 py-3 text-xs text-zinc-500">
            <Lightbulb className="h-4 w-4 shrink-0 text-zinc-300" />
            {state.call.active
              ? "Listening — suggested responses will appear here when you need them."
              : "Approved responses and AI suggestions will appear here during a call."}
          </div>
        )}
      </div>

      <SectionLabel>Transcript</SectionLabel>
      <Transcript segments={state.segments} interim={state.interim} callActive={state.call.active} />

      <footer className="flex items-center justify-center gap-1.5 border-t border-zinc-200 bg-white px-4 py-1.5 text-[10px] text-zinc-500">
        <ShieldAlert className="h-3 w-3" />
        Suggestions are intake guidance, not legal advice — you are not an attorney.
      </footer>
    </div>
  );
}
