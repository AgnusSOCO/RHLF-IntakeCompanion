import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
  {
    variants: {
      variant: {
        objection: "border-amber-300 bg-amber-50 text-amber-700",
        faq: "border-emerald-300 bg-emerald-50 text-emerald-700",
        question: "border-sky-300 bg-sky-50 text-sky-700",
        ai: "border-violet-300 bg-violet-50 text-violet-700",
        escalate: "border-red-300 bg-red-50 text-red-700",
        neutral: "border-zinc-300 bg-zinc-100 text-zinc-600",
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
