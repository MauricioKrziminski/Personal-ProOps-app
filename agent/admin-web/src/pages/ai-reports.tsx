import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Empty, PageHeader, Pager, SectionError } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useUrlState } from "@/lib/url-state";
import { fmtDate } from "@/lib/utils";

const MOTIVO: Record<string, string> = { ofensiva: "Ofensiva ou inadequada", errada: "Informação errada", outra: "Outro motivo" };

export function AiReportsPage() {
  const { get, set } = useUrlState();
  const f = { reason: get("reason"), page: Number(get("page")) || 1, page_size: 25 };
  const q = useQuery({ queryKey: ["ai-reports", f], queryFn: () => api.aiReports(f), placeholderData: keepPreviousData });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Relatos de IA" subtitle="Respostas do Agente que as pessoas reportaram no app. O texto é a cópia guardada na hora do relato." />
      <Card className="p-3 sm:p-4">
        <Select aria-label="Motivo" value={f.reason} onChange={(e) => set({ reason: e.target.value })}>
          <option value="">Todos os motivos</option>
          {Object.entries(MOTIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Card>
      <Card className={q.isFetching && q.data ? "opacity-70 transition-opacity" : "transition-opacity"}>
        {q.isError ? <SectionError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? (
          <div aria-busy className="divide-y">{Array.from({ length: 5 }, (_, i) => <div key={i} className="space-y-2 p-5"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-2/3" /></div>)}</div>
        ) : q.data.items.length === 0 ? <Empty title="Nenhum relato" hint="Quando alguém reportar uma resposta, ela aparece aqui." /> : (
          <>
            <div className="divide-y">
              {q.data.items.map((r) => (
                <div key={r.id} className="space-y-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{MOTIVO[r.reason] ?? r.reason}</Badge>
                    <span className="text-muted-foreground">{fmtDate(r.created_at, true)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="min-w-0 truncate font-medium">{r.email ?? "conta apagada"}</span>
                  </div>
                  {r.note && <p className="text-sm"><span className="font-semibold">Nota: </span>{r.note}</p>}
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{r.content}</p>
                </div>
              ))}
            </div>
            <Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0 }); }} />
          </>
        )}
      </Card>
    </div>
  );
}
