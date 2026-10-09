import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, ExternalLink, Play, Smartphone, UserCog } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccountMenu, ActionHost, type Target } from "@/components/account-actions";
import { AuditRow } from "@/components/audit-list";
import { LastSeen, OriginBadge, PlanBadge, StatusBadge, UsageBar } from "@/components/badges";
import { Empty, SectionError, Section } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resultTone } from "@/pages/billing";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BILLING_RESULT_LABEL, COUNT_LABEL, INVITE_STATUS_LABEL, ORIGIN_LABEL, SUB_STATUS_LABEL } from "@/lib/labels";
import type { AccountDetail } from "@/lib/types";
import { fmtDate, monthLabel, nomeDaConta, num, usd } from "@/lib/utils";

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm"><dt className="shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0 break-words text-right font-medium">{v}</dd></div>
);

export function AccountDetailPage() {
  const { id = "" } = useParams();
  const { config } = useAuth();
  const [target, setTarget] = useState<Target>(null);
  const q = useQuery({ queryKey: ["account", id], queryFn: () => api.account(id), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const d = q.data;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/contas" className="inline-flex h-10 w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Contas</Link>
      {q.isError ? (
        <Card>{q.error instanceof ApiError && q.error.status === 404
          ? <Empty title="Conta não encontrada" hint="Ela pode ter sido apagada." action={<Button asChild variant="outline" size="sm"><Link to="/contas">Voltar às contas</Link></Button>} />
          : <SectionError error={q.error} onRetry={() => void q.refetch()} />}</Card>
      ) : !d ? <DetailSkeleton /> : (
        <>
          <Header d={d} onAction={(kind) => setTarget({ kind, row: d.account })} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Subscription d={d} rc={config?.revenuecat_dashboard_url} />
            <Usage d={d} />
            <Counts d={d} />
            <People d={d} />
            <Billing d={d} />
            <Section title="Auditoria da conta" aside={<Link to={`/auditoria?target_user_id=${d.account.user_id}`} className="text-xs font-semibold underline-offset-4 hover:underline">Ver tudo</Link>}>
              {d.admin_events.length === 0 ? <Empty title="Nenhuma ação registrada" hint="Mudanças feitas por administradores nesta conta aparecem aqui." /> : (
                <div className="mt-2 divide-y">{d.admin_events.map((e) => <AuditRow key={e.id} e={e} showTarget={false} />)}</div>
              )}
            </Section>
          </div>
        </>
      )}
      <ActionHost target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function Header({ d, onAction }: { d: AccountDetail; onAction: (k: Parameters<typeof AccountMenu>[0]["onAction"] extends (k: infer K) => void ? K : never) => void }) {
  const a = d.account;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-all text-xl font-extrabold tracking-tight sm:text-2xl">{nomeDaConta(a)}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.name ?? "Sem nome"} · cadastro em {fmtDate(a.created_at)} · acesso <LastSeen iso={a.last_sign_in_at} /></p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <PlanBadge plan={a.plan} /><StatusBadge a={a} /><OriginBadge origin={a.origin} />
            {a.whatsapp_linked ? <Badge tone="success"><Smartphone />WhatsApp vinculado</Badge> : <Badge>Sem WhatsApp</Badge>}
          </div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button onClick={() => onAction("plan")} className="flex-1 sm:flex-none"><UserCog />Mudar plano</Button>
          {a.suspended
            ? <Button variant="outline" onClick={() => onAction("reactivate")} className="flex-1 sm:flex-none"><Play />Reativar</Button>
            : <Button variant="outline" onClick={() => onAction("suspend")} className="flex-1 sm:flex-none"><Ban />Suspender</Button>}
          <AccountMenu row={a} onAction={onAction} trigger="button" />
        </div>
      </div>
      {a.suspended && <p role="status" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive">Conta suspensa. Sem acesso ao app e sem respostas no WhatsApp.</p>}
    </Card>
  );
}

function Subscription({ d, rc }: { d: AccountDetail; rc?: string }) {
  const s = d.subscription;
  return (
    <Section title="Assinatura">
      <div className="px-5 pb-4 pt-1">
        {s.store_managed && (
          <div className="mb-2 mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-semibold text-warning">Assinatura gerenciada pela loja</p>
            <p className="mt-0.5 text-muted-foreground">Mudar o plano aqui exige forçar, e a próxima notificação da loja sobrescreve.</p>
            {rc && <a href={rc} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-1.5 font-semibold underline-offset-4 hover:underline">Ver no RevenueCat<ExternalLink className="size-3.5" /></a>}
          </div>
        )}
        <dl className="divide-y">
          <Row k="Plano" v={<PlanBadge plan={s.plan} />} />
          <Row k="Status" v={SUB_STATUS_LABEL[s.status] ?? (s.status || "—")} />
          <Row k="Origem" v={ORIGIN_LABEL[s.provider] ?? (s.provider || "—")} />
          <Row k="Período termina em" v={fmtDate(s.current_period_end)} />
          {s.is_trial && <Row k="Teste" v="Sim" />}
          {s.canceled_at && <Row k="Cancelada em" v={fmtDate(s.canceled_at, true)} />}
          <Row k="Produto" v={s.product_id || "—"} />
          <Row k="Ambiente" v={s.environment || "—"} />
          <Row k="ID externo" v={<code className="select-all text-xs">{s.external_id || "—"}</code>} />
        </dl>
      </div>
    </Section>
  );
}

function Usage({ d }: { d: AccountDetail }) {
  const c = d.usage.current;
  const months = d.usage.months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  return (
    <Section title="Uso" aside={<span className="text-xs text-muted-foreground">Custo de IA no mês {usd(c.ai_cost_usd, 4)}</span>}>
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">IA</p><UsageBar used={c.ai_used} max={c.ai_max} label="Turnos de IA no mês" /></div>
        <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp</p><UsageBar used={c.wa_used} max={c.wa_max} label="Respostas no mês" /></div>
        <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avisos hoje</p><UsageBar used={c.notices_today} max={c.notices_max} label="Avisos hoje" /></div>
      </div>
      <div className="h-40 px-2 pb-4" role="img" aria-label="Uso de IA e WhatsApp nos últimos 6 meses">
        <ResponsiveContainer>
          <BarChart data={months} margin={{ left: -22, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }} />
            <Bar name="Turnos de IA" dataKey="ai_turns" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar name="Respostas WhatsApp" dataKey="whatsapp_replies" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

function Counts({ d }: { d: AccountDetail }) {
  return (
    <Section title="Dados" aside={<span className="text-xs text-muted-foreground">Só quantidades</span>}>
      <dl className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        {Object.entries(d.counts).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/60 px-3 py-2.5"><dt className="text-xs text-muted-foreground">{COUNT_LABEL[k] ?? k}</dt><dd className="mt-0.5 text-xl font-extrabold tabular-nums">{num(v)}</dd></div>
        ))}
      </dl>
      <dl className="divide-y px-5 pb-4">
        <Row k="E-mail confirmado" v={d.profile.email_confirmed_at ? fmtDate(d.profile.email_confirmed_at) : "Não"} />
        <Row k="Onboarding" v={d.profile.onboarding_completed ? "Concluído" : "Pendente"} />
        <Row k="Sessões ativas" v={d.profile.sessions} />
        <Row k="WhatsApp" v={d.profile.phone ?? "Não vinculado"} />
      </dl>
    </Section>
  );
}

function People({ d }: { d: AccountDetail }) {
  return (
    <Section title="Membros e convites">
      <ul className="divide-y px-1 pb-1 pt-2">
        {d.members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="truncate text-sm font-semibold">{nomeDaConta(m)}</p><p className="truncate text-xs text-muted-foreground">{m.name ?? "Sem nome"}</p></div>
            <Badge tone={m.role === "owner" ? "ink" : "neutral"}>{m.role === "owner" ? "Dono" : "Membro"}</Badge>
          </li>
        ))}
        {d.invites.map((i) => (
          <li key={i.phone + i.created_at} className="flex items-center justify-between gap-3 px-4 py-3">
            <div><p className="text-sm font-semibold">{i.phone}</p><p className="text-xs text-muted-foreground">Convite em {fmtDate(i.created_at)}</p></div>
            <Badge tone="warning">{INVITE_STATUS_LABEL[i.status] ?? i.status}</Badge>
          </li>
        ))}
      </ul>
      {d.members.length + d.invites.length === 0 && <Empty title="Sem membros" />}
    </Section>
  );
}

function Billing({ d }: { d: AccountDetail }) {
  return (
    <Section title="Histórico de cobrança">
      {d.billing_events.length === 0 ? <Empty title="Nenhum evento de cobrança" hint="Compras e renovações da loja aparecem aqui." /> : (
        <ul className="divide-y px-1 pb-1 pt-2">{d.billing_events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><code className="text-xs font-bold">{e.type}</code><p className="text-xs text-muted-foreground">{fmtDate(e.created_at, true)}</p></div>
            <Badge tone={resultTone(e.result)}>{BILLING_RESULT_LABEL[e.result] ?? e.result}</Badge>
          </li>
        ))}</ul>
      )}
    </Section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-5">
      <Skeleton className="h-36 rounded-lg" />
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-72 rounded-lg" /><Skeleton className="h-72 rounded-lg" /><Skeleton className="h-56 rounded-lg" /><Skeleton className="h-56 rounded-lg" /></div>
    </div>
  );
}
