import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const field = "h-11 w-full rounded-lg border border-input bg-card px-3 text-base sm:text-sm placeholder:text-muted-foreground disabled:opacity-50";

export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cn(field, className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => (
  <textarea className={cn(field, "h-auto min-h-20 py-2", className)} {...p} />
);
/** <select> nativo: no celular abre o seletor do sistema, sem hover nem popover frágil. */
export const Select = ({ className, ...p }: ComponentProps<"select">) => (
  <select className={cn(field, "appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238c8b86' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)} {...p} />
);
export const Label = ({ className, ...p }: ComponentProps<"label">) => (
  <label className={cn("mb-1.5 block text-[13px] font-semibold", className)} {...p} />
);
