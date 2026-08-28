import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { useCardSummary } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** Dias até a data (negativo = já passou). Compara data pura, sem hora. */
function daysUntil(iso: string): number {
  const hoje = new Date();
  const alvo = new Date(`${iso}T00:00:00`);
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round(
    (alvo.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) /
      umDia,
  );
}

function prazoLabel(iso: string, prefixo: string): string {
  const dias = daysUntil(iso);
  if (dias === 0) return `${prefixo} hoje`;
  if (dias === 1) return `${prefixo} amanhã`;
  if (dias > 0) return `${prefixo} em ${dias} dias`;
  return `${prefixo === 'vence' ? 'venceu' : 'fechou'} há ${Math.abs(dias)} dias`;
}

export default function CardsScreen() {
  const theme = useTheme();
  const { data: cards, isLoading, isError, refetch } = useCardSummary();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(cards ?? []).map((card, index) => {
            const limite = Number(card.credit_limit_cents ?? 0);
            const usado = Number(card.unpaid_total_cents ?? 0);
            const pct = limite > 0 ? Math.round((usado / limite) * 100) : 0;
            const cor = pct >= 90 ? theme.danger : pct >= 70 ? theme.warning : theme.success;
            const atrasada = card.due_date ? daysUntil(card.due_date) < 0 : false;

            return (
              <Animated.View
                key={card.account_id}
                entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
                <Pressable
                  disabled={!card.invoice_id}
                  onPress={() => {
                    if (!card.invoice_id) return;
                    Haptics.selectionAsync();
                    router.push({
                      pathname: '/finance/invoice/[id]',
                      params: { id: card.invoice_id },
                    });
                  }}>
                  <GlassCard style={styles.card}>
                    <View style={styles.cardHeader}>
                      <ThemedText type="smallBold">💳 {card.name}</ThemedText>
                      {card.due_date && (
                        <ThemedText
                          type="small"
                          style={{ color: atrasada ? theme.danger : theme.textSecondary }}>
                          {prazoLabel(card.due_date, 'vence')}
                        </ThemedText>
                      )}
                    </View>

                    <ThemedText type="subtitle">
                      {formatBRL(Number(card.invoice_total_cents ?? 0))}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {card.closing_date
                        ? `fatura aberta · ${prazoLabel(card.closing_date, 'fecha')}`
                        : 'nenhuma compra ainda neste ciclo'}
                    </ThemedText>

                    {limite > 0 && (
                      <>
                        <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                          <View
                            style={[
                              styles.fill,
                              { backgroundColor: cor, width: `${Math.min(Math.max(pct, 2), 100)}%` },
                            ]}
                          />
                        </View>
                        <View style={styles.cardHeader}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {formatBRL(usado)} de {formatBRL(limite)}
                          </ThemedText>
                          <ThemedText type="small" style={{ color: cor }}>
                            {formatBRL(Number(card.available_limit_cents ?? 0))} livres
                          </ThemedText>
                        </View>
                      </>
                    )}

                    {card.due_date && card.invoice_id && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Vencimento {formatDateBR(card.due_date)} · toque para ver a fatura
                      </ThemedText>
                    )}
                  </GlassCard>
                </Pressable>
              </Animated.View>
            );
          })}

          {!isLoading && !isError && (cards ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>💳</ThemedText>
              <ThemedText type="smallBold">Nenhum cartão cadastrado</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Cadastre um cartão em Contas com o dia de{'\n'}fechamento e de vencimento.{'\n\n'}
                Aí é só mandar no WhatsApp:{'\n'}“parcelei a geladeira em 12x no Nubank”.
              </ThemedText>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/finance/accounts');
                }}
                style={({ pressed }) => [
                  styles.submit,
                  { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  Cadastrar cartão
                </ThemedText>
              </Pressable>
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
  card: {
    gap: Spacing.one,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  track: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyHint: {
    textAlign: 'center',
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  buttonLabel: {
    color: '#fff',
  },
});
