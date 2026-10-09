import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: ComponentProps<"div">) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-[0_1px_0_rgb(0_0_0/0.03)]", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: ComponentProps<"div">) => (
  <div className={cn("flex flex-wrap items-center justify-between gap-2 px-5 pt-5", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: ComponentProps<"h2">) => (
  <h2 className={cn("text-[15px] font-bold tracking-tight", className)} {...p} />
);
export const CardContent = ({ className, ...p }: ComponentProps<"div">) => <div className={cn("p-5", className)} {...p} />;
