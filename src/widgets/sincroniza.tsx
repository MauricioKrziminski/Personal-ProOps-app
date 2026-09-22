import { useEffect, useRef } from 'react';

import { useConceal } from '@/components/ui/conceal';
import { useCycle, useSpendable, useUpcomingBills } from '@/hooks/use-finance';
import { localISODate, timeBR } from '@/lib/dates';
import { montarRetrato, retratoSemSessao, type Retrato } from '@/lib/widget-snapshot';
import { publicarRetrato } from '@/widgets/publicar';

/** Publica só quando o CONTEÚDO muda — a hora do retrato não conta como mudança. */
function usePublicar() {
  const ultimo = useRef('');
  return (r: Retrato) => {
    const chave = JSON.stringify({ ...r, atualizado: '' });
    if (chave === ultimo.current) return;
    ultimo.current = chave;
    // Widget é vitrine: falhar em publicar nunca pode derrubar o app.
    publicarRetrato(r).catch(() => {});
  };
}

/**
 * Mantém os widgets em dia com os MESMOS dados da Hoje (`spendable`, `cycle_now`,
 * `upcoming_bills`) — as consultas são as mesmas chaves do TanStack, então o que a Hoje já
 * buscou não é buscado de novo, e o Realtime que atualiza a Hoje atualiza o widget.
 *
 * Sem sessão, publica o retrato NEUTRO: quem saiu da conta não deixa o dinheiro na tela de início.
 */
export function SincronizaWidgets({ temSessao, carregando }: { temSessao: boolean; carregando: boolean }) {
  if (carregando) return null;
  return temSessao ? <ComSessao /> : <SemSessao />;
}

function SemSessao() {
  const publicar = usePublicar();
  useEffect(() => {
    publicar(retratoSemSessao(timeBR(new Date())));
  }, [publicar]);
  return null;
}

function ComSessao() {
  const gasto = useSpendable();
  const ciclo = useCycle();
  const contas = useUpcomingBills(30);
  const { concealed, ready } = useConceal();
  const publicar = usePublicar();

  useEffect(() => {
    if (!ready || !gasto.isSuccess || !gasto.data || !contas.isSuccess) return;
    publicar(
      montarRetrato({
        spendable: gasto.data,
        cicloAte: ciclo.data?.ate ?? null,
        contas: contas.data ?? [],
        hoje: localISODate(),
        agora: timeBR(new Date()),
        oculto: concealed,
      }),
    );
  }, [ready, concealed, gasto.isSuccess, gasto.data, contas.isSuccess, contas.data, ciclo.data?.ate, publicar]);

  return null;
}
