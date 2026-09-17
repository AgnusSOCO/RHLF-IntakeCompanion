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
  objection: {
    label: "Objection",
    Icon: AlertTriangle,
    accent: "border-l-amber-400",
    tile: "bg-amber-50 text-amber-600",
  },
  faq: {
    label: "FAQ",
    Icon: MessageCircleQuestion,
    accent: "border-l-emerald-500",
    tile: "bg-emerald-50 text-emerald-600",
  },
  question: {
    label: "Question",
    Icon: MessageCircleQuestion,
    accent: "border-l-sky-500",
    tile: "bg-sky-50 text-sky-600",
  },
  ai: {
    label: "AI assist",
    Icon: Sparkles,
    accent: "border-l-violet-500",
    tile: "bg-violet-50 text-violet-600",
  },
} as const;

export function GuidanceCard({
  card,
  stale,
  featured,
  onDismiss,
  onFeedback,
}: {
  card: GuidanceItem;
  stale: boolean;
  featured?: boolean;
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
        "card-in rounded-lg border border-zinc-200 border-l-2 bg-white shadow-sm transition-opacity duration-500",
        meta.accent,
        escalate && "border-l-red-500 bg-red-50/60",
        featured && !stale && "card-featured",
        stale && "opacity-40"
      )}
    >
      {/* title row */}
      <div className="flex items-start gap-2 px-3.5 pt-3">
        <div
          className={cn(
            "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md",
            escalate ? "bg-red-100 text-red-600" : meta.tile
          )}
        >
          <meta.Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={escalate ? "escalate" : card.kind}>{escalate ? "Escalate" : meta.label}</Badge>
            {card.language === "es" && <Badge variant="neutral">ES</Badge>}
          </div>
          <h3 className="mt-1 text-[13px] font-semibold leading-snug text-zinc-900">
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
              "rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5",
              escalate && "border-red-200 bg-red-50"
            )}
          >
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <Quote className="h-3 w-3" />
              Say this
            </div>
            <p className="text-[13.5px] leading-relaxed text-zinc-900">
              {card.response}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs italic text-zinc-500">
            No approved answer — escalate or take a message for the attorney.
          </p>
        )}

        {card.followUp && (
          <div className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-zinc-600">
            <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span>
              <span className="font-medium text-zinc-700">Then ask: </span>
              {card.followUp}
            </span>
          </div>
        )}

        {/* footer */}
        <div className="mt-2.5 flex items-center gap-1">
          {card.matchedText && (
            <p className="min-w-0 flex-1 truncate text-[10.5px] italic text-zinc-400">
              “{card.matchedText}”
            </p>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              title="Helpful"
              onClick={() => onFeedback(true)}
              className={cn("h-6 w-6", card.feedback === "helpful" && "text-emerald-600")}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Not helpful"
              onClick={() => onFeedback(false)}
              className={cn("h-6 w-6", card.feedback === "unhelpful" && "text-red-600")}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" title="Copy" onClick={copy} className="h-6 w-6">
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ThinkingCard() {
  return (
    <div className="fade-in flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3.5 py-3 shadow-sm">
      <Sparkles className="h-4 w-4 animate-pulse text-violet-500" />
      <div className="flex-1">
        <div className="text-xs font-medium text-zinc-600">Drafting a suggestion…</div>
        <div className="thinking-shimmer mt-1.5 h-1.5 w-3/4 rounded-full" />
      </div>
    </div>
  );
}
