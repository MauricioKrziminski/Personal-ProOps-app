import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { DatePickerField } from '@/components/finance/date-picker-field';
import { Button } from '@/components/ui/button';
import { Field, MoneyField } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { SwitchRow } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Forte } from '@/components/ui/forte';
import { Space } from '@/design/tokens';
import { useMarkPaid, useSaveTransactionScoped, useTransaction } from '@/hooks/use-finance';
import { formatBRL, localISODate } from '@/hooks/use-items';
import { planoDaBaixa } from '@/lib/confirmar-baixa';
import { brToISO, isValidBRDate, isoToBR } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';
import { settleDone, settleLabel } from '@/lib/settle-labels';

/**
 * O "Paguei"/"Recebi" que CONFIRMA o valor antes de dar baixa (25/09/2026).
 *
 * Pedido do dono do produto: *"às vezes eu posso ter pago menos ou mais em uma parcela, dívida
 * ou lançamento (fixo, parcelado, recorrente…)"*. Antes o botão dava baixa no valor previsto, e
 * corrigir depois era outra tela. Agora ele abre uma folha curta: quanto saiu (já no previsto),
 * quando, e — numa série, com valor diferente — "Usar este valor nas próximas". O mesmo valor é
 * um toque a mais e o mesmo resultado de antes.
 *
 * É HOOK que devolve a folha (não um componente): as quatro telas que dão baixa (Hoje,
 * Lançamentos, Projeção e o detalhe) abrem pelo `abrir(id)` e desenham `folha` no fim.
 * A folha lê o lançamento pelo id — valor, série, tipo —, então quem abre não precisa saber disso.
 *
 * A ordem é corrigir e SÓ ENTÃO dar a baixa: falhando a correção, nada é marcado como pago.
 */
export function useConfirmarBaixa({ aoConcluir }: { aoConcluir?: (id: string) => void } = {}) {
  const [id, setId] = useState<string | null>(null);
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(() => isoToBR(localISODate()));
  const [nasProximas, setNasProximas] = useState(false);
  const tx = useTransaction(id ?? undefined);
  const corrigir = useSaveTransactionScoped();
  const markPaid = useMarkPaid();
  const toast = useToast();

  const linha = id ? tx.data ?? null : null;
  const previsto = Number(linha?.amount_cents ?? 0);
  const pago = valor ?? previsto;
  const temSerie = Boolean(linha?.recurring_id || linha?.installment_plan_id);
  const titulo = linha?.description || linha?.merchant || linha?.category || 'Lançamento';
  const receita = linha?.kind === 'income';

  const abrir = (novo: string) => {
    setId(novo);
    setValor(null);
    setData(isoToBR(localISODate()));
    setNasProximas(false);
  };
  const fechar = () => setId(null);

  const confirmar = () => {
    if (!linha || pago <= 0) return;
    const plano = planoDaBaixa({ previsto, pago, temSerie, nasProximas });
    const paidAt = isValidBRDate(data) ? brToISO(data) : localISODate();
    const darBaixa = () =>
      markPaid.mutate(
        { id: linha.id, paidAt },
        {
          onSuccess: () => {
            fechar();
            toast({
              message: <><Forte>{titulo}</Forte>: {settleDone(linha.kind)}{plano.corrigir ? ` com ${formatBRL(pago)}` : ''}.</>,
              tone: 'success',
            });
            aoConcluir?.(linha.id);
          },
          onError: () => toast({ message: 'Não deu para dar baixa. Tenta de novo.', tone: 'error' }),
        }
      );
    if (!plano.corrigir) {
      darBaixa();
      return;
    }
    corrigir.mutate(
      { id: linha.id, scope: plano.corrigir.scope, patch: { amount_cents: plano.corrigir.amount_cents } },
      {
        onSuccess: darBaixa,
        onError: (error) =>
          toast({ message: financeErrorMessage(error, 'Não deu para corrigir o valor.'), tone: 'error' }),
      }
    );
  };

  const folha = (
    <Sheet visible={id !== null} onClose={fechar}>
      <TaskHeader
        title={titulo}
        onClose={fechar}
        action={
          <Button
            label={settleLabel(linha?.kind)}
            size="sm"
            loading={corrigir.isPending || markPaid.isPending}
            disabled={!linha || pago <= 0}
            onPress={confirmar}
          />
        }
      />
      {linha ? (
        <ScrollView contentContainerStyle={styles.corpo} keyboardShouldPersistTaps="handled">
          <Field
            label={receita ? 'Quanto entrou' : 'Quanto saiu'}
            hint={pago !== previsto ? `Previsto: ${formatBRL(previsto)}` : undefined}>
            <MoneyField valueCents={pago} onChangeCents={setValor} />
          </Field>
          {/* Só existe quando há o que propagar: numa série, com valor diferente do previsto. */}
          {temSerie && pago !== previsto ? (
            <SwitchRow label="Usar este valor nas próximas" value={nasProximas} onValueChange={setNasProximas} />
          ) : null}
          <Field label="Quando">
            <DatePickerField value={data} onChange={setData} accessibilityLabel="Data do pagamento" />
          </Field>
        </ScrollView>
      ) : null}
    </Sheet>
  );

  return { abrir, folha };
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
});
