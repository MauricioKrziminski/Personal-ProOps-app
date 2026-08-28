import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ErrorCard } from '@/components/error-card';
import { currentMonth, monthTitle } from '@/components/finance/month-picker';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useAiEvents,
  useDeleteTransaction,
  useInvoice,
  useMarkPaid,
  useSaveTransaction,
  useTransactions,
  useUndoAiEvent,
  type AiActionSummary,
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

/** Confiança nunca é só cor: vira número E palavra. */
function confidenceWord(value: number): string {
  return value >= 0.8 ? 'alta' : value >= 0.6 ? 'média' : 'baixa';
}

function describeAction(action: AiActionSummary): string {
  const what = action.content ?? action.title ?? action.category ?? action.type;
  return action.amount_cents ? `${what} — ${formatBRL(action.amount_cents)}` : what;
}

export default function TransactionDetailScreen() {
  const toast = useToast();
  const params = useLocalSearchParams<{ txId: string; month?: string }>();
  const txId = params.txId;
  // Sem `useTransaction(id)` no projeto, o detalhe reaproveita a query do mês (mesma queryKey,
  // então normalmente é acerto de cache). O mês vem por parâmetro de quem navegou.
  const month = params.month ?? currentMonth();

  const list = useTransactions({ month });
  const tx = useMemo(() => (list.data ?? []).find((t) => t.id === txId), [list.data, txId]);

  const accounts = useAccounts();
  const invoice = useInvoice(tx?.invoice_id ?? undefined);
  // `ai_event_for_transaction` não existe: varremos os eventos recentes procurando o id.
  const aiEvents = useAiEvents(50);
  const aiEvent = useMemo(
    () => (aiEvents.data ?? []).find((e) => (e.created_transaction_ids ?? []).includes(txId)),
    [aiEvents.data, txId]
  );

  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const markPaid = useMarkPaid();
  const undo = useUndoAiEvent();

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
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          onPress={() =>
            router.push({ pathname: '/finance/transaction-form', params: { id: tx.id, month } })
          }>
          Editar
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Mais opções">
          <Stack.Toolbar.Menu title="Mudar categoria" icon="tag">
            {SUGGESTED_CATEGORIES.map((option) => (
              <Stack.Toolbar.MenuAction
                key={option}
                isOn={tx.category === option}
                onPress={() => patch({ category: option })}>
                {option}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
          <Stack.Toolbar.MenuAction icon="plus.square.on.square" onPress={duplicate}>
            Duplicar
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={confirmDelete}>
            Apagar
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      {/* O único GlassCard: é o que a pessoa veio conferir em três segundos. */}
      <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
        <GlassCard style={styles.hero}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            accessibilityLabel={`${KIND_LABEL[tx.kind]} de ${formatBRL(tx.amount_cents)}`}>
            {KIND_LABEL[tx.kind]}
          </ThemedText>
          <Money
            cents={signedAmount}
            variant="money"
            tone={tx.kind === 'income' ? 'success' : tx.kind === 'transfer' ? 'textSecondary' : 'text'}
            signed={tx.kind !== 'transfer'}
          />
          <ThemedText type="small" themeColor="textSecondary" style={tabular}>
            {[longDate(tx.occurred_at), tx.category, accountLabel].filter(Boolean).join(' · ')}
          </ThemedText>
        </GlassCard>
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
                      onSuccess: () => toast({ message: 'Dei baixa.', tone: 'success' }),
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

      {/* Só faz sentido para o que veio do WhatsApp. */}
      {tx.source === 'whatsapp' ? (
        aiEvents.isError ? (
          <Section title="O que a IA entendeu">
            <Row
              title="Não deu para carregar o que a IA entendeu"
              subtitle="O resto do lançamento continua válido"
              icon="exclamationmark.triangle"
              onPress={() => aiEvents.refetch()}
            />
          </Section>
        ) : aiEvent ? (
          <Section title="O que a IA entendeu">
            <Row
              title={`Confiança ${confidenceWord(aiEvent.confidence ?? 0)} — ${Math.round((aiEvent.confidence ?? 0) * 100)}%`}
              subtitle={aiEvent.model ?? undefined}
              icon="sparkles"
            />
            {aiEvent.actions.map((action, i) => (
              <Row key={`${aiEvent.id}-${i}`} title={describeAction(action)} subtitle="Ação gerada" icon="text.quote" />
            ))}
            <Row
              title="Desfazer o que essa mensagem criou"
              icon="arrow.uturn.backward"
              destructive
              onPress={() =>
                undo.mutate(aiEvent.created_transaction_ids ?? [], {
                  onSuccess: () => {
                    router.back();
                    toast({ message: 'Desfeito.', tone: 'success' });
                  },
                  onError: () =>
                    toast({ message: 'Não deu para desfazer. Tenta de novo.', tone: 'error' }),
                })
              }
            />
          </Section>
        ) : null
      ) : null}

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
              title={tx.installment_no ? `Parcela ${tx.installment_no}` : 'Compra parcelada'}
              subtitle="As outras parcelas aparecem no mês de cada uma"
              icon="rectangle.split.3x1"
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
