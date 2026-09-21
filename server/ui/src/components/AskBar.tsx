import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Ask-the-assistant: the agent types anything mid-call ("how do I explain
 * contingency?", "what should I ask next?") and the answer lands as a normal
 * guidance card, grounded in the live transcript. Focused with `/`.
 */
export function AskBar({
  callActive,
  thinking,
  onAsk,
  trailing,
}: {
  callActive: boolean;
  thinking: boolean;
  onAsk: (question: string) => void;
  trailing?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the input from anywhere during a call.
  useEffect(() => {
    if (!callActive) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [callActive]);

  if (!callActive) return null;

  const submit = () => {
    const q = value.trim();
    if (!q) return;
    onAsk(q);
    setValue("");
  };

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-2">
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 transition-colors",
          "focus-within:border-violet-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-violet-100"
        )}
      >
        <Sparkles className={cn("h-3.5 w-3.5 shrink-0", thinking ? "animate-pulse text-violet-500" : "text-zinc-400")} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          placeholder="Ask the assistant… (how to answer, what to ask next)"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 sm:block">
          /
        </kbd>
        {trailing}
      </div>
    </div>
  );
}
