import { AlertDialog as AD, Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const overlay = "fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";
/** Mobile: folha colada embaixo e rolável; desktop: diálogo centralizado. */
const panel = "fixed z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto border bg-popover p-5 text-popover-foreground shadow-2xl max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-t-2xl max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 max-sm:data-[state=open]:slide-in-from-bottom sm:data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

export function Modal({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={panel}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <D.Title className="text-lg font-bold tracking-tight">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="-mr-2 -mt-2 grid size-10 place-items-center rounded-lg hover:bg-accent" aria-label="Fechar"><X className="size-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Confirm({ open, onOpenChange, title, description, children, confirmLabel, destructive, busy, disabled, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; children?: ReactNode;
  confirmLabel: string; destructive?: boolean; busy?: boolean; disabled?: boolean; onConfirm: () => void;
}) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className={overlay} />
        <AD.Content className={panel}>
          <AD.Title className="text-lg font-bold tracking-tight">{title}</AD.Title>
          <AD.Description asChild><div className="text-sm text-muted-foreground">{description}</div></AD.Description>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel asChild><Button variant="outline" disabled={busy}>Cancelar</Button></AD.Cancel>
            <Button variant={destructive ? "destructive" : "default"} disabled={busy || disabled} onClick={onConfirm}>
              {busy ? "Aguarde…" : confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

export const DialogActions = ({ className, ...p }: ComponentProps<"div">) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...p} />
);
