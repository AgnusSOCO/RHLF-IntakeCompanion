import { Lightbulb, ShieldAlert } from "lucide-react";
import { CallBanner } from "./components/CallBanner";
import { GuidanceCard, ThinkingCard } from "./components/GuidanceCard";
import { Header } from "./components/Header";
import { Transcript } from "./components/Transcript";
import { useAssistant } from "./lib/useAssistant";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {children}
      </span>
      <div className="h-px flex-1 bg-zinc-800" />
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
        <ShieldAlert className="h-6 w-6 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-300">Missing connection details</p>
        <p className="text-xs text-zinc-600">
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
      {state.error && (
        <div className="border-b border-amber-900/40 bg-amber-950/30 px-4 py-1.5 text-[11px] text-amber-400">
          Transcription: {state.error}
        </div>
      )}

      <SectionLabel>Guidance</SectionLabel>
      <div className="scroll-slim max-h-[42%] shrink-0 overflow-y-auto px-4 pb-2 pt-2">
        {state.thinking && <ThinkingCard />}
        <div className="flex flex-col gap-2">
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
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-zinc-800 px-3.5 py-3 text-xs text-zinc-600">
            <Lightbulb className="h-4 w-4 shrink-0 text-zinc-700" />
            {state.call.active
              ? "Listening — suggested responses will appear here when you need them."
              : "Approved responses and AI suggestions will appear here during a call."}
          </div>
        )}
      </div>

      <SectionLabel>Transcript</SectionLabel>
      <Transcript segments={state.segments} interim={state.interim} callActive={state.call.active} />

      <footer className="flex items-center justify-center gap-1.5 border-t border-zinc-800 px-4 py-1.5 text-[10px] text-zinc-600">
        <ShieldAlert className="h-3 w-3" />
        Suggestions are intake guidance, not legal advice — you are not an attorney.
      </footer>
    </div>
  );
}
