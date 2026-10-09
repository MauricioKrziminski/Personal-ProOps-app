import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useSearchParams } from "react-router";
import { Empty, PageHeader, Pager, SectionError } from "@/components/states";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useSearchBox, useUrlState } from "@/lib/url-state";
import { BILLING_RESULT_LABEL, ORIGIN_LABEL } from "@/lib/labels";
import type { BillingEvent } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

const TYPES = ["INITIAL_PURCHASE", "RENEWAL", "CANCELLATION", "EXPIRATION", "BILLING_ISSUE", "PRODUCT_CHANGE", "UNCANCELLATION", "TEST"];
// Os valores que `public._apply_entitlement` grava (0035).
const RESULTS = ["concedido", "revogado", "duplicado", "sandbox_ignorado", "produto_desconhecido", "app_user_id_invalido", "workspace_nao_encontrado", "compra_ja_vinculada"];
const PROBLEMA = new Set(["produto_desconhecido", "app_user_id_invalido", "workspace_nao_encontrado", "compra_ja_vinculada"]);
export const resultTone = (r: string): Tone => (PROBLEMA.has(r) ? "danger" : r === "concedido" ? "success" : "warning");

export function BillingPage() {
  const url = useUrlState();
  const { get, set } = url;
  const [text, setText] = useSearchBox(url);
  const [, setSp] = useSearchParams();
  const f = { q: get("q"), type: get("type"), result: get("result"), page: Number(get("page")) || 1, page_size: 50 };
  const q = useQuery({ queryKey: ["billing", f], queryFn: () => api.billing(f), placeholderData: keepPreviousData });
  const active = f.q || f.type || f.result;
  const clear = () => { setText(""); setSp({}, { replace: true }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Cobrança" subtitle="Eventos recebidos da loja e do RevenueCat." />
      <Card className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-[1.6fr_1fr_1fr_auto]">
        <div className="relative col-span-2 sm:col-span-3 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Buscar por e-mail ou ID" placeholder="E-mail ou ID do usuário" className="pl-9" value={text} onChange={(e) => setText(e.target.value)} /></div>
        <Select aria-label="Tipo" value={f.type} onChange={(e) => set({ type: e.target.value })}><option value="">Tipo</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
        <Select aria-label="Resultado" value={f.result} onChange={(e) => set({ result: e.target.value })}><option value="">Resultado</option>{RESULTS.map((r) => <option key={r} value={r}>{BILLING_RESULT_LABEL[r]}</option>)}</Select>
        {active && <Button variant="ghost" onClick={clear}><X />Limpar</Button>}
      </Card>
      <Card className={q.isFetching && q.data ? "opacity-70 transition-opacity" : "transition-opacity"}>
        {q.isError ? <SectionError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? (
          <div aria-busy className="divide-y">{Array.from({ length: 8 }, (_, i) => <div key={i} className="space-y-2 p-4"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>)}</div>
        ) : q.data.items.length === 0 ? <Empty title="Nenhum evento" hint={active ? "Nenhum evento bate com esses filtros." : "Quando a loja notificar uma compra, renovação ou cancelamento, aparece aqui."} /> : (
          <>
            <ul className="divide-y md:hidden">{q.data.items.map((e) => <MobileEvent key={e.id} e={e} />)}</ul>
            <div className="hidden md:block">
              <Table>
                <THead><tr><TH>Quando</TH><TH>Tipo</TH><TH>Resultado</TH><TH>Conta</TH><TH>Produto</TH><TH>Origem</TH></tr></THead>
                <tbody>{q.data.items.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-muted-foreground">{fmtDate(e.created_at, true)}</TD>
                    <TD><code className="text-xs font-semibold">{e.type}</code></TD>
                    <TD><Badge tone={resultTone(e.result)}>{BILLING_RESULT_LABEL[e.result] ?? e.result}</Badge></TD>
                    <TD className="max-w-[260px] truncate" title={e.app_user_id ?? ""}>{e.email ?? e.app_user_id ?? "—"}</TD>
                    <TD className="text-muted-foreground">{e.product_id ?? "—"}</TD>
                    <TD><span className="text-muted-foreground">{e.provider ? ORIGIN_LABEL[e.provider] ?? e.provider : "—"}{e.environment === "sandbox" && <Badge className="ml-2" tone="warning">Teste</Badge>}</span></TD>
                  </TR>
                ))}</tbody>
              </Table>
            </div>
            <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} />
          </>
        )}
      </Card>
    </div>
  );
}

function MobileEvent({ e }: { e: BillingEvent }) {
  return (
    <li className="space-y-1.5 p-4">
      <div className="flex items-center justify-between gap-2"><code className="text-xs font-bold">{e.type}</code><Badge tone={resultTone(e.result)}>{BILLING_RESULT_LABEL[e.result] ?? e.result}</Badge></div>
      <p className="truncate text-sm">{e.email ?? e.app_user_id ?? "—"}</p>
      <p className="text-xs text-muted-foreground">{fmtDate(e.created_at, true)} · {e.product_id ?? "sem produto"}{e.provider ? ` · ${ORIGIN_LABEL[e.provider] ?? e.provider}` : ""}{e.environment === "sandbox" ? " · teste" : ""}</p>
    </li>
  );
}
