import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useCardSummary, type CardSummary } from '@/hooks/use-finance';
import { formatBRL, formatDateBR } from '@/hooks/use-items';

/**
 * Cartões — "quanto vou pagar de cartão, e quando?".
 *
 * **A regra de ciclo mora no banco.** O trigger `set_invoice` chama `private.invoice_window` e
 * resolve a fatura de cada compra; aqui a tela só LÊ `closing_date`/`due_date` prontos. Nenhuma
 * aritmética de ciclo em TS — comparar uma data que o servidor mandou com hoje não é recalcular
 * ciclo, é ler prazo.
 *
 * **Cartão é conta comum em partida dobrada:** a compra já contou como gasto, e o pagamento da
 * fatura é uma transferência (`pay_invoice`). Esta tela nunca oferece lançar fatura como despesa.
 */

/** Dias até a data (negativo = já passou). Compara data pura, sem hora. */
function daysUntil(iso: string): number {
  const hoje = new Date();
  const alvo = new Date(`${iso}T00:00:00`);
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round(
    (alvo.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) /
      umDia
  );
}

function prazoLabel(iso: string, prefixo: 'vence' | 'fecha'): string {
  const dias = daysUntil(iso);
  if (dias === 0) return `${prefixo} hoje`;
  if (dias === 1) return `${prefixo} amanhã`;
  if (dias > 0) return `${prefixo} em ${dias} dias`;
  return `${prefixo === 'vence' ? 'venceu' : 'fechou'} há ${Math.abs(dias)} dias`;
}

/**
 * Estado da fatura.
 *
 * `card_summary()` ainda **não devolve `status`** — enquanto a coluna não existir na RPC, o
 * estado é inferido das datas que ela devolve. É a inferência mais honesta possível; o rótulo
 * fixo "fatura aberta" da versão anterior mentia para quem tinha fatura vencida.
 */
function estadoFatura(card: CardSummary): 'Aberta' | 'Fechada' | 'Atrasada' | null {
  if (!card.invoice_id) return null;
  if (card.due_date && daysUntil(card.due_date) < 0) return 'Atrasada';
  if (card.closing_date && daysUntil(card.closing_date) < 0) return 'Fechada';
  return 'Aberta';
}

/** Faixa de erro da tela. Não é `GlassCard` — o destaque é o único vidro daqui. */
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.centered}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

/** Card tocável: press-in de 120 ms com `scale`, o feedback de bloco (linha de lista usa fundo). */
function PressCard({
  onPress,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View style={animado}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPressIn={() => scale.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
        onPressOut={() => scale.set(withTiming(1, { duration: Motion.duration.fast }))}
        onPress={() => {
          Haptics.selectionAsync();
          onPress();
        }}>
        <Card style={styles.card}>{children}</Card>
      </Pressable>
    </Animated.View>
  );
}

export default function CardsScreen() {
  const cards = useCardSummary();

  // Ordem de urgência, não alfabética: atrasada primeiro, depois quem vence antes.
  const lista = [...(cards.data ?? [])].sort((a, b) => {
    const da = a.due_date ? daysUntil(a.due_date) : Number.MAX_SAFE_INTEGER;
    const db = b.due_date ? daysUntil(b.due_date) : Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  const totalAPagar = lista.reduce((s, c) => s + Number(c.unpaid_total_cents ?? 0), 0);
  const proximo = lista.find((c) => c.due_date && Number(c.unpaid_total_cents ?? 0) > 0);

  const irParaFatura = (card: CardSummary) => {
    if (!card.invoice_id) {
      router.push('/finance/accounts');
      return;
    }
    router.push({ pathname: '/finance/invoice/[id]', params: { id: card.invoice_id } });
  };

  return (
    <Screen grouped onRefresh={() => cards.refetch()} refreshing={cards.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Cartões',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable
              accessibilityLabel="Novo cartão"
              hitSlop={12}
              onPress={() => router.push('/finance/accounts')}>
              <Icon name="plus.circle.fill" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {cards.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <Skeleton height={160} radius={Radius.md} />
          <Skeleton height={160} radius={Radius.md} />
        </>
      ) : null}

      {cards.isError ? (
        <ErrorBand message="Não deu para carregar seus cartões." onRetry={cards.refetch} />
      ) : null}

      {/* O único GlassCard da tela: com N cartões, a pergunta da tela não tem resposta visível. */}
      {!cards.isError && lista.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <HeroLabel>Total a pagar</HeroLabel>
            <Money cents={totalAPagar} variant="money" />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {proximo?.due_date
                ? `${proximo.name} ${prazoLabel(proximo.due_date, 'vence')} · ${formatDateBR(proximo.due_date)}`
                : 'Nenhuma fatura em aberto'}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {lista.map((card, index) => {
        const estado = estadoFatura(card);
        const totalFatura = Number(card.invoice_total_cents ?? 0);
        const naoPago = Number(card.unpaid_total_cents ?? 0);
        const limite = Number(card.credit_limit_cents ?? 0);
        const livre = Number(card.available_limit_cents ?? 0);
        const anterior = naoPago - totalFatura;
        const pct = limite > 0 ? naoPago / limite : 0;
        const podePagar = estado === 'Fechada' || estado === 'Atrasada';

        return (
          <Animated.View
            key={card.account_id}
            entering={FadeInDown.duration(Motion.duration.slow).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap)
            )}>
            <PressCard
              onPress={() => irParaFatura(card)}
              accessibilityLabel={`${card.name}, ${estado ? `fatura ${estado.toLowerCase()}` : 'sem fatura aberta'}, ${formatBRL(totalFatura)}${card.due_date ? `, ${prazoLabel(card.due_date, 'vence')}` : ''}`}>
              <View style={styles.cardHead}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.cardName}>
                  {card.name}
                </ThemedText>
                {/* estado como PALAVRA, nunca só cor */}
                <View style={styles.badge}>
                  {estado === 'Atrasada' ? (
                    <Icon name="exclamationmark.triangle.fill" size="sm" color="danger" />
                  ) : null}
                  <ThemedText
                    type="footnote"
                    themeColor={estado === 'Atrasada' ? 'danger' : 'textSecondary'}>
                    {estado ?? 'Sem fatura aberta'}
                  </ThemedText>
                </View>
              </View>

              <Money
                cents={totalFatura}
                variant="title"
                tone={estado === 'Atrasada' ? 'danger' : 'text'}
              />

              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                {card.invoice_id && card.closing_date && card.due_date
                  ? `${prazoLabel(card.closing_date, 'fecha')} · vence ${formatDateBR(card.due_date)}`
                  : `Nenhuma compra neste ciclo${card.closing_date ? ` · ${prazoLabel(card.closing_date, 'fecha')}` : ''}`}
              </ThemedText>

              {limite > 0 ? (
                <>
                  <ProgressBar
                    value={naoPago}
                    max={limite}
                    tone={pct >= 1 ? 'danger' : pct >= 0.7 ? 'warning' : 'tint'}
                  />
                  <View style={styles.limitLine}>
                    <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                      usado {formatBRL(naoPago)} de {formatBRL(limite)}
                    </ThemedText>
                    {livre < 0 ? (
                      <View style={styles.badge}>
                        <Icon name="exclamationmark.triangle.fill" size="sm" color="danger" />
                        <ThemedText type="footnote" themeColor="danger" style={tabular}>
                          {formatBRL(Math.abs(livre))} acima do limite
                        </ThemedText>
                      </View>
                    ) : (
                      <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                        livre {formatBRL(livre)}
                      </ThemedText>
                    )}
                  </View>
                </>
              ) : (
                <ThemedText type="small" themeColor="tint">
                  Cadastre o limite para acompanhar quanto sobra
                </ThemedText>
              )}

              {/* "usado" soma TODAS as faturas não pagas; o número grande é só a desta. */}
              {anterior > 0 ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  Inclui {formatBRL(anterior)} de fatura anterior em aberto.
                </ThemedText>
              ) : null}

              {podePagar && totalFatura > 0 ? (
                <Button
                  label="Paguei"
                  variant="secondary"
                  size="sm"
                  onPress={() => irParaFatura(card)}
                />
              ) : null}
            </PressCard>
          </Animated.View>
        );
      })}

      {!cards.isLoading && !cards.isError && lista.length === 0 ? (
        <EmptyState
          icon="creditcard"
          title="Nenhum cartão cadastrado"
          hint="Cadastre o cartão com o dia que fecha e o dia que vence. Aí é só mandar “parcelei a geladeira em 12x no Nubank” no WhatsApp."
          action={{ label: 'Cadastrar cartão', onPress: () => router.push('/finance/accounts') }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  card: {
    gap: Space.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  cardName: {
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  limitLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
});
