import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { DatePickerField } from '@/components/finance/date-picker-field';
import { ErrorCard } from '@/components/error-card';
import { useBRL } from '@/components/ui/conceal';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Forte } from '@/components/ui/forte';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useEndRecurring, useEndRecurringPreview, useRecurringOccurrenceDates, type RecurringTransaction } from '@/hooks/use-finance';
import { brToISO, dataLocalDe, isoToBR, isValidBRDate, localISODate } from '@/lib/dates';
import { fraseDoEncerramento, ultimaCobrancaPadrao } from '@/lib/encerrar-serie';
import { financeErrorMessage } from '@/lib/finance-form';

/**
 * "Encerrar" uma série (F18, a assinatura cancelada): a folha pergunta a última cobrança — a mais
 * recente que já venceu, ou uma data — e MOSTRA o que fica e o que sai antes de a pessoa confirmar.
 * Não é Pausar (para de gerar, volta quando quiser) nem Apagar (leva a regra): a série fica em
 * "Encerradas", com o histórico, e reabrir é editar o fim.
 *
 * É HOOK que devolve a folha, como `useConfirmarBaixa`: a tela abre pelo `abrir(serie)` e desenha
 * `folha` no fim.
 */
export function useEncerrarSerie() {
  const [serie, setSerie] = useState<RecurringTransaction | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const toast = useToast();
  const brl = useBRL();
  const encerrar = useEndRecurring();

  const id = serie?.id ?? null;
  const datas = useRecurringOccurrenceDates(id);
  const inicioISO = serie?.dtstart ? dataLocalDe(serie.dtstart) : serie ? dataLocalDe(serie.next_run_at) : null;
  // Sem a escolha da pessoa, o padrão sai das ocorrências JÁ GERADAS (a mais recente que venceu).
  const padrao = ultimaCobrancaPadrao(datas.data ?? [], localISODate(), inicioISO);
  const dataBR = escolhida ?? isoToBR(padrao);
  const dataOk = isValidBRDate(dataBR) && (!inicioISO || brToISO(dataBR) >= inicioISO);
  const ultima = dataOk ? brToISO(dataBR) : null;
  const previa = useEndRecurringPreview(datas.isSuccess ? id : null, ultima);

  const abrir = (nova: RecurringTransaction) => {
    setSerie(nova);
    setEscolhida(null);
  };
  const fechar = () => setSerie(null);

  const confirmar = () => {
    if (!serie || !ultima || !previa.data) return;
    encerrar.mutate({ id: serie.id, lastDate: ultima }, {
      onSuccess: () => {
        fechar();
        toast({ message: <><Forte>{serie.description ?? 'Série'}</Forte> encerrada.</>, tone: 'success' });
      },
      onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para encerrar a série. Tenta de novo.'), tone: 'error' }),
    });
  };

  const folha = (
    <Sheet visible={serie !== null} onClose={fechar}>
      <TaskHeader
        title="Encerrar série"
        onClose={fechar}
        action={
          <Button
            label="Encerrar"
            size="sm"
            loading={encerrar.isPending}
            disabled={!previa.data || previa.isFetching || encerrar.isPending}
            onPress={confirmar}
          />
        }
      />
      {serie ? (
        <SheetScroll contentContainerStyle={styles.corpo}>
          <Field
            label="Última cobrança"
            error={!dataOk ? (inicioISO ? `Escolha uma data a partir de ${isoToBR(inicioISO)}` : 'Data inválida') : undefined}>
            <DatePickerField
              value={dataBR}
              onChange={setEscolhida}
              min={inicioISO ?? undefined}
              accessibilityLabel="Data da última cobrança da série"
              invalid={!dataOk}
            />
          </Field>
          {datas.isError || previa.isError ? (
            <ErrorCard onRetry={() => { void datas.refetch(); void previa.refetch(); }} />
          ) : previa.data && !previa.isFetching ? (
            <ThemedText type="small" themeColor="textSecondary">{fraseDoEncerramento(previa.data, brl)}</ThemedText>
          ) : dataOk ? (
            <Skeleton height={56} />
          ) : null}
        </SheetScroll>
      ) : null}
    </Sheet>
  );

  return { abrir, folha };
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
});
