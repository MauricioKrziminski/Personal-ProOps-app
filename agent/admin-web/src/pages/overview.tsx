import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, BellRing, Clock, ExternalLink, Gift, Hourglass, PauseCircle, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, SectionError, Section } from "@/components/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/lib/hooks";
import type { Overview } from "@/lib/types";
import { cn, dayLabel, monthLabel, num, usd } from "@/lib/utils";

function ChartTip({ active, payload, label, fmt }: { active?: boolean; payload?: { value: number }[]; label?: string; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"><p className="text-muted-foreground">{label}</p><p className="text-sm font-bold tabular-nums">{fmt(payload[0].value)}</p></div>;
}

const axis = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

function Kpi({ icon: Icon, label, value, to, tone }: { icon: LucideIcon; label: string; value: number; to?: string; tone?: "warn" | "bad" }) {
  const body = (
    <>
      <div className="flex items-center justify-between text-muted-foreground"><Icon className="size-4" />{to && <ArrowUpRight className="size-4 opacity-60" />}</div>
      <p className="mt-3 text-[28px] font-extrabold leading-none tracking-tight tabular-nums">{num(value)}</p>
      <p className="mt-1.5 text-[13px] font-medium text-muted-foreground">{label}</p>
    </>
  );
  const cls = cn("block rounded-lg border bg-card p-4 transition-colors", to && "hover:bg-accent/60", tone === "warn" && "ring-1 ring-warning/30", tone === "bad" && "ring-1 ring-destructive/30");
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Hero({ d }: { d: Overview }) {
  const paying = d.plans.pro + d.plans.family;
  return (
    <section className="relative overflow-hidden rounded-xl bg-hero p-6 text-hero-foreground sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full border border-white/10" />
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 size-72 rounded-full border border-white/10" />
      <p className="text-sm font-medium text-hero-muted">Contas cadastradas</p>
      <p className="mt-1 text-5xl font-extrabold leading-none tracking-tight tabular-nums sm:text-6xl">{num(d.accounts.total)}</p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {[["Novas em 7 dias", `+${num(d.accounts.new_7d)}`], ["Novas em 30 dias", `+${num(d.accounts.new_30d)}`], ["Plano Pro", num(d.plans.pro)], ["Plano Família", num(d.plans.family)]].map(([l, v]) => (
          <div key={l}><p className="text-xs text-hero-muted">{l}</p><p className="mt-0.5 text-xl font-bold tabular-nums">{v}</p></div>
        ))}
      </div>
      <p className="mt-5 text-xs text-hero-muted">{num(paying)} em planos pagos · {d.accounts.total ? ((paying / d.accounts.total) * 100).toFixed(1).replace(".", ",") : "0"}% das contas</p>
    </section>
  );
}

function Signals({ d }: { d: Overview }) {
  const s = d.signals;
  const items: { icon: LucideIcon; label: string; n: number; to: string; bad?: boolean }[] = [
    { icon: Hourglass, label: "Teste acaba em 48 h", n: s.trial_ending_48h, to: "/contas?access=trialing" },
    { icon: UserMinus, label: "Encerradas nos últimos 7 dias", n: s.lapsed_7d, to: "/contas?access=lapsed", bad: true },
    { icon: BellRing, label: "Perto do limite do mês", n: s.near_limit, to: "/contas?access=subscriber&sort=ai_used_desc" },
    { icon: Clock, label: "Assinantes sem acesso há 30 dias", n: s.inactive_subscribers_30d, to: "/contas?access=subscriber&sort=last_sign_in_asc" },
  ];
  return (
    <Section title="Sinais" aside={<span className="text-xs text-muted-foreground">Toque para ver as contas</span>}>
      <ul className="grid gap-px p-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", i.n === 0 ? "bg-muted text-muted-foreground" : i.bad ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning")}><i.icon className="size-4" /></span>
              <span className="min-w-0 flex-1 text-[13px] font-medium leading-tight">{i.label}</span>
              <span className="text-xl font-extrabold tabular-nums">{num(i.n)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Distribution({ d }: { d: Overview }) {
  const total = d.accounts.total || 1;
  const rows: { k: string; label: string; n: number; color: string }[] = [
    { k: "subscriber", label: "Assinantes", n: d.access.subscriber, color: "var(--chart-3)" },
    { k: "trialing", label: "Em teste", n: d.access.trialing, color: "#3b82f6" },
    { k: "courtesy", label: "Cortesias", n: d.access.courtesy, color: "var(--chart-1)" },
    { k: "lapsed", label: "Encerradas", n: d.access.lapsed, color: "var(--chart-4)" },
    { k: "never", label: "Nunca assinaram", n: d.access.never, color: "var(--chart-2)" },
    { k: "suspended", label: "Suspensas", n: d.access.suspended, color: "var(--chart-5)" },
  ];
  return (
    <Section title="Contas por acesso">
      <div className="p-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Distribuição das contas por acesso">
          {rows.map((r) => <div key={r.k} style={{ width: `${(r.n / total) * 100}%`, background: r.color }} title={`${r.label}: ${r.n}`} />)}
        </div>
        <ul className="mt-5 grid gap-1 sm:grid-cols-2">
          {rows.map((r) => (
            <li key={r.k}>
              <Link to={`/contas?access=${r.k}`} className="flex min-h-10 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                <span className="flex-1 font-medium">{r.label}</span>
                <span className="tabular-nums font-bold">{num(r.n)}</span>
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{((r.n / total) * 100).toFixed(1).replace(".", ",")}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

export function OverviewPage() {
  const { config } = useAuth();
  const q = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  const mobile = useIsMobile();
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Visão geral" subtitle="Como o ProOps está agora." actions={config?.revenuecat_dashboard_url ? (
        <a href={config.revenuecat_dashboard_url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-semibold hover:bg-accent">Receita e conversão na RevenueCat<ExternalLink className="size-4" /></a>
      ) : undefined} />
      {q.isError ? <Card><SectionError error={q.error} onRetry={() => void q.refetch()} /></Card> : !d ? <OverviewSkeleton /> : (
        <>
          <Hero d={d} />
          <Signals d={d} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={Users} label="Assinantes ativos" value={d.access.subscriber} to="/contas?access=subscriber" />
            <Kpi icon={Clock} label="Em teste" value={d.access.trialing} to="/contas?access=trialing" />
            <Kpi icon={Gift} label="Cortesias" value={d.access.courtesy} to="/contas?access=courtesy" />
            <Kpi icon={PauseCircle} label="Suspensas" value={d.access.suspended} to="/contas?access=suspended" tone={d.access.suspended ? "bad" : undefined} />
            <Kpi icon={UserMinus} label="Encerradas" value={d.access.lapsed} to="/contas?access=lapsed" />
            <Kpi icon={AlertTriangle} label="Nunca assinaram" value={d.access.never} to="/contas?access=never" />
            <Kpi icon={UserPlus} label="Novas em 7 dias" value={d.accounts.new_7d} />
            <Kpi icon={UserPlus} label="Novas em 30 dias" value={d.accounts.new_30d} />
          </div>

          <Section title="Uso do mês">
            <dl className="grid grid-cols-2 gap-px p-3 lg:grid-cols-4">
              {([["Turnos de IA", num(d.usage_month.ai_turns)], ["Respostas no WhatsApp", num(d.usage_month.whatsapp_replies)], ["Avisos enviados", num(d.usage_month.notices)], ["Custo de IA", usd(d.usage_month.ai_cost_usd)]] as const).map(([l, v]) => (
                <div key={l} className="px-3 py-2"><dt className="text-[13px] font-medium text-muted-foreground">{l}</dt><dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Cadastros por mês" aside={<span className="text-xs text-muted-foreground">12 meses</span>}>
              <div className="h-60 px-2 pb-4 pt-4 sm:h-64" role="img" aria-label="Gráfico de cadastros por mês">
                <ResponsiveContainer>
                  <BarChart data={d.signups_by_month} margin={{ left: -18, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="month" tickFormatter={monthLabel} tick={axis} tickLine={false} axisLine={false} interval={mobile ? 1 : 0} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTip fmt={(v) => `${v} cadastros`} />} labelFormatter={(l) => monthLabel(String(l))} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section title="Custo de IA por dia" aside={<span className="text-xs text-muted-foreground">30 dias · US$</span>}>
              <div className="h-60 px-2 pb-4 pt-4 sm:h-64" role="img" aria-label="Gráfico do custo de IA por dia">
                <ResponsiveContainer>
                  <AreaChart data={d.ai_cost_by_day.map((x) => ({ day: x.day, usd: Number(x.usd) }))} margin={{ left: -12, right: 8 }}>
                    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" tickFormatter={dayLabel} tick={axis} tickLine={false} axisLine={false} minTickGap={mobile ? 40 : 24} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
                    <Tooltip content={<ChartTip fmt={(v) => usd(v, 4)} />} labelFormatter={(l) => dayLabel(String(l))} />
                    <Area type="monotone" dataKey="usd" stroke="var(--chart-1)" strokeWidth={2} fill="url(#g)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
          <Distribution d={d} />
        </>
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-28 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-72 rounded-lg" /><Skeleton className="h-72 rounded-lg" /></div>
    </div>
  );
}
