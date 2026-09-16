import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  CornerDownRight,
  MessageCircleQuestion,
  Quote,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { GuidanceItem } from "../lib/types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const KIND_META = {
  objection: { label: "Objection", Icon: AlertTriangle, accent: "border-l-amber-400" },
  faq: { label: "FAQ", Icon: MessageCircleQuestion, accent: "border-l-emerald-400" },
  question: { label: "Question", Icon: MessageCircleQuestion, accent: "border-l-sky-400" },
  ai: { label: "AI assist", Icon: Sparkles, accent: "border-l-violet-400" },
} as const;

export function GuidanceCard({
  card,
  stale,
  onDismiss,
  onFeedback,
}: {
  card: GuidanceItem;
  stale: boolean;
  onDismiss: () => void;
  onFeedback: (helpful: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const meta = KIND_META[card.kind] ?? KIND_META.objection;
  const escalate = card.escalate;

  const copy = () => {
    navigator.clipboard?.writeText(card.response || card.title).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article
      className={cn(
        "card-in rounded-lg border border-zinc-800 border-l-2 bg-zinc-900 transition-opacity duration-500",
        meta.accent,
        escalate && "border-l-red-500 bg-red-950/30",
        stale && "opacity-40"
      )}
    >
      {/* title row */}
      <div className="flex items-start gap-2 px-3.5 pt-3">
        <meta.Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            escalate ? "text-red-400" : "text-zinc-400"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={escalate ? "escalate" : card.kind}>{escalate ? "Escalate" : meta.label}</Badge>
            {card.language === "es" && <Badge variant="neutral">ES</Badge>}
          </div>
          <h3 className="mt-1 text-[13px] font-semibold leading-snug text-zinc-100">
            {card.title}
          </h3>
        </div>
        <Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-6 w-6" onClick={onDismiss} title="Dismiss">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* suggested language */}
      <div className="px-3.5 pb-3 pt-2">
        {card.response ? (
          <div
            className={cn(
              "rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2.5",
              escalate && "border-red-900/60"
            )}
          >
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <Quote className="h-3 w-3" />
              Say this
            </div>
            <p className="text-[13.5px] leading-relaxed text-zinc-100">
              {card.response}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-zinc-700 px-3 py-2 text-xs italic text-zinc-500">
            No approved answer — escalate or take a message for the attorney.
          </p>
        )}

        {card.followUp && (
          <div className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-zinc-400">
            <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <span>
              <span className="font-medium text-zinc-300">Then ask: </span>
              {card.followUp}
            </span>
          </div>
        )}

        {/* footer */}
        <div className="mt-2.5 flex items-center gap-1">
          {card.matchedText && (
            <p className="min-w-0 flex-1 truncate text-[10.5px] italic text-zinc-600">
              “{card.matchedText}”
            </p>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              title="Helpful"
              onClick={() => onFeedback(true)}
              className={cn("h-6 w-6", card.feedback === "helpful" && "text-emerald-400")}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Not helpful"
              onClick={() => onFeedback(false)}
              className={cn("h-6 w-6", card.feedback === "unhelpful" && "text-red-400")}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Copy" onClick={copy} className="h-6 w-6">
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ThinkingCard() {
  return (
    <div className="fade-in flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-3">
      <Sparkles className="h-4 w-4 animate-pulse text-violet-400" />
      <div className="flex-1">
        <div className="text-xs font-medium text-zinc-300">Drafting a suggestion…</div>
        <div className="thinking-shimmer mt-1.5 h-1.5 w-3/4 rounded-full" />
      </div>
    </div>
  );
}
