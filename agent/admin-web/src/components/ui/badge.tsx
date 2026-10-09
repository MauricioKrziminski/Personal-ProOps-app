import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-muted-foreground",
      ink: "border-transparent bg-primary text-primary-foreground",
      success: "border-success/25 bg-success/12 text-success",
      warning: "border-warning/30 bg-warning/12 text-warning",
      danger: "border-destructive/30 bg-destructive/10 text-destructive",
      info: "border-sky-600/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type Tone = NonNullable<VariantProps<typeof badge>["tone"]>;
export const Badge = ({ className, tone, ...p }: ComponentProps<"span"> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
