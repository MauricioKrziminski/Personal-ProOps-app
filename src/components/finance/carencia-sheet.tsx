import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL } from '@/components/ui/conceal';
import { Field } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { type Debt } from '@/hooks/use-finance';
import { useDebtPause, useDebtPausePreview } from '@/hooks/use-pausas';
import { isoToBR } from '@/lib/dates';
import { financeErrorMessage } from '@/lib/finance-form';

const mesAno = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * "Pausar pagamentos…" de um financiamento: carência de N meses a partir de uma parcela. Com juros o
 * banco só aceita a próxima em aberto; sem juros, qualquer parcela ainda não paga.
 */
export function CarenciaSheet({ visivel, onClose, divida }: { visivel: boolean; onClose: () => void; divida: Debt }) {
  const toast = useToast();
  const brl = useBRL();
  const proximaEmAberto = divida.installments_paid + 1;
  const comJuros = divida.calculation_mode === 'amortized' && divida.interest_rate_monthly > 0;
  const [de, setDe] = useState(proximaEmAberto);
  const [meses, setMeses] = useState(1);
  const pausar = useDebtPause();
  const previa = useDebtPausePreview(visivel ? divida.id : null, de, meses);
  const p = previa.data && !previa.isFetching ? previa.data : null;
  const pendente = pausar.isPending;
  const pronto = Boolean(p) && !pendente;

  // Fechar no meio do envio perderia o aviso de erro (o retorno da mutação some com a folha).
  const fechar = () => { if (!pendente) onClose(); };
  const confirmar = () => {
    if (!pronto) return;
    pausar.mutate({ debtId: divida.id, fromNo: de, months: meses }, {
      onSuccess: () => { onClose(); toast({ message: 'Carência registrada.', tone: 'success' }); },
      onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para registrar a carência. Tenta de novo.'), tone: 'error' }),
    });
  };

  const linhas = p ? [
    p.next_before && p.next_after ? `Próxima parcela: ${isoToBR(p.next_before)} → ${isoToBR(p.next_after)}` : null,
    p.with_interest ? `Parcela: ${brl(p.installment_before)} → ${brl(p.installment_after)}` : null,
    p.with_interest ? `Saldo: ${brl(p.balance_before)} → ${brl(p.balance_after)}` : null,
    p.end_before && p.end_after ? `Termina em ${mesAno(p.end_before)} → ${mesAno(p.end_after)}` : null,
  ].filter((l): l is string => l != null) : [];

  return (
    <Sheet visible={visivel} onClose={fechar}>
      <TaskHeader
        title="Pausar pagamentos"
        onClose={fechar}
        action={<Button label="Confirmar" size="sm" loading={pendente} disabled={!pronto} onPress={confirmar} />}
      />
      <SheetScroll contentContainerStyle={styles.corpo}>
        <Field label="A partir da parcela" hint={comJuros ? 'Com juros, começa na próxima em aberto.' : undefined}>
          {comJuros ? (
            <ThemedText type="default" style={styles.fixo}>{`${proximaEmAberto}ª`}</ThemedText>
          ) : (
            <QuantityField value={de} min={proximaEmAberto} max={divida.installments ?? 600} onChange={setDe}
              accessibilityLabel="Parcela em que a carência começa" />
          )}
        </Field>
        <Field label="Meses">
          <QuantityField value={meses} min={1} max={24} onChange={setMeses} accessibilityLabel="Meses de carência" />
        </Field>
        {previa.isError ? (
          <ThemedText type="small" themeColor="danger">{financeErrorMessage(previa.error, 'Não deu para calcular a carência.')}</ThemedText>
        ) : p ? (
          linhas.map((l) => <ThemedText key={l} type="small" themeColor="textSecondary">{l}</ThemedText>)
        ) : <Skeleton height={40} />}
      </SheetScroll>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  fixo: { fontVariant: ['tabular-nums'] },
});
