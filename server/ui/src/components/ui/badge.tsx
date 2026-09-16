import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
  {
    variants: {
      variant: {
        objection: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        faq: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        question: "border-sky-500/30 bg-sky-500/10 text-sky-400",
        ai: "border-violet-500/30 bg-violet-500/10 text-violet-400",
        escalate: "border-red-500/40 bg-red-500/10 text-red-400",
        neutral: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
