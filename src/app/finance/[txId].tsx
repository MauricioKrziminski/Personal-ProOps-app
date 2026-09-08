import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import { currentMonth, monthTitle } from '@/components/finance/month-picker';
import { Card } from '@/components/ui/card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HeaderActions, HeaderMenu } from '@/components/ui/header-actions';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useDeleteTransaction,
  useInvoice,
  useMarkPaid,
  useDeleteInstallmentPlan,
  useInstallmentPlans,
  useSaveTransaction,
  useTransaction,
  type Transaction,
} from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Lançamento (detalhe) — a tela que faltava.
 *
 * Até aqui, tocar num lançamento abria direto o formulário de edição: para **ler** era preciso
 * entrar na tela que altera. Este detalhe mostra o que o app já coletava e nunca exibia
 * (`merchant`, `invoice_id`, `installment_no`, o parse da IA) e deixa a edição a um toque.
 */

const SOURCE_LABEL: Record<Transaction['source'], string> = {
  whatsapp: 'via WhatsApp',
  app: 'criado no app',
  import: 'importado de extrato',
  recurring: 'gerado por recorrência',
};

const SOURCE_ICON: Record<Transaction['source'], SymbolViewProps['name']> = {
  whatsapp: 'bubble.left',
  app: 'iphone',
  import: 'square.and.arrow.down',
  recurring: 'arrow.triangle.2.circlepath',
};

const KIND_LABEL: Record<Transaction['kind'], string> = {
  expense: 'Despesa',
  income: 'Receita',
  transfer: 'Transferência',
};

/** `2026-08-23` → `23 de agosto de 2026`. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function TransactionDetailScreen() {
  const toast = useToast();
  const params = useLocalSearchParams<{ txId: string; month?: string }>();
  const txId = params.txId;
  // O mês só serve para voltar ao formulário no contexto certo.
  const month = params.month ?? currentMonth();

  // Busca por ID, não dentro da lista do mês. Procurar na lista fazia lançamento
  // antigo — ou além do `limit(200)` do mês — cair em "não existe mais", que é a
  // mesma tela de um registro apagado de verdade.
  const list = useTransaction(txId);
  const tx = list.data;

  const accounts = useAccounts();
  const invoice = useInvoice(tx?.invoice_id ?? undefined);
  const plans = useInstallmentPlans();
  const plano = (plans.data ?? []).find((p) => p.id === tx?.installment_plan_id);
  const removePlan = useDeleteInstallmentPlan();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const markPaid = useMarkPaid();

  const accountLabel = tx?.account_id
    ? ((accounts.data ?? []).find((a) => a.id === tx.account_id)?.name ?? null)
    : null;

  /** Reenvia o lançamento inteiro: o hook faz `update` com os campos que recebe. */
  const patch = (changes: Partial<{ category: string | null }>) => {
    if (!tx) return;
    save.mutate(
      {
        id: tx.id,
        kind: tx.kind,
        amount_cents: tx.amount_cents,
        category: tx.category,
        description: tx.description,
        account_id: tx.account_id,
        counterparty_account_id: tx.counterparty_account_id,
        occurred_at: tx.occurred_at,
        ...changes,
      },
      {
        onSuccess: () => toast({ message: 'Pronto, atualizei.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para salvar. Tenta de novo.', tone: 'error' }),
      }
    );
  };

  const duplicate = () => {
    if (!tx) return;
    save.mutate(
      {
        kind: tx.kind,
        amount_cents: tx.amount_cents,
        category: tx.category,
        description: tx.description,
        account_id: tx.account_id,
        counterparty_account_id: tx.counterparty_account_id,
        occurred_at: localISODate(),
      },
      {
        onSuccess: () => toast({ message: 'Dupliquei para hoje.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para duplicar. Tenta de novo.', tone: 'error' }),
      }
    );
  };

  /**
   * Apagar a compra parcelada INTEIRA.
   *
   * Cancelar uma compra em 12x significava apagar doze lançamentos um por um,
   * navegando doze meses. Aqui é um `delete` no plano e o cascade leva as
   * parcelas.
   *
   * Não existe "Desfazer" — o cascade não volta —, então a confirmação nomeia o
   * estrago inteiro: quantas parcelas e quanto dinheiro.
   */
  const confirmDeletePlan = () => {
    if (!tx?.installment_plan_id) return;
    const planId = tx.installment_plan_id;
    const quantas = plano?.installments ?? tx.installment_no ?? 0;
    const nome = plano?.title ?? tx.description ?? 'esta compra';
    confirmDestructive(
      'Apagar a compra parcelada inteira?',
      'Apagar tudo',
      () =>
        removePlan.mutate(planId, {
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${nome} e as parcelas.`, tone: 'success' });
          },
          onError: () =>
            toast({ message: 'Não deu para apagar a compra. Tenta de novo.', tone: 'error' }),
        }),
      `Some ${quantas > 0 ? `${quantas} parcelas` : 'todas as parcelas'}${plano ? `, ${formatBRL(plano.total_cents)} no total` : ''} — de todos os meses. Isso não volta.`,
    );
  };

  /** Apagar é action sheet nativo, e a mensagem diz o que some. */
  const confirmDelete = () => {
    if (!tx) return;
    const what = `${formatBRL(tx.amount_cents)}${tx.category ? ` em ${tx.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(tx.id, {
          // `back` antes da invalidação: senão a tela repinta sem a transação e pisca "não existe".
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${what}.`, tone: 'success' });
          },
          onError: () => toast({ message: 'Não deu para apagar. Tenta de novo.', tone: 'error' }),
        }),
      `${what}. Isso não volta.`
    );
  };

  if (list.isLoading) {
    return (
      <Screen grouped>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <View style={styles.heroSkeleton}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="70%" height={46} />
        </View>
        <SkeletonRow />
        <SkeletonRow />
        <Skeleton height={120} radius={Radius.md} />
      </Screen>
    );
  }

  if (list.isError) {
    return (
      <Screen grouped>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <ErrorCard onRetry={list.refetch} />
      </Screen>
    );
  }

  if (!tx) {
    return (
      <Screen grouped>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <EmptyState
          icon="questionmark.folder"
          title="Esse lançamento não existe mais"
          hint="Ele pode ter sido apagado em outro aparelho."
          action={{ label: 'Voltar', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  const title = tx.description || tx.merchant || tx.category || 'Lançamento';
  const created = tx.created_at.slice(0, 10);
  const signedAmount = tx.kind === 'expense' ? -tx.amount_cents : tx.amount_cents;

  return (
    <Screen grouped>
      <Stack.Screen options={{ title }} />

      {/*
        As ações do header saem de UM array, nos dois sistemas. Antes elas eram escritas duas
        vezes nesta tela — como `Stack.Toolbar` (iOS) e como `androidOverflow` — e o
        `Platform.OS === 'ios' ? ... : null` em volta do toolbar era o sintoma.
      */}
      <HeaderActions
        actions={[
          {
            label: 'Editar',
            onPress: () =>
              router.push({ pathname: '/finance/transaction-form', params: { id: tx.id, month } }),
          },
        ]}
      />
      <HeaderMenu
        title="Lançamento"
        actions={[
          {
            label: 'Mudar categoria',
            icon: 'tag',
            actions: SUGGESTED_CATEGORIES.map((option) => ({
              label: option,
              selected: tx.category === option,
              onPress: () => patch({ category: option }),
            })),
          },
          { label: 'Duplicar', icon: 'plus.square.on.square', onPress: duplicate },
          {
            label: tx.installment_plan_id ? 'Apagar só esta parcela' : 'Apagar',
            icon: 'trash',
            destructive: true,
            onPress: confirmDelete,
          },
          ...(tx.installment_plan_id
            ? [
                {
                  label: 'Apagar a compra inteira',
                  icon: 'trash' as const,
                  destructive: true,
                  onPress: confirmDeletePlan,
                },
              ]
            : []),
        ]}
      />

      {/* O único destaque: é o que a pessoa veio conferir em três segundos. */}
      <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
        <Card style={styles.hero}>
          <HeroLabel accessibilityLabel={`${KIND_LABEL[tx.kind]} de ${formatBRL(tx.amount_cents)}`}>
            {KIND_LABEL[tx.kind]}
          </HeroLabel>
          <Money
            cents={signedAmount}
            variant="money"
            tone={tx.kind === 'income' ? 'success' : tx.kind === 'transfer' ? 'textSecondary' : 'text'}
            signed={tx.kind !== 'transfer'}
          />
          <ThemedText type="small" themeColor="textSecondary" style={tabular}>
            {[longDate(tx.occurred_at), tx.category, accountLabel].filter(Boolean).join(' · ')}
          </ThemedText>
        </Card>
      </Animated.View>

      {/* Previsto: a única faixa de status. `cleared` não precisa de rótulo. */}
      {tx.status === 'pending' ? (
        <Section title="Ainda não aconteceu">
          <Row
            title={tx.due_at ? `Vence em ${formatDateBR(tx.due_at)}` : 'Sem data de vencimento'}
            subtitle="Marque quando pagar para sair da projeção"
            icon="clock"
            trailing={
              <Button
                label="Paguei"
                size="sm"
                variant="secondary"
                loading={markPaid.isPending}
                onPress={() =>
                  markPaid.mutate(
                    { id: tx.id, paidAt: localISODate() },
                    {
                      // A baixa move `occurred_at` para hoje: se o lançamento era de outro mês,
                      // ficar aqui mostraria "esse lançamento não existe mais" logo após dar certo.
                      onSuccess: () => {
                        router.back();
                        toast({ message: 'Dei baixa.', tone: 'success' });
                      },
                      onError: () =>
                        toast({ message: 'Não deu para dar baixa. Tenta de novo.', tone: 'error' }),
                    }
                  )
                }
              />
            }
          />
        </Section>
      ) : null}

      <Section title="Como isso entrou">
        <Row title={SOURCE_LABEL[tx.source]} subtitle="Origem" icon={SOURCE_ICON[tx.source]} />
        {tx.merchant ? <Row title={tx.merchant} subtitle="Estabelecimento" icon="storefront" /> : null}
        {created !== tx.occurred_at ? (
          <Row title={formatDateBR(created)} subtitle="Registrado em" icon="calendar" />
        ) : null}
      </Section>

      {(tx.invoice_id || tx.installment_plan_id) && (
        <Section title="Faz parte de">
          {tx.invoice_id ? (
            <Row
              title={
                invoice.data
                  ? `Fatura de ${monthTitle(invoice.data.invoice.reference_month.slice(0, 7))}`
                  : 'Fatura do cartão'
              }
              subtitle={
                invoice.data ? `vence ${formatDateBR(invoice.data.invoice.due_date)}` : 'Ver fatura'
              }
              icon="creditcard"
              accessibilityLabel="Ver a fatura em que essa compra caiu"
              onPress={() =>
                router.push({ pathname: '/finance/invoice/[id]', params: { id: tx.invoice_id! } })
              }
            />
          ) : null}
          {tx.installment_plan_id ? (
            <Row
              title={
                tx.installment_no && plano
                  ? `Parcela ${tx.installment_no} de ${plano.installments}`
                  : tx.installment_no
                    ? `Parcela ${tx.installment_no}`
                    : 'Compra parcelada'
              }
              subtitle={
                plano
                  ? `${formatBRL(plano.total_cents)} no total · ver todas as parcelas`
                  : 'Ver todas as parcelas'
              }
              icon="rectangle.split.3x1"
              accessibilityLabel="Ver a compra parcelada inteira"
              onPress={() => router.push('/finance/installments')}
            />
          ) : null}
        </Section>
      )}

      {/* Comprovante: honesto sobre o que ainda não existe, em vez de um botão que não faz nada. */}
      <Section title="Comprovante">
        <Row
          title="Nenhum comprovante guardado"
          subtitle="Anexo ainda não é salvo pelo app nem pelo WhatsApp"
          icon="paperclip"
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  heroSkeleton: {
    gap: Space.md,
  },
});
