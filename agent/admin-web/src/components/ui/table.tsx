import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Table = ({ className, ...p }: ComponentProps<"table">) => (
  <div className="w-full overflow-x-auto"><table className={cn("w-full text-sm", className)} {...p} /></div>
);
export const THead = (p: ComponentProps<"thead">) => <thead className="border-b text-left" {...p} />;
export const TR = ({ className, ...p }: ComponentProps<"tr">) => (
  <tr className={cn("border-b last:border-0 transition-colors hover:bg-accent/50", className)} {...p} />
);
export const TH = ({ className, ...p }: ComponentProps<"th">) => (
  <th className={cn("h-10 whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)} {...p} />
);
export const TD = ({ className, ...p }: ComponentProps<"td">) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;
