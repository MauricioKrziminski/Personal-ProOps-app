import { Ban, Clock, Gift, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ORIGIN_LABEL, PLAN_LABEL } from "@/lib/labels";
import { cn, daysSince, relTime } from "@/lib/utils";
import type { AccountRow } from "@/lib/types";

export function StatusBadge({ a }: { a: Pick<AccountRow, "suspended" | "is_trial" | "access" | "origin"> }) {
  if (a.suspended) return <Badge tone="danger"><Ban />Suspensa</Badge>;
  if (a.is_trial) return <Badge tone="info"><Clock />Em teste</Badge>;
  if (a.access === "subscriber" && a.origin === "manual") return <Badge tone="neutral"><Gift />Cortesia</Badge>;
  if (a.access === "subscriber") return <Badge tone="success"><span className="size-1.5 rounded-full bg-success" />Assinante</Badge>;
  if (a.access === "lapsed") return <Badge tone="warning">Encerrada</Badge>;
  return <Badge>Nunca assinou</Badge>;
}

export const PlanBadge = ({ plan }: { plan: string }) =>
  plan === "free" ? <Badge>Free</Badge> : <Badge tone="ink"><Sparkles />{PLAN_LABEL[plan] ?? plan}</Badge>;

export const OriginBadge = ({ origin }: { origin: string | null }) =>
  origin ? <Badge tone="neutral">{ORIGIN_LABEL[origin] ?? origin}</Badge> : <span className="text-muted-foreground">—</span>;

export function UsageBar({ used, max, label }: { used: number; max: number; label?: string }) {
  const pct = max > 0 ? (used / max) * 100 : 0;
  const color = pct >= 100 ? "bg-destructive" : pct >= 90 ? "bg-warning" : "bg-success";
  return (
    <div className="min-w-24" title={label}>
      <div className="mb-1 flex justify-between text-xs tabular-nums">
        <span className={cn("font-semibold", pct >= 100 && "text-destructive", pct >= 90 && pct < 100 && "text-warning")}>{used}</span>
        <span className="text-muted-foreground">/ {max}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className={cn("h-full rounded-full transition-[width]", color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function LastSeen({ iso }: { iso: string | null }) {
  const d = daysSince(iso);
  const stale = d === null || d >= 30;
  return <span className={cn("whitespace-nowrap text-sm", stale ? "font-semibold text-warning" : "text-muted-foreground")}>{relTime(iso)}</span>;
}
