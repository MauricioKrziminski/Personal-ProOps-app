import { Ban, Bug, CreditCard, KeyRound, LogOut, MessageSquareOff, Play, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Badge, type Tone } from "@/components/ui/badge";
import { AUDIT_LABEL, ISSUE_STATUS_LABEL, PLAN_LABEL } from "@/lib/labels";
import type { AuditEvent } from "@/lib/types";
import { fmtDate, relTime } from "@/lib/utils";

const META: Record<string, { icon: LucideIcon; tone: Tone }> = {
  plan_changed: { icon: CreditCard, tone: "info" }, plan_forced: { icon: ShieldAlert, tone: "warning" }, suspended: { icon: Ban, tone: "danger" },
  reactivated: { icon: Play, tone: "success" }, signed_out: { icon: LogOut, tone: "neutral" }, password_reset_sent: { icon: KeyRound, tone: "neutral" },
  whatsapp_unlinked: { icon: MessageSquareOff, tone: "neutral" }, account_deleted: { icon: Trash2, tone: "danger" }, issue_triaged: { icon: Bug, tone: "info" },
};

export const ActionBadge = ({ action }: { action: string }) => {
  const m = META[action] ?? { icon: ShieldAlert, tone: "neutral" as Tone };
  return <Badge tone={m.tone}><m.icon />{AUDIT_LABEL[action] ?? action}</Badge>;
};

export function payloadText(p: AuditEvent["payload"]): string {
  if (!p) return "";
  const out: string[] = [];
  if (typeof p.plan === "string") out.push(`Plano ${PLAN_LABEL[p.plan] ?? p.plan}`);
  if (typeof p.period_end === "string") out.push(`até ${fmtDate(p.period_end)}`);
  if (typeof p.reason === "string" && p.reason) out.push(`“${p.reason}”`);
  if (typeof p.from === "string" && typeof p.to === "string") out.push(`${ISSUE_STATUS_LABEL[p.from] ?? p.from} → ${ISSUE_STATUS_LABEL[p.to] ?? p.to}`);
  if (typeof p.email === "string") out.push(p.email);
  return out.join(" · ");
}

export function AuditRow({ e, showTarget = true }: { e: AuditEvent; showTarget?: boolean }) {
  const detail = payloadText(e.payload);
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ActionBadge action={e.action} />
        <span className="text-xs text-muted-foreground" title={fmtDate(e.created_at, true)}>{relTime(e.created_at)} · {fmtDate(e.created_at, true)}</span>
      </div>
      <p className="text-sm">
        <span className="text-muted-foreground">Por </span><span className="font-semibold">{e.admin_email ?? e.admin_user_id.slice(0, 8)}</span>
        {showTarget && (e.target_user_id ? <> <span className="text-muted-foreground">em </span><Link className="break-all font-semibold hover:underline" to={`/contas/${e.target_user_id}`}>{e.target_email ?? e.target_user_id}</Link></> : e.target_email ? <> <span className="text-muted-foreground">em </span><span className="break-all font-semibold">{e.target_email}</span></> : null)}
      </p>
      {detail && <p className="text-[13px] text-muted-foreground">{detail}</p>}
    </div>
  );
}
