import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Empty, PageHeader, Section, SectionError } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn, duration, fmtDate, num, relTime, usd } from "@/lib/utils";

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) => (
  <div className="px-3 py-2">
    <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
    <dd className={cn("mt-1 text-2xl font-extrabold tracking-tight tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-warning")}>{value}</dd>
  </div>
);

export function SystemPage() {
  const q = useQuery({ queryKey: ["system"], queryFn: api.system, refetchInterval: 30_000 });
  const d = q.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Sistema" subtitle="Fila do WhatsApp, falhas e custo de IA. Atualiza a cada 30 segundos." actions={<Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} />Atualizar</Button>} />
      {q.isError ? <Section title="Estado"><SectionError error={q.error} onRetry={() => void q.refetch()} /></Section> : !d ? (
        <div className="grid gap-5" aria-busy><Skeleton className="h-36 rounded-lg" /><Skeleton className="h-28 rounded-lg" /><Skeleton className="h-52 rounded-lg" /></div>
      ) : (
        <>
          <Section title="Fila do WhatsApp" aside={d.queue.failed_24h === 0 && d.queue.oldest_pending_seconds < 120 ? <Badge tone="success"><CheckCircle2 />Saudável</Badge> : <Badge tone="warning">Atenção</Badge>}>
            <dl className="grid grid-cols-2 gap-px p-3 lg:grid-cols-4">
              <Stat label="Aguardando" value={num(d.queue.pending)} />
              <Stat label="Processando" value={num(d.queue.processing)} />
              <Stat label="Falhas em 24 h" value={num(d.queue.failed_24h)} tone={d.queue.failed_24h ? "bad" : undefined} />
              <Stat label="Mais antiga na fila" value={d.queue.pending ? duration(d.queue.oldest_pending_seconds) : "—"} tone={d.queue.oldest_pending_seconds >= 120 ? "warn" : undefined} />
            </dl>
          </Section>
          <div className="grid gap-5 md:grid-cols-2">
            <Section title="Custo de IA"><dl className="grid grid-cols-2 gap-px p-3"><Stat label="Últimas 24 h" value={usd(d.ai_cost.last_24h_usd)} /><Stat label="Últimos 7 dias" value={usd(d.ai_cost.last_7d_usd)} /></dl></Section>
            <Section title="WhatsApp no mês"><dl className="grid grid-cols-2 gap-px p-3"><Stat label="Respostas" value={num(d.whatsapp_month.replies)} /><Stat label="Avisos" value={num(d.whatsapp_month.notices)} /></dl></Section>
          </div>
          <Section title="Falhas recentes">
            {d.recent_failures.length === 0 ? <Empty title="Nenhuma falha recente" hint="Mensagens com erro aparecem aqui, sem o texto da pessoa." /> : (
              <ul className="divide-y p-1">{d.recent_failures.map((f, i) => (
                <li key={i} className="space-y-1.5 px-4 py-3.5">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="danger">{f.status}</Badge><span className="text-xs text-muted-foreground" title={fmtDate(f.created_at, true)}>{relTime(f.created_at)} · {fmtDate(f.created_at, true)}</span></div>
                  <p className="break-words font-mono text-[13px] leading-snug">{f.last_error}</p>
                </li>
              ))}</ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
