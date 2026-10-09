import { AlertTriangle, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SectionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-5 py-10 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-5" /></span>
      <p className="max-w-sm text-sm text-muted-foreground">{error instanceof Error ? error.message : "Não foi possível carregar esta seção."}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><Inbox className="size-5" /></span>
      <p className="font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted-foreground tabular-nums">{from}–{Math.min(page * pageSize, total)} de {total.toLocaleString("pt-BR")}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></Button>
        <span className="min-w-14 text-center tabular-nums text-muted-foreground">{page}/{pages}</span>
        <Button variant="outline" size="icon" aria-label="Próxima página" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}

/** Cartão de seção: título + conteúdo, com os três estados num lugar só. */
export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}
