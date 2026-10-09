import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSearchParams } from "react-router";
import { AuditRow } from "@/components/audit-list";
import { Empty, PageHeader, Pager, SectionError } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useUrlState } from "@/lib/url-state";
import { AUDIT_LABEL } from "@/lib/labels";

export function AuditPage() {
  const { get, set } = useUrlState();
  const [, setSp] = useSearchParams();
  const f = { action: get("action"), target_user_id: get("target_user_id"), page: Number(get("page")) || 1, page_size: 50 };
  const q = useQuery({ queryKey: ["audit", f], queryFn: () => api.audit(f), placeholderData: keepPreviousData });
  const active = f.action || f.target_user_id;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Auditoria" subtitle="Toda ação feita neste painel fica registrada aqui." />
      <Card className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[1fr_1.4fr_auto]">
        <Select aria-label="Ação" value={f.action} onChange={(e) => set({ action: e.target.value })}><option value="">Todas as ações</option>{Object.entries(AUDIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Input aria-label="ID da conta" placeholder="ID da conta (opcional)" value={f.target_user_id} onChange={(e) => set({ target_user_id: e.target.value.trim() })} />
        {active && <Button variant="ghost" onClick={() => setSp({}, { replace: true })}><X />Limpar</Button>}
      </Card>
      <Card className={q.isFetching && q.data ? "opacity-70 transition-opacity" : "transition-opacity"}>
        {q.isError ? <SectionError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? (
          <div aria-busy className="divide-y">{Array.from({ length: 7 }, (_, i) => <div key={i} className="space-y-2 p-5"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-2/3" /></div>)}</div>
        ) : q.data.items.length === 0 ? <Empty title="Nenhum registro" hint={active ? "Nenhuma ação bate com esses filtros." : "As ações feitas no painel aparecem aqui."} /> : (
          <>
            <div className="divide-y">{q.data.items.map((e) => <AuditRow key={e.id} e={e} />)}</div>
            <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} />
          </>
        )}
      </Card>
    </div>
  );
}
