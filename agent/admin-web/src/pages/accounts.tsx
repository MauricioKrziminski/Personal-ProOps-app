import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Search, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router";
import { AccountMenu, ActionHost, type Target } from "@/components/account-actions";
import { LastSeen, OriginBadge, PlanBadge, StatusBadge, UsageBar } from "@/components/badges";
import { Empty, PageHeader, Pager, SectionError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { api, downloadAccountsCsv } from "@/lib/api";
import { useSearchBox, useUrlState } from "@/lib/url-state";
import { ACCESS_LABEL, ORIGIN_LABEL, PLAN_LABEL, SIGNAL_LABEL, SORTS } from "@/lib/labels";
import type { AccountRow } from "@/lib/types";
import { fmtDate, nomeDaConta } from "@/lib/utils";

const PAGE_SIZE = 25;

export function AccountsPage() {
  const url = useUrlState();
  const { get, set } = url;
  const [text, setText] = useSearchBox(url);
  const [, setSp] = useSearchParams();
  const [target, setTarget] = useState<Target>(null);
  const clear = () => { setText(""); setSp({}, { replace: true }); };

  const filters = { q: get("q"), access: get("access"), signal: get("signal"), plan: get("plan"), origin: get("origin"), sort: get("sort") || "created_desc", page: Number(get("page")) || 1, page_size: PAGE_SIZE };
  const q = useQuery({ queryKey: ["accounts", filters], queryFn: () => api.accounts(filters), placeholderData: keepPreviousData });
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try { await downloadAccountsCsv(filters); toast.success("CSV exportado."); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível exportar."); }
    finally { setExporting(false); }
  };
  const active = ["q", "access", "signal", "plan", "origin"].some((k) => get(k));
  const items = q.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Contas" subtitle={q.data ? `${q.data.total.toLocaleString("pt-BR")} ${q.data.total === 1 ? "conta" : "contas"}` : "Busque, filtre e aja rápido."} actions={<Button variant="outline" onClick={() => void exportCsv()} disabled={exporting}><Download />{exporting ? "Exportando…" : "Exportar CSV"}</Button>} />
      <Card className="p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Buscar por e-mail, nome ou telefone" placeholder="Buscar por e-mail, nome ou telefone" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <Select aria-label="Acesso" value={get("access")} onChange={(e) => set({ access: e.target.value })}><option value="">Acesso</option>{Object.entries(ACCESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Plano" value={get("plan")} onChange={(e) => set({ plan: e.target.value })}><option value="">Plano</option>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Origem" value={get("origin")} onChange={(e) => set({ origin: e.target.value })}><option value="">Origem</option>{Object.entries(ORIGIN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select aria-label="Ordenar por" value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>{SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </div>
        {get("signal") && (
          <div className="mt-2 flex items-center gap-2 text-sm" data-testid="signal-chip">
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-accent px-3 font-medium">Sinal: {SIGNAL_LABEL[get("signal")] ?? get("signal")}
              <button type="button" aria-label="Limpar sinal" className="grid size-6 place-items-center rounded-full hover:bg-background" onClick={() => set({ signal: "" })}><X className="size-3.5" /></button>
            </span>
          </div>
        )}
        {active && <Button variant="ghost" size="sm" className="mt-2" onClick={clear}><X />Limpar filtros</Button>}
      </Card>

      <Card className={q.isFetching && q.data ? "opacity-70 transition-opacity" : "transition-opacity"}>
        {q.isError ? <SectionError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton /> : items.length === 0 ? (
          <Empty title="Nenhuma conta encontrada" hint={active ? "Tente remover algum filtro ou buscar por outro termo." : "Quando alguém se cadastrar, aparece aqui."} action={active ? <Button variant="outline" size="sm" onClick={clear}>Limpar filtros</Button> : undefined} />
        ) : (
          <>
            <ul className="divide-y md:hidden">{items.map((a) => <MobileRow key={a.user_id} a={a} onAction={(kind) => setTarget({ kind, row: a })} />)}</ul>
            <div className="hidden md:block">
              <Table>
                <THead><tr><TH>Conta</TH><TH>Plano</TH><TH>Status</TH><TH>Origem</TH><TH>IA no mês</TH><TH>WhatsApp</TH><TH>Versão do app</TH><TH>Último uso</TH><TH className="w-12"><span className="sr-only">Ações</span></TH></tr></THead>
                <tbody>{items.map((a) => (
                  <TR key={a.user_id}>
                    <TD className="max-w-[280px]"><Link to={`/contas/${a.user_id}`} className="block truncate font-semibold hover:underline">{nomeDaConta(a)}</Link><p className="truncate text-xs text-muted-foreground">{a.name ?? "Sem nome"} · desde {fmtDate(a.created_at)}</p></TD>
                    <TD><PlanBadge plan={a.plan} /></TD>
                    <TD><StatusBadge a={a} /></TD>
                    <TD><OriginBadge origin={a.origin} /></TD>
                    <TD><UsageBar used={a.ai_used} max={a.ai_max} label="Uso de IA no mês" /></TD>
                    <TD><UsageBar used={a.wa_used} max={a.wa_max} label="Respostas de WhatsApp no mês" /></TD>
                    <TD><span className="text-sm tabular-nums" data-testid="app-version">{a.last_app_version ?? "—"}</span></TD>
                    <TD><LastSeen iso={a.last_seen_at} /></TD>
                    <TD><AccountMenu row={a} withOpen onAction={(kind) => setTarget({ kind, row: a })} /></TD>
                  </TR>
                ))}</tbody>
              </Table>
            </div>
            <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} />
          </>
        )}
      </Card>
      <ActionHost target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function MobileRow({ a, onAction }: { a: AccountRow; onAction: (k: Parameters<typeof AccountMenu>[0]["onAction"] extends (k: infer K) => void ? K : never) => void }) {
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/contas/${a.user_id}`} className="min-w-0 flex-1">
          <p className="truncate font-semibold">{nomeDaConta(a)}</p>
          <p className="truncate text-xs text-muted-foreground">{a.name ?? "Sem nome"} · desde {fmtDate(a.created_at)}</p>
        </Link>
        <AccountMenu row={a} withOpen onAction={onAction} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><PlanBadge plan={a.plan} /><StatusBadge a={a} /><OriginBadge origin={a.origin} /></div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IA no mês</p><UsageBar used={a.ai_used} max={a.ai_max} label="Uso de IA no mês" /></div>
        <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">WhatsApp</p><UsageBar used={a.wa_used} max={a.wa_max} label="Respostas de WhatsApp no mês" /></div>
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">App {a.last_app_version ?? "—"} · último uso: <LastSeen iso={a.last_seen_at} /></p>
    </li>
  );
}

function ListSkeleton() {
  return <div aria-busy className="divide-y">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center gap-4 p-4"><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div><Skeleton className="hidden h-6 w-16 md:block" /><Skeleton className="hidden h-6 w-24 md:block" /><Skeleton className="h-8 w-20" /></div>)}</div>;
}
