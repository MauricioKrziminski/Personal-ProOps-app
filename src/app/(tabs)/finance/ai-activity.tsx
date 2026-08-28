import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL } from '@/hooks/use-items';
import { useAiEvents, useUndoAiEvent, type AiActionSummary } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** Rótulo em português de cada tipo de ação da IA. */
const ACTION_LABEL: Record<string, string> = {
  create_expense: '💸 registrou um gasto',
  create_income: '💰 registrou uma receita',
  create_transfer: '🔄 registrou uma transferência',
  create_installment_purchase: '💳 registrou uma compra parcelada',
  pay_invoice: '✅ deu baixa numa fatura',
  query_invoice: '💳 consultou o cartão',
  query_forecast: '🔮 consultou a projeção',
  simulate_purchase: '🧮 simulou uma compra',
  mark_paid: '✅ deu baixa numa conta',
  set_rule: '📌 criou uma regra',
  update_transaction: '✏️ corrigiu um lançamento',
  delete_item: '🗑️ apagou um item',
  create_note: '📝 salvou uma nota',
  create_reminder: '⏰ criou um lembrete',
  create_goal: '🎯 criou uma meta',
  goal_deposit: '🎯 registrou um aporte',
  query_balance: '💼 consultou o saldo',
  query_transactions: '📊 consultou gastos',
  query_budgets: '📉 consultou orçamentos',
  query_goals: '🎯 consultou metas',
  undo_last: '🗑️ desfez o último',
  unknown: '🤔 não entendeu',
};

function descreveAcao(action: AiActionSummary): string {
  const base = ACTION_LABEL[action.type] ?? action.type;
  const detalhe = [
    action.amount_cents ? formatBRL(action.amount_cents) : null,
    action.category ? `#${action.category}` : null,
    action.content ?? action.title,
  ]
    .filter(Boolean)
    .join(' · ');
  return detalhe ? `${base}: ${detalhe}` : base;
}

function quando(iso: string): string {
  const data = new Date(iso);
  const minutos = Math.round((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 60 * 24) return `há ${Math.round(minutos / 60)}h`;
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export default function AiActivityScreen() {
  const theme = useTheme();
  const { data: events, isLoading, isError, refetch } = useAiEvents();
  const undo = useUndoAiEvent();

  const confirmarUndo = (ids: string[]) => {
    Alert.alert(
      'Desfazer',
      `Apagar ${ids.length} ${ids.length === 1 ? 'lançamento criado' : 'lançamentos criados'} por esta mensagem?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desfazer',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            undo.mutate(ids);
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Atividade da IA" />

          <GlassCard style={styles.explicacao}>
            <ThemedText type="small" themeColor="textSecondary">
              Tudo que a IA entendeu das suas mensagens, com o quanto ela estava confiante. Se
              interpretou errado, dá para desfazer aqui — ou corrigir conversando: “muda o último
              pra 54”.
            </ThemedText>
          </GlassCard>

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(events ?? []).map((event, index) => {
            const confianca = event.confidence ?? 0;
            const corConfianca =
              confianca >= 0.8 ? theme.success : confianca >= 0.6 ? theme.warning : theme.danger;
            const podeDesfazer = (event.created_transaction_ids ?? []).length > 0;

            return (
              <Animated.View
                key={event.id}
                entering={FadeInDown.duration(400).delay(Math.min(index * 40, 400))}>
                <GlassCard style={styles.evento}>
                  <View style={styles.linha}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {quando(event.created_at)}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: corConfianca }}>
                      {Math.round(confianca * 100)}% de confiança
                    </ThemedText>
                  </View>

                  {event.actions.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Nenhuma ação gerada.
                    </ThemedText>
                  )}
                  {event.actions.map((action, i) => (
                    <ThemedText key={`${event.id}-${i}`} type="small">
                      {descreveAcao(action)}
                    </ThemedText>
                  ))}

                  {event.error && (
                    <ThemedText type="small" themeColor="danger">
                      ⚠️ {event.error}
                    </ThemedText>
                  )}

                  <View style={styles.linha}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {event.model} · {(event.input_tokens ?? 0) + (event.output_tokens ?? 0)} tokens
                    </ThemedText>
                    {podeDesfazer && (
                      <Pressable
                        hitSlop={8}
                        disabled={undo.isPending}
                        onPress={() => confirmarUndo(event.created_transaction_ids ?? [])}
                        style={({ pressed }) => [
                          styles.desfazer,
                          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
                        ]}>
                        <ThemedText type="small" style={{ color: theme.danger }}>
                          desfazer
                        </ThemedText>
                      </Pressable>
                    )}
                  </View>
                </GlassCard>
              </Animated.View>
            );
          })}

          {!isLoading && !isError && (events ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🤖</ThemedText>
              <ThemedText type="smallBold">Nada por aqui ainda</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Manda uma mensagem no WhatsApp{'\n'}e ela aparece aqui na hora.
              </ThemedText>
            </GlassCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  explicacao: {
    gap: Spacing.two,
  },
  evento: {
    gap: Spacing.one,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  desfazer: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  centered: {
    textAlign: 'center',
  },
});
