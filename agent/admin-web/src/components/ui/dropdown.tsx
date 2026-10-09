import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuContent = ({ className, ...p }: ComponentProps<typeof M.Content>) => (
  <M.Portal>
    <M.Content align="end" sideOffset={6} className={cn("z-50 min-w-52 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)} {...p} />
  </M.Portal>
);
export const MenuItem = ({ className, destructive, ...p }: ComponentProps<typeof M.Item> & { destructive?: boolean }) => (
  <M.Item className={cn("flex min-h-10 cursor-default items-center gap-2.5 rounded-md px-2.5 text-sm font-medium outline-none data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground", destructive && "text-destructive [&_svg]:text-destructive", className)} {...p} />
);
export const MenuSep = () => <M.Separator className="my-1 h-px bg-border" />;
