import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, EyeOff, RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AuditRow } from "@/components/audit-list";
import { IssueStatusBadge, SeverityBadge, SourceBadge, severityColor } from "@/components/issue-badges";
import { Empty, PageHeader, Pager, Section, SectionError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useIsMobile } from "@/lib/hooks";
import { ISSUE_PERIODS, ISSUE_SORTS, ISSUE_SOURCE_LABEL, ISSUE_SEVERITY_LABEL, ISSUE_STATUS_LABEL, PLATFORM_LABEL } from "@/lib/labels";
import type { IssueDetail, IssueSource, IssueStatus, IssuesPage } from "@/lib/types";
import { useSearchBox, useUrlState } from "@/lib/url-state";
import { cn, dayLabel, fmtDate, num, relTime } from "@/lib/utils";

const PAGE_SIZE = 25;
const axis = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
const STATUSES: IssueStatus[] = ["open", "resolved", "ignored"];
const SOURCE_COLOR: Record<IssueSource, string> = { app: "var(--chart-1)", agent: "var(--chart-4)", admin: "var(--chart-2)" };

function Summary({ s }: { s: IssuesPage["summary"] }) {
  const total = s.by_source_24h.app + s.by_source_24h.admin + s.by_source_24h.agent;
  const stats: [string, number][] = [["Eventos em 24 h", s.events_24h], ["Usuários afetados em 24 h", s.users_affected_24h], ["Erros novos em 24 h", s.new_24h]];
  return (
    <section className="relative overflow-hidden rounded-xl bg-hero p-6 text-hero-foreground sm:p-7" aria-label="Resumo">
      <div className="grid gap-6 lg:grid-cols-[auto_1fr_minmax(0,320px)] lg:items-end lg:gap-10">
        <div>
          <p className="text-sm font-medium text-hero-muted">Erros abertos</p>
          <p className="mt-1 text-6xl font-extrabold leading-none tracking-tight tabular-nums">{num(s.open)}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4">
          {stats.map(([l, v]) => <div key={l}><dd className="text-2xl font-bold tabular-nums">{num(v)}</dd><dt className="mt-0.5 text-xs leading-tight text-hero-muted">{l}</dt></div>)}
        </dl>
        <div>
          <p className="mb-2 text-xs text-hero-muted">Por origem, nas últimas 24 h</p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" role="img" aria-label="Eventos por origem">
            {(["app", "agent", "admin"] as const).map((k) => <div key={k} style={{ width: `${total ? (s.by_source_24h[k] / total) * 100 : 0}%`, background: SOURCE_COLOR[k] === "var(--chart-1)" ? "#f4f4f2" : SOURCE_COLOR[k] }} />)}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {(["app", "agent", "admin"] as const).map((k) => <li key={k} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SOURCE_COLOR[k] === "var(--chart-1)" ? "#f4f4f2" : SOURCE_COLOR[k] }} /><span className="text-hero-muted">{ISSUE_SOURCE_LABEL[k]}</span><span className="font-bold tabular-nums">{num(s.by_source_24h[k])}</span></li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function ObservabilityPage() {
  const url = useUrlState();
  const { get, set } = url;
  const [text, setText] = useSearchBox(url);
  const [sp, setSp] = useSearchParams();
  const open = sp.get("issue");
  const openIssue = (id: string | null) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set("issue", id); else n.delete("issue"); return n; }, { replace: true });

  const f = { status: get("status") || "open", source: get("source"), severity: get("severity"), period: get("period") || "7d", q: get("q"), sort: get("sort") || "last_seen_desc", page: Number(get("page")) || 1, page_size: PAGE_SIZE };
  const q = useQuery({ queryKey: ["issues", f], queryFn: () => api.issues(f), placeholderData: keepPreviousData });
  const active = ["source", "severity", "q"].some((k) => get(k)) || get("period") !== "";
  const clear = () => { setText(""); setSp({}, { replace: true }); };
  const items = q.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Observabilidade" subtitle="Erros do app, do painel e do agente, agrupados pela mesma causa." />
      {q.data ? <Summary s={q.data.summary} /> : q.isError ? null : <Skeleton className="h-44 rounded-xl" />}

      <Card className="p-3 sm:p-4">
        <div role="tablist" aria-label="Situação" className="mb-3 inline-flex rounded-lg bg-muted p-1">
          {STATUSES.map((s) => (
            <button key={s} role="tab" aria-selected={f.status === s} onClick={() => set({ status: s === "open" ? "" : s })} className={cn("h-9 rounded-md px-3.5 text-sm font-semibold transition-colors", f.status === s ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {ISSUE_STATUS_LABEL[s]}{s === "open" && q.data ? <span className="ml-1.5 tabular-nums text-muted-foreground">{q.data.summary.open}</span> : null}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Buscar por título, mensagem ou rota" placeholder="Buscar por título, mensagem ou rota" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <Select aria-label="Origem" value={f.source} onChange={(e) => set({ source: e.target.value })}><option value="">Origem</option>{Object.entries(ISSUE_SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Severidade" value={f.severity} onChange={(e) => set({ severity: e.target.value })}><option value="">Severidade</option>{Object.entries(ISSUE_SEVERITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Período" value={f.period} onChange={(e) => set({ period: e.target.value === "7d" ? "" : e.target.value })}>{ISSUE_PERIODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Ordenar por" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{ISSUE_SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </div>
        {active && <Button variant="ghost" size="sm" className="mt-2" onClick={clear}><X />Limpar filtros</Button>}
      </Card>

      <Card className={q.isFetching && q.data ? "opacity-70 transition-opacity" : "transition-opacity"}>
        {q.isError ? <SectionError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton /> : items.length === 0 ? (
          f.status === "open" && !active ? <Empty title="Nenhum erro aberto — tudo calmo" hint="Quando algo quebrar no app, no painel ou no agente, aparece aqui." />
            : <Empty title="Nenhum erro encontrado" hint="Tente outro período ou remova algum filtro." action={<Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button>} />
        ) : (
          <>
            <ul className="divide-y md:hidden">{items.map((i) => (
              <li key={i.id}><button onClick={() => openIssue(i.id)} className="block w-full p-4 text-left active:bg-accent/60">
                <div className="flex flex-wrap items-center gap-1.5"><SeverityBadge s={i.severity} /><SourceBadge s={i.source} />{i.status !== "open" && <IssueStatusBadge s={i.status} />}</div>
                <p className="mt-2 truncate font-semibold">{i.title}</p>
                <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{i.message}</p>
                <p className="mt-2 text-xs tabular-nums text-muted-foreground">{num(i.count)} eventos · {num(i.users_affected)} usuários · {relTime(i.last_seen)}</p>
              </button></li>
            ))}</ul>
            <div className="hidden md:block">
              <Table>
                <THead><tr><TH>Erro</TH><TH>Severidade</TH><TH>Origem</TH><TH className="text-right">Eventos</TH><TH className="text-right">Usuários</TH><TH>Última vez</TH>{f.status !== "open" && <TH>Situação</TH>}</tr></THead>
                <tbody>{items.map((i) => (
                  <TR key={i.id} className="cursor-pointer" onClick={() => openIssue(i.id)}>
                    <TD className="max-w-[360px]">
                      <button className="block max-w-full truncate text-left font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); openIssue(i.id); }}>{i.title}</button>
                      <p className="truncate text-xs text-muted-foreground">{i.message}</p>
                      {i.route && <p className="truncate font-mono text-[11px] text-muted-foreground/80">{i.route}</p>}
                    </TD>
                    <TD><SeverityBadge s={i.severity} /></TD>
                    <TD><SourceBadge s={i.source} /></TD>
                    <TD className="text-right font-bold tabular-nums">{num(i.count)}</TD>
                    <TD className="text-right tabular-nums">{num(i.users_affected)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground" title={fmtDate(i.last_seen, true)}>{relTime(i.last_seen)}</TD>
                    {f.status !== "open" && <TD><IssueStatusBadge s={i.status} /></TD>}
                  </TR>
                ))}</tbody>
              </Table>
            </div>
            <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} />
          </>
        )}
      </Card>
      <Drawer open={!!open} onOpenChange={(o) => !o && openIssue(null)} title="Detalhe do erro">{open && <IssueBody id={open} />}</Drawer>
    </div>
  );
}

function ListSkeleton() {
  return <div aria-busy className="divide-y">{Array.from({ length: 7 }, (_, i) => <div key={i} className="flex items-center gap-4 p-4"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div><Skeleton className="hidden h-6 w-16 md:block" /><Skeleton className="hidden h-6 w-12 md:block" /><Skeleton className="h-4 w-16" /></div>)}</div>;
}

function Tip({ active, payload, fmt }: { active?: boolean; payload?: { value: number; payload: { x: string } }[]; fmt: (x: string) => string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"><p className="text-muted-foreground">{fmt(payload[0].payload.x)}</p><p className="text-sm font-bold tabular-nums">{payload[0].value} {payload[0].value === 1 ? "evento" : "eventos"}</p></div>;
}

function Series({ data, color, fmt, label }: { data: { x: string; count: number }[]; color: string; fmt: (x: string) => string; label: string }) {
  return (
    <div className="h-36" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -24, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="x" tickFormatter={fmt} tick={axis} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--accent)" }} content={<Tip fmt={fmt} />} />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const Fact = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words text-sm font-semibold">{v}</dd></div>;

function IssueBody({ id }: { id: string }) {
  const qc = useQueryClient();
  const mobile = useIsMobile();
  const q = useQuery({ queryKey: ["issue", id], queryFn: () => api.issue(id) });
  const [copied, setCopied] = useState(false);
  const m = useMutation({
    mutationFn: ({ status }: { status: IssueStatus; prev: IssueStatus }) => api.setIssueStatus(id, status),
    onSuccess: (d: IssueDetail, v) => {
      qc.setQueryData(["issue", id], d);
      void qc.invalidateQueries({ queryKey: ["issues"] });
      void qc.invalidateQueries({ queryKey: ["overview"] });
      const msg = v.status === "resolved" ? "Erro resolvido" : v.status === "ignored" ? "Erro ignorado" : "Erro reaberto";
      toast.success(msg, { id: "issue-status", action: { label: "Desfazer", onClick: () => m.mutate({ status: v.prev, prev: v.status }) } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível atualizar."),
  });

  if (q.isError) return <div><SectionError error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <div aria-busy className="space-y-4 p-5"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-36" /><Skeleton className="h-40" /></div>;
  const { issue: i, stack, hourly_24h, daily_30d, events, triage } = q.data;
  const act = (status: IssueStatus) => m.mutate({ status, prev: i.status });
  const copy = () => { void navigator.clipboard?.writeText(stack ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); };
  const color = severityColor(i.severity);

  return (
    <div className="flex flex-col gap-6 p-5 sm:p-6">
      <header>
        <div className="flex flex-wrap items-center gap-1.5"><SeverityBadge s={i.severity} /><SourceBadge s={i.source} /><IssueStatusBadge s={i.status} /></div>
        <h2 className="mt-3 break-words text-xl font-extrabold tracking-tight">{i.title}</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{i.message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {i.status === "open" ? (<>
            <Button disabled={m.isPending} onClick={() => act("resolved")}><Check />{m.isPending ? "Aguarde…" : "Resolver"}</Button>
            <Button variant="outline" disabled={m.isPending} onClick={() => act("ignored")}><EyeOff />Ignorar</Button>
          </>) : <Button disabled={m.isPending} onClick={() => act("open")}><RotateCcw />{m.isPending ? "Aguarde…" : "Reabrir"}</Button>}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 rounded-lg border p-4 sm:grid-cols-3">
        <Fact k="Eventos" v={<span className="tabular-nums">{num(i.count)}</span>} />
        <Fact k="Usuários afetados" v={<span className="tabular-nums">{num(i.users_affected)}</span>} />
        <Fact k="Plataformas" v={i.platforms.length ? i.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") : "—"} />
        <Fact k="Versão" v={i.last_app_version ?? "—"} />
        <Fact k="Rota" v={i.route ? <span className="font-mono text-[13px]">{i.route}</span> : "—"} />
        <Fact k="Tipo" v={i.kind} />
        <Fact k="Primeira vez" v={fmtDate(i.first_seen, true)} />
        <Fact k="Última vez" v={fmtDate(i.last_seen, true)} />
      </dl>

      <section>
        <h3 className="mb-2 text-sm font-bold">Últimas 24 horas</h3>
        <Series data={hourly_24h.map((h) => ({ x: h.hour, count: h.count }))} color={color} fmt={(x) => `${String(new Date(x).getHours()).padStart(2, "0")}h`} label="Eventos por hora nas últimas 24 horas" />
      </section>
      <section>
        <h3 className="mb-2 text-sm font-bold">Últimos 30 dias</h3>
        <Series data={daily_30d.map((d) => ({ x: d.day, count: d.count }))} color={color} fmt={dayLabel} label="Eventos por dia nos últimos 30 dias" />
      </section>

      {stack && (
        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold">Stack trace</h3><Button variant="outline" size="sm" onClick={copy}>{copied ? <Check /> : <Copy />}{copied ? "Copiado" : "Copiar"}</Button></div>
          <pre tabIndex={0} className="max-h-72 overflow-auto rounded-lg border bg-muted p-3.5 font-mono text-xs leading-relaxed whitespace-pre">{stack}</pre>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-bold">Ocorrências recentes <span className="font-medium text-muted-foreground">· {events.length}</span></h3>
        {events.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma ocorrência guardada (retenção de 30 dias).</p> : (
          <ul className="divide-y rounded-lg border">
            {events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 px-3.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  {e.user_id ? <Link to={`/contas/${e.user_id}`} className="min-w-0 truncate font-semibold hover:underline">{e.user_email ?? e.user_id.slice(0, 8)}</Link> : <span className="text-muted-foreground">Sem usuário</span>}
                  <span className="text-xs text-muted-foreground" title={fmtDate(e.created_at, true)}>{relTime(e.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{[e.platform && (PLATFORM_LABEL[e.platform] ?? e.platform), e.app_version, e.route].filter(Boolean).join(" · ") || "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title="Histórico de triagem" className={mobile ? "-mx-1" : ""}>
        {triage.length === 0 ? <p className="px-5 pb-5 pt-2 text-sm text-muted-foreground">Ninguém triou este erro ainda.</p> : <div className="mt-2 divide-y">{triage.map((t) => <AuditRow key={t.id} e={t} showTarget={false} />)}</div>}
      </Section>
    </div>
  );
}
