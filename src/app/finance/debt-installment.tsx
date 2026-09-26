import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Note } from '@/components/ui/note';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Space, tabular } from '@/design/tokens';
import { DEBT_KINDS, useDebtPayments, useDebtSchedule, useDebts } from '@/hooks/use-finance';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { isoToBR } from '@/lib/dates';
import { paidInstallments, secoesDaLinha } from '@/lib/debt-history';
import { aoVoltarParaDivida } from '@/lib/volta-da-parcela';

/**
 * Uma parcela da dívida (25/09/2026, *"se eu clicar em qualquer uma dessas parcelas, tem que abrir
 * os detalhes dela"*). Chega pela linha do tempo da ficha; a paga COM lançamento vai direto para o
 * lançamento, então aqui ficam a futura, a próxima e a só contada.
 *
 * A parcela sai da MESMA conta da ficha (`paidInstallments` + `secoesDaLinha` sobre o cronograma
 * do banco) — uma segunda aritmética de parcela divergiria da linha que a pessoa acabou de tocar.
 * Pagar é em ordem (o banco recusa fora dela), por isso só a próxima tem "Paguei esta parcela", que
 * volta para a ficha já no pagamento.
 */
export default function DebtInstallmentScreen() {
  const params = useLocalSearchParams<{ debt?: string; n?: string }>();
  const n = Number(params.n);
  const debts = useDebts();
  const schedule = useDebtSchedule(params.debt);
  const payments = useDebtPayments(params.debt);
  const pronta = useTelaPronta(debts, schedule, payments);

  const atualizar = () => Promise.all([debts.refetch(), schedule.refetch(), payments.refetch()]);
  const titulo = Number.isInteger(n) && n > 0 ? `${n}ª parcela` : 'Parcela';
  const cabecalho = <Stack.Screen options={{ title: titulo }} />;

  if (!pronta) {
    return (
      <Screen grouped onRefresh={atualizar}>
        {cabecalho}
        <View style={styles.hero}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="60%" height={40} />
        </View>
        <SkeletonRow />
        <SkeletonRow />
      </Screen>
    );
  }

  const falhou = debts.isError || schedule.isError || payments.isError;
  if (falhou) {
    return (
      <Screen grouped onRefresh={atualizar}>
        {cabecalho}
        <ErrorCard
          onRetry={() => {
            if (debts.isError) void debts.refetch();
            if (schedule.isError) void schedule.refetch();
            if (payments.isError) void payments.refetch();
          }}
        />
      </Screen>
    );
  }

  const divida = debts.data?.find((d) => d.id === params.debt);
  const futuras = schedule.data ?? [];
  const historico = divida
    ? paidInstallments({
        installmentsPaid: divida.installments_paid,
        installmentCents: Number(divida.installment_cents ?? futuras[0]?.payment_cents ?? 0),
        nextDueDate: futuras[0]?.due_date ?? null,
        payments: payments.data ?? [],
      })
    : [];
  const secoes = secoesDaLinha(historico, futuras);
  const item = [...secoes.aSeguir, ...secoes.pagas].find((i) => i.n === n);

  if (!divida || !item) {
    return (
      <Screen grouped onRefresh={atualizar}>
        {cabecalho}
        <EmptyState
          icon="questionmark.folder"
          title="Essa parcela não existe mais"
          hint="A dívida pode ter sido editada ou apagada."
          action={{ label: 'Voltar', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const linha = futuras.find((r) => r.installment_no === n);
  const juros = linha?.interest_cents == null ? null : Number(linha.interest_cents);
  const amortizacao = linha?.principal_cents == null ? null : Number(linha.principal_cents);
  const saldoDepois = linha ? Number(linha.balance_cents) : null;
  const estado =
    item.estado === 'proxima'
      ? 'A próxima'
      : item.estado === 'futura'
        ? 'A vencer'
        : item.estado === 'paga'
          ? 'Paga'
          : 'Paga antes do app';

  const pagar = () => {
    aoVoltarParaDivida({ divida: divida.id, acao: 'pagar', cents: item.cents });
    router.back();
  };

  return (
    <Screen grouped onRefresh={atualizar}>
      {cabecalho}

      <Card style={styles.hero}>
        <HeroLabel>{estado}</HeroLabel>
        <Money cents={item.cents} variant="money" />
        <ThemedText type="small" themeColor="textSecondary" style={tabular}>
          {item.estado === 'estimada' || item.estado === 'paga'
            ? `${item.estado === 'estimada' ? 'por volta de ' : ''}${isoToBR(item.iso)}`
            : `vence ${isoToBR(item.iso)}`}
        </ThemedText>
      </Card>

      {item.estado === 'proxima' ? <Button label="Paguei esta parcela" block onPress={pagar} /> : null}

      <Section>
        <Row
          title="Parcela"
          trailing={
            <ThemedText type="default" style={tabular}>
              {`${n} de ${divida.installments ?? '—'}`}
            </ThemedText>
          }
        />
        {juros != null && juros > 0 ? (
          <Row title="Juros" trailing={<Money cents={juros} variant="body" tone="textSecondary" />} />
        ) : null}
        {amortizacao != null && juros != null && juros > 0 ? (
          <Row title="Amortização" trailing={<Money cents={amortizacao} variant="body" />} />
        ) : null}
        {saldoDepois != null ? (
          <Row title="Saldo depois dela" trailing={<Money cents={saldoDepois} variant="body" />} />
        ) : null}
        <Row
          title="Faz parte de"
          subtitle={divida.name}
          icon={DEBT_KINDS.find((k) => k.value === divida.kind)?.icon ?? 'doc.text'}
          onPress={() => router.back()}
        />
      </Section>

      {item.estado === 'estimada' ? (
        <Note icon="info.circle">Conta como paga no contrato, sem lançamento no app.</Note>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Space.sm },
});
