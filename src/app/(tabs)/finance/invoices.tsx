import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass/glass-card';
import { monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { useAccounts, useCardInvoices, type CardInvoiceHistory } from '@/hooks/use-finance';
import { formatBRL, formatDateBR, localISODate } from '@/hooks/use-items';
import { showItemActions } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/**
 * Faturas — o arquivo do cartão.
 *
 * `card_summary()` só devolve a fatura aberta mais antiga: no instante em que o usuário paga,
 * ela some do app. Aqui a lista vem de `card_invoices` e o total de cada uma sai da soma das
 * compras, porque **o total nunca é materializado**.
 *
 * Tela de leitura pura: não se apaga fatura, ela é consequência das compras.
 */

const MESES = 12;
const ALTURA_BARRA = 76;

/** Estado como PALAVRA — cor sozinha não informa. */
function estado(invoice: CardInvoiceHistory, hoje: string): { texto: string; atrasada: boolean } {
  if (invoice.status === 'paid') {
    return { texto: invoice.paid_at ? `Paga em ${formatDateBR(invoice.paid_at)}` : 'Paga', atrasada: false };
  }
  if (invoice.due_date < hoje) return { texto: 'Atrasada', atrasada: true };
  return { texto: invoice.status === 'closed' ? 'Fechada' : 'Aberta', atrasada: false };
}

function Bar({ ratio, index, selecionada }: { ratio: number; index: number; selecionada: boolean }) {
  const theme = useTheme();
  const grow = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    grow.set(withDelay(index * Motion.stagger.step, withSpring(ratio, Motion.spring.settle)));
  }, [grow, ratio, index]);

  useEffect(() => {
    fade.set(withTiming(selecionada ? 1 : 0.5, { duration: Motion.duration.fast }));
  }, [fade, selecionada]);

  const animado = useAnimatedStyle(() => ({
    height: Math.max(Space.xs, grow.get() * ALTURA_BARRA),
    opacity: fade.get(),
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        animado,
        { backgroundColor: selecionada ? theme.tint : theme.backgroundElement },
      ]}
    />
  );
}

export default function InvoicesScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ account?: string }>();
  const accounts = useAccounts();
  const [cartaoId, setCartaoId] = useState<string | undefined>(params.account);
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null);

  const cartoes = useMemo(
    () => (accounts.data ?? []).filter((c) => c.type === 'credit_card'),
    [accounts.data],
  );
  const atual = cartoes.find((c) => c.id === cartaoId) ?? cartoes[0];
  const invoices = useCardInvoices(atual?.id, MESES);

  const hoje = localISODate();
  const lista = invoices.data ?? [];
  // A série lê da esquerda (mais antiga) para a direita (mês corrente).
  const serie = useMemo(() => [...(invoices.data ?? [])].reverse(), [invoices.data]);
  const maior = Math.max(...serie.map((i) => i.total_cents), 0);
  const ultimos = serie.slice(-6);
  const media =
    ultimos.length > 0
      ? Math.round(ultimos.reduce((soma, i) => soma + i.total_cents, 0) / ultimos.length)
      : 0;

  const acoes = (invoice: CardInvoiceHistory) =>
    showItemActions(monthTitle(invoice.reference_month.slice(0, 7)), [
      {
        label: 'Ver fatura',
        onPress: () =>
          router.push({ pathname: '/finance/invoice/[id]', params: { id: invoice.id } }),
      },
      ...(invoice.payment_transaction_id
        ? [
            {
              label: 'Ver o pagamento',
              onPress: () =>
                router.push({
                  pathname: '/finance/[txId]',
                  params: {
                    txId: invoice.payment_transaction_id!,
                    month: (invoice.paid_at ?? invoice.due_date).slice(0, 7),
                  },
                }),
            },
          ]
        : []),
    ]);

  return (
    <Screen grouped onRefresh={() => invoices.refetch()} refreshing={invoices.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Faturas',
          headerLargeTitle: true,
        }}
      />

      {accounts.isError ? (
        <Section title="Cartões">
          <Row
            title="Não deu para carregar seus cartões"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => accounts.refetch()}
          />
        </Section>
      ) : null}

      {accounts.isLoading ? <Skeleton height={36} radius={Radius.xs} /> : null}

      {cartoes.length > 1 ? (
        <Segmented
          options={cartoes.map((c) => ({ value: c.id, label: c.name }))}
          value={atual?.id ?? cartoes[0].id}
          onChange={(id) => {
            setCartaoId(id);
            setMesSelecionado(null);
          }}
        />
      ) : null}

      {atual ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
          {atual.name}
        </ThemedText>
      ) : null}

      {invoices.isLoading ? (
        <>
          <Skeleton height={132} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {invoices.isError ? (
        <Section title="Faturas">
          <Row
            title="Não deu para carregar as faturas"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => invoices.refetch()}
          />
        </Section>
      ) : null}

      {/* O único GlassCard da tela: doze números em coluna não respondem "está subindo?". */}
      {!invoices.isError && serie.length > 1 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              Últimas {serie.length} faturas
            </ThemedText>
            <View
              accessibilityRole="image"
              accessibilityLabel={`Fatura entre ${formatBRL(Math.min(...serie.map((i) => i.total_cents)))} e ${formatBRL(maior)} nas últimas ${serie.length} faturas, média de ${formatBRL(media)}`}
              style={styles.bars}>
              {serie.map((invoice, index) => (
                <Pressable
                  key={invoice.id}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.barSlot}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setMesSelecionado(
                      mesSelecionado === invoice.reference_month ? null : invoice.reference_month,
                    );
                  }}>
                  <View style={styles.barTrack}>
                    <Bar
                      ratio={maior > 0 ? invoice.total_cents / maior : 0}
                      index={index}
                      selecionada={mesSelecionado === null || mesSelecionado === invoice.reference_month}
                    />
                  </View>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              média de {formatBRL(media)} nas últimas {ultimos.length}{' '}
              {ultimos.length === 1 ? 'fatura' : 'faturas'}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {!invoices.isError && serie.length === 1 ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
          Comparação aparece a partir do segundo mês.
        </ThemedText>
      ) : null}

      {lista.length > 0 ? (
        <Section title="Todas as faturas">
          {lista.map((invoice, index) => {
            const situacao = estado(invoice, hoje);
            const mes = invoice.reference_month.slice(0, 7);
            return (
              <Animated.View
                key={invoice.id}
                entering={FadeInDown.duration(Motion.duration.base).delay(
                  Math.min(index * Motion.stagger.step, Motion.stagger.cap),
                )}
                // Tocar na barra marca o mês aqui embaixo: o gráfico aponta, não navega.
                style={
                  mesSelecionado === invoice.reference_month
                    ? { backgroundColor: theme.accentSoft }
                    : undefined
                }>
                <Row
                  title={monthTitle(mes)}
                  subtitle={`${situacao.texto} · vence ${formatDateBR(invoice.due_date)}`}
                  icon={situacao.atrasada ? 'exclamationmark.triangle' : 'creditcard'}
                  destructive={situacao.atrasada}
                  accessibilityLabel={`${monthTitle(mes)}, ${formatBRL(invoice.total_cents)}, ${situacao.texto}`}
                  trailing={
                    <Money
                      cents={invoice.total_cents}
                      variant="headline"
                      tone={situacao.atrasada ? 'danger' : 'text'}
                    />
                  }
                  onPress={() =>
                    router.push({ pathname: '/finance/invoice/[id]', params: { id: invoice.id } })
                  }
                  onLongPress={() => acoes(invoice)}
                />
              </Animated.View>
            );
          })}
        </Section>
      ) : null}

      {!accounts.isLoading && !accounts.isError && cartoes.length === 0 ? (
        <EmptyState
          icon="creditcard"
          title="Nenhum cartão cadastrado"
          hint="Cadastre o cartão com o dia que fecha e o dia que vence — a primeira fatura nasce junto com a primeira compra."
          action={{ label: 'Cadastrar cartão', onPress: () => router.push('/finance/accounts') }}
        />
      ) : null}

      {atual && !invoices.isLoading && !invoices.isError && lista.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="Nenhuma fatura ainda"
          hint={`A primeira fatura nasce junto com a primeira compra no cartão — manda “almocei 40 no ${atual.name}” no WhatsApp.`}
        />
      ) : null}

      {lista.length > 0 ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
          Faturas começam a aparecer aqui quando a primeira compra cai no cartão. O total soma as
          compras da fatura; o pagamento é transferência e não entra na conta.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  barSlot: {
    flex: 1,
  },
  barTrack: {
    width: '100%',
    height: ALTURA_BARRA,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  rodape: {
    paddingHorizontal: Space.lg,
  },
});
