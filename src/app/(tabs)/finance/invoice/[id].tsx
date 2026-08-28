import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { useAccounts, useInvoice, usePayInvoice } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

const STATUS_LABEL: Record<string, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
};

export default function InvoiceScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, refetch } = useInvoice(id);
  const { data: accounts } = useAccounts();
  const pay = usePayInvoice();
  const [payerId, setPayerId] = useState<string | null>(null);

  const invoice = data?.invoice;
  const transactions = data?.transactions ?? [];
  // o pagamento é uma transferência: só entram contas que guardam dinheiro
  const payers = (accounts ?? []).filter(
    (a) => a.type !== 'credit_card' && a.id !== invoice?.account_id,
  );
  const total = transactions
    .filter((t) => t.kind === 'expense')
    .reduce((soma, t) => soma + t.amount_cents, 0);

  const confirmPay = () => {
    if (!invoice || !payerId) return;
    const conta = payers.find((a) => a.id === payerId);
    Alert.alert(
      'Pagar fatura',
      `Registrar ${formatBRL(total)} saindo de "${conta?.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Paguei',
          onPress: () =>
            pay.mutate(
              { invoiceId: invoice.id, accountId: payerId, paidAt: localISODate() },
              {
                onSuccess: () => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  setPayerId(null);
                },
                onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
              },
            ),
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Fatura" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {invoice && (
            <>
              <GlassCard style={styles.resumo}>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {STATUS_LABEL[invoice.status] ?? invoice.status}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {transactions.length} {transactions.length === 1 ? 'lançamento' : 'lançamentos'}
                  </ThemedText>
                </View>
                <ThemedText type="title">{formatBRL(total)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Fecha {formatDateBR(invoice.closing_date)} · vence{' '}
                  {formatDateBR(invoice.due_date)}
                </ThemedText>
                {invoice.status === 'paid' && invoice.paid_at && (
                  <ThemedText type="small" style={{ color: theme.success }}>
                    ✅ Paga em {formatDateBR(invoice.paid_at)}
                  </ThemedText>
                )}
              </GlassCard>

              {invoice.status !== 'paid' && total > 0 && (
                <GlassCard style={styles.pagar}>
                  <ThemedText type="smallBold">Pagar com</ThemedText>
                  {payers.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Cadastre uma conta corrente para registrar o pagamento.
                    </ThemedText>
                  ) : (
                    <View style={styles.chipRow}>
                      {payers.map((conta) => (
                        <Chip
                          key={conta.id}
                          label={conta.name}
                          selected={payerId === conta.id}
                          onPress={() => setPayerId(payerId === conta.id ? null : conta.id)}
                        />
                      ))}
                    </View>
                  )}
                  <Pressable
                    onPress={confirmPay}
                    disabled={!payerId || pay.isPending}
                    style={({ pressed }) => [
                      styles.submit,
                      {
                        backgroundColor: theme.tint,
                        opacity: pressed || !payerId || pay.isPending ? 0.6 : 1,
                      },
                    ]}>
                    <ThemedText type="smallBold" style={styles.buttonLabel}>
                      {pay.isPending ? 'Registrando…' : `Paguei ${formatBRL(total)}`}
                    </ThemedText>
                  </Pressable>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                    O pagamento entra como transferência — as compras já contaram como gasto
                    quando foram feitas.
                  </ThemedText>
                  {pay.isError && (
                    <ThemedText type="small" themeColor="danger" style={styles.centered}>
                      Não deu para registrar. Tenta de novo.
                    </ThemedText>
                  )}
                </GlassCard>
              )}

              {transactions.map((tx, index) => (
                <Animated.View
                  key={tx.id}
                  entering={FadeInDown.duration(400).delay(Math.min(index * 40, 400))}>
                  <GlassCard style={styles.item}>
                    <View style={styles.itemTexto}>
                      <ThemedText type="smallBold" numberOfLines={1}>
                        {tx.description ?? 'Sem descrição'}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatDateBR(tx.occurred_at)}
                        {tx.category ? ` · #${tx.category}` : ''}
                        {tx.status === 'pending' ? ' · parcela futura' : ''}
                      </ThemedText>
                    </View>
                    <ThemedText type="smallBold">{formatBRL(tx.amount_cents)}</ThemedText>
                  </GlassCard>
                </Animated.View>
              ))}

              {transactions.length === 0 && (
                <GlassCard style={styles.empty}>
                  <ThemedText style={styles.emptyEmoji}>🧾</ThemedText>
                  <ThemedText type="smallBold">Fatura sem lançamentos</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                    Nenhuma compra caiu neste ciclo ainda.
                  </ThemedText>
                </GlassCard>
              )}
            </>
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
  resumo: {
    gap: Spacing.one,
  },
  pagar: {
    gap: Spacing.three,
  },
  linha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  itemTexto: {
    flex: 1,
    gap: Spacing.half,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
  },
  centered: {
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
});
