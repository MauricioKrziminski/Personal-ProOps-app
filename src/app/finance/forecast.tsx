import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useAffordability,
  useCashFlowForecast,
  useCashHistory,
  useMarkPaid,
  useUpcomingBills,
} from '@/hooks/use-finance';
import { useDebounced } from '@/hooks/use-debounced';
import { formatBRL, isoToBR, localISODate } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { settleAccessibilityLabel, settleLabel } from '@/lib/settle-labels';

/**
 * Projeção — "posso gastar isso?".
 *
 * É modelo de **caixa**, montado para não contar o mesmo gasto duas vezes:
 * saldo inicial = contas que guardam dinheiro (cartão fora), só `cleared`; saídas futuras = toda
 * fatura não paga **na data de vencimento** + `pending` sem fatura em `coalesce(due_at,
 * occurred_at)`.
 *
 * Daí a consequência contraintuitiva que a tela precisa dizer com todas as letras: **a compra no
 * cartão sai do caixa quando a fatura vence, não quando foi feita**. Quem gastou R$ 800 no cartão
 * hoje vê o saldo intacto por três semanas e acha que a projeção quebrou.
 *
 * O simulador é o diferencial do produto e por isso é o SEGUNDO bloco, sempre visível — antes ele
 * ficava no fim da tela e só renderizava com série carregada.
 */

const HORIZONTES = [
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '6 meses' },
];

const PARCELAS = [1, 3, 6, 10, 12];

/** Faixa de erro por seção. Seção que falha DIZ que falhou — nunca some. */
function ErrorBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={styles.band}>
      <Icon name="exclamationmark.triangle.fill" size="lg" color="danger" />
      <ThemedText type="small" style={styles.bandText}>
        {message}
      </ThemedText>
      <Button label="Tentar de novo" variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

export default function ForecastScreen() {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const { simular } = useLocalSearchParams<{ simular?: string }>();

  const [dias, setDias] = useState(90);
  const [simCents, setSimCents] = useState(0);
  const [parcelas, setParcelas] = useState(1);
  const [comoCalculo, setComoCalculo] = useState(false);

  // Cada tecla do MoneyField é uma chave nova, e `affordability` roda uma projeção de 370 dias por
  // dentro: sem o atraso, digitar "1250" são quatro projeções de um ano.
  const simDebounced = useDebounced(simCents, 400);

  const forecast = useCashFlowForecast(dias);
  const bills = useUpcomingBills(30);
  const accounts = useAccounts();
  const sim = useAffordability(simDebounced, parcelas);
  const markPaid = useMarkPaid();

  const serie = forecast.data ?? [];
  const projetados = serie.map((d) => Number(d.balance_cents));
  const hoje = projetados[0] ?? 0;
  const fim = projetados[projetados.length - 1] ?? 0;

  // O passado entra ANTES do dia 0 e no mesmo eixo. A foto de HOJE é descartada: ela foi tirada
  // pelo cron de madrugada e o dia 0 da projeção já é o valor de agora — manter as duas criaria
  // um degrau na emenda entre histórico e projeção.
  const historico = useCashHistory(dias);
  // Sem `useMemo`: são duas listas de no máximo ~180 números, e memoizar em cima de
  // `projetados` (que nasce novo a cada render) faz o React Compiler desistir da tela inteira.
  const passado = (historico.data ?? [])
    .filter((p) => p.day < localISODate())
    .map((p) => p.cents);
  const valores = [...passado, ...projetados];
  // O que a projeção soma e o que ela tira, no horizonte escolhido. A RPC devolve os dois desde
  // sempre; nada nesta tela lia `in_cents`.
  const entra = serie.reduce((t, d) => t + Number(d.in_cents), 0);
  const sai = serie.reduce((t, d) => t + Number(d.out_cents), 0);
  const primeiroNegativo = serie.find((d) => Number(d.balance_cents) < 0);
  // `upcoming_bills` passou a devolver receita prevista (`kind: 'income'`, 20260909150000).
  // Ela tem seção própria: "O que vence" é vocabulário de saída.
  const contas = (bills.data ?? []).filter((b) => b.kind !== 'income');
  const atrasadas = contas.filter((b) => b.overdue);
  const aVencer = contas.filter((b) => !b.overdue);
  const aReceber = (bills.data ?? []).filter((b) => b.kind === 'income');

  /**
   * O empty de verdade é *nada para projetar*: sem conta cadastrada, sem nada a vencer e a série
   * inteira em zero. `serie.length === 0` nunca acontece — `generate_series` devolve uma linha por
   * dia mesmo sem nenhum lançamento, e o empty antigo era inalcançável.
   */
  const nadaParaProjetar =
    !forecast.isLoading &&
    !accounts.isLoading &&
    !bills.isLoading &&
    !bills.isError &&
    (accounts.data ?? []).length === 0 &&
    contas.length === 0 &&
    valores.every((v) => v === 0);

  const veredito = sim.data
    ? sim.data.can_afford
      ? `Dá para pagar. No pior dia você fica com ${formatBRL(Number(sim.data.worst_balance_cents))}, em ${isoToBR(sim.data.worst_day)}.`
      : `Aperta. Você fica com ${formatBRL(Number(sim.data.worst_balance_cents))} em ${isoToBR(sim.data.worst_day)}.`
    : null;

  // Haptic e anúncio só quando o veredito VIRA — nunca a cada tecla.
  const vereditoAnterior = useRef<boolean | null>(null);
  useEffect(() => {
    const cabe = sim.data?.can_afford;
    if (cabe === undefined || veredito === null) return;
    if (vereditoAnterior.current === cabe) return;
    vereditoAnterior.current = cabe;
    Haptics.notificationAsync(
      cabe ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    );
    AccessibilityInfo.announceForAccessibility(veredito);
  }, [sim.data?.can_afford, veredito]);

  const pagar = (id: string, titulo: string) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${titulo} marcado como pago.`, tone: 'success' }),
        // otimista sem rollback visível faz o usuário achar que pagou
        onError: () => toast({ message: `Não deu para dar baixa em ${titulo}.`, tone: 'error' }),
      }
    );

  const escolherHorizonte = () =>
    showItemActions(
      'Horizonte da projeção',
      HORIZONTES.map((h) => ({ label: h.label, onPress: () => setDias(h.dias) }))
    );

  const linhaConta = (b: (typeof contas)[number]) => {
    const fatura = b.kind === 'invoice';
    // `debt` é a prestação de um financiamento: `ref_id` é o id da DÍVIDA, não de
    // um lançamento. Baixa de lançamento nele não acharia nada — vai para a
    // dívida, do mesmo jeito que a fatura vai para a fatura.
    const parcelaDeDivida = b.kind === 'debt';
    const receita = b.kind === 'income';
    const cents = Number(b.amount_cents);

    return (
      <Row
        key={b.ref_id}
        title={b.title}
        subtitle={
          b.overdue
            ? receita
              ? `não caiu em ${isoToBR(b.due_date)}`
              : `venceu em ${isoToBR(b.due_date)}`
            : isoToBR(b.due_date)
        }
        icon={fatura ? 'creditcard' : parcelaDeDivida ? 'banknote' : receita ? 'arrow.down.left' : 'doc.text'}
        chevron
        accessibilityLabel={`${b.title}, ${b.overdue ? (receita ? 'ainda não caiu, era esperado' : 'atrasado, vencia') : receita ? 'chega' : 'vence'} em ${isoToBR(b.due_date)}, ${formatBRL(cents)}`}
        // Lançamento avulso agora ABRE, como fatura e dívida já abriam. Dar baixa num
        // valor que veio diferente do previsto grava o valor errado, e esta tela não
        // tinha caminho nenhum para corrigir antes — só o "marcar como pago".
        onPress={
          fatura
            ? () => router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } })
            : parcelaDeDivida
              ? () => router.push('/finance/debts')
              : () => router.push({ pathname: '/finance/[txId]', params: { txId: b.ref_id } })
        }
        onLongPress={
          fatura || parcelaDeDivida
            ? undefined
            : () =>
                showItemActions(b.title, [
                  {
                    label: settleAccessibilityLabel(receita ? 'income' : 'expense', b.title),
                    onPress: () => pagar(b.ref_id, b.title),
                  },
                  {
                    label: 'Editar',
                    icon: 'pencil',
                    onPress: () =>
                      router.push({ pathname: '/finance/transaction-form', params: { id: b.ref_id } }),
                  },
                ])
        }
        trailing={
          <View style={styles.trailing}>
            <Money
              cents={cents}
              variant="headline"
              // Receita atrasada não é dívida: `success` mesmo quando não caiu. `danger` ali
              // seria gastar a alavanca de cor do app num aviso (design.md §2b).
              tone={receita ? 'success' : b.overdue ? 'danger' : 'text'}
            />
            {fatura ? (
              <Button
                label="Pagar fatura"
                size="sm"
                variant="secondary"
                onPress={() =>
                  router.push({ pathname: '/finance/invoice/[id]', params: { id: b.ref_id } })
                }
              />
            ) : parcelaDeDivida ? (
              <Button
                label="Ver dívida"
                size="sm"
                variant="secondary"
                onPress={() => router.push('/finance/debts')}
              />
            ) : (
              <Button
                label={settleLabel(receita ? 'income' : 'expense')}
                size="sm"
                variant="secondary"
                onPress={() => pagar(b.ref_id, b.title)}
              />
            )}
          </View>
        }
      />
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => Promise.all([forecast.refetch(), bills.refetch(), accounts.refetch(), historico.refetch(), simDebounced > 0 ? sim.refetch() : Promise.resolve()])}
      refreshing={forecast.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Projeção',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions
        actions={[
          {
            label: `Horizonte da projeção, ${HORIZONTES.find((h) => h.dias === dias)?.label}`,
            icon: 'calendar',
            onPress: escolherHorizonte,
          },
        ]}
      />

      {forecast.isLoading ? (
        <>
          <Skeleton height={180} radius={Radius.lg} />
          <Skeleton height={140} radius={Radius.md} />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da tela: o título é a resposta, não o rótulo. */}
      {forecast.isError ? (
        <ErrorBand message="Não deu para carregar a projeção." onRetry={forecast.refetch} />
      ) : serie.length > 0 && !nadaParaProjetar ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <View style={styles.heroTitulo}>
              {primeiroNegativo ? (
                <Icon name="exclamationmark.triangle" size="md" color="danger" />
              ) : null}
              <ThemedText
                type="smallBold"
                themeColor={primeiroNegativo ? 'danger' : 'text'}
                style={styles.heroTexto}>
                {primeiroNegativo
                  ? `Você fica no vermelho em ${isoToBR(primeiroNegativo.day)}`
                  : `Não fica negativo nos próximos ${HORIZONTES.find((h) => h.dias === dias)?.label}`}
              </ThemedText>
            </View>

            {/* Skia não gera árvore de acessibilidade: sem este label a tela fica muda. */}
            <View
              accessible
              accessibilityLabel={`Saldo hoje ${formatBRL(hoje)}, no fim do período ${formatBRL(fim)}${primeiroNegativo ? `, negativo a partir de ${isoToBR(primeiroNegativo.day)}` : ''}`}>
              <Sparkline
                values={valores}
                width={width - Space.lg * 4}
                height={96}
                showZero
                pastCount={passado.length + 1}
              />
            </View>

            {/*
              A legenda que o gráfico nunca teve. Ele desenha passado e futuro na MESMA linha
              (o traço muda de estilo em `pastCount`), e nada dizia onde um acaba — a pedido do
              dono do produto: *"nos gráficos, tem que ter alguma coisa explicando a diferença"*.
            */}
            <View style={styles.legenda}>
              <ThemedText type="caption" themeColor="textSecondary">
                {passado.length > 0 ? '━ o que já caiu na conta' : '━ saldo de hoje'}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                ┄ previsto: o real, mais o que entra e sai
              </ThemedText>
            </View>

            <View style={styles.heroSplit}>
              <View style={styles.heroParte}>
                <HeroLabel>tenho hoje</HeroLabel>
                <Money cents={hoje} variant="title2" tone={hoje < 0 ? 'danger' : 'text'} />
              </View>
              <View style={styles.heroParte}>
                <HeroLabel>em {dias} dias</HeroLabel>
                <Money cents={fim} variant="title2" tone={fim < 0 ? 'danger' : 'text'} />
              </View>
            </View>

            {/*
              `in_cents` vinha do banco desde sempre e o arquivo inteiro não usava — a projeção
              SOMA entradas previstas e a tela só falava de subtrair. É esta linha que explica
              por que a curva sobe.
            */}
            {entra > 0 || sai > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                entra {formatBRL(entra)} · sai {formatBRL(sai)} em {dias} dias
              </ThemedText>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}

      {/* Segundo bloco, sempre visível: é a pergunta mais frequente do produto. */}
      {!nadaParaProjetar ? (
        <Card style={styles.simulador}>
          <ThemedText type="smallBold">Posso comprar isso?</ThemedText>

          <Field label="Valor da compra">
            <MoneyField
              valueCents={simCents}
              onChangeCents={setSimCents}
              autoFocus={simular === '1'}
            />
          </Field>

          <Field label="Em quantas vezes">
            <Segmented
              options={PARCELAS.map((p) => ({ value: String(p), label: `${p}x` }))}
              value={String(parcelas)}
              onChange={(v) => setParcelas(Number(v))}
            />
          </Field>

          {sim.isError ? (
            <ErrorBand message="Não deu para simular agora." onRetry={sim.refetch} />
          ) : simCents === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Digite um valor para simular contra a sua projeção real.
            </ThemedText>
          ) : sim.data && veredito ? (
            <Animated.View key={veredito} entering={FadeIn.duration(Motion.duration.fast)}>
              <ThemedText
                type="small"
                themeColor={sim.data.can_afford ? 'success' : 'danger'}
                accessibilityLiveRegion="polite">
                {veredito}
              </ThemedText>
              {parcelas > 1 ? (
                <View style={styles.parcela}>
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    {parcelas}x de
                  </ThemedText>
                  <Money
                    cents={Number(sim.data.installment_cents)}
                    variant="subhead"
                    tone="textSecondary"
                  />
                </View>
              ) : null}
            </Animated.View>
          ) : (
            <Skeleton height={20} />
          )}
        </Card>
      ) : null}

      {bills.isError ? (
        <ErrorBand message="Não deu para carregar o que vence." onRetry={bills.refetch} />
      ) : null}

      {/* `!bills.isError`: o `data` do TanStack sobrevive ao erro de refetch, e sem isso a lista
          de "Atrasado" continuava oferecendo "Pagar fatura" logo abaixo da faixa que acabou de
          dizer que não conseguiu carregar o que vence — com um botão que escreve no banco. */}
      {!bills.isError && atrasadas.length > 0 ? (
        <Section title="Atrasado">{atrasadas.map(linhaConta)}</Section>
      ) : null}
      {!bills.isError && aVencer.length > 0 ? (
        <Section title="O que vence">{aVencer.map(linhaConta)}</Section>
      ) : null}
      {/*
        O par de "O que vence". Vem DEPOIS de propósito: quem abre esta tela vem perguntar se o
        dinheiro dá, e a resposta é o que sai. O que entra é a segunda metade da conta.
      */}
      {!bills.isError && aReceber.length > 0 ? (
        <Section title="O que entra">{aReceber.map(linhaConta)}</Section>
      ) : null}

      {!bills.isLoading &&
      !bills.isError &&
      contas.length === 0 &&
      aReceber.length === 0 &&
      !nadaParaProjetar ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.calmo}>
          Nada vence nem entra nos próximos 30 dias.
        </ThemedText>
      ) : null}

      {nadaParaProjetar ? (
        <EmptyState
          icon="chart.line.uptrend.xyaxis"
          title="Ainda não dá para projetar"
          hint={'Cadastre suas contas e manda no WhatsApp “todo dia 5 pago 1200 de aluguel”.\nA partir daí eu mostro quanto sobra em cada dia.'}
          action={{ label: 'Cadastrar conta', onPress: () => router.push('/finance/accounts') }}
        />
      ) : null}

      {/* Quem duvida do número procura aqui; quem não duvida nem vê. */}
      <View style={styles.explicacao}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: comoCalculo }}
          onPress={() => setComoCalculo((v) => !v)}
          style={styles.explicacaoCabecalho}>
          <ThemedText type="small" themeColor="textSecondary">
            Como eu calculo isso
          </ThemedText>
          <Icon name={comoCalculo ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
        </Pressable>
        {comoCalculo ? (
          <Card style={styles.explicacaoCorpo}>
            <ThemedText type="small" themeColor="textSecondary">
              Começo pelo dinheiro que já está nas suas contas — cartão fica de fora, e só conta o
              que já aconteceu.
            </ThemedText>
            {/*
              A frase que faltava. As três originais começavam por "Começo…", "TIRO…" e "…SAI do
              caixa" — o explicador descrevia a projeção como se ela só subtraísse, enquanto o SQL
              soma `in_cents` desde sempre. Quem lia isso não tinha como saber que o número já
              contava com o Pix que ainda não chegou.
            */}
            <ThemedText type="small" themeColor="textSecondary">
              Somo o que está previsto para entrar, na data de cada um — e quando você marca
              Recebi, o valor sai daqui e entra no seu saldo de verdade.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tiro cada fatura não paga no dia em que ela vence, e cada despesa prevista na data
              dela.
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Por isso a compra no cartão sai do caixa quando a fatura vence, não no dia da compra:
              o dinheiro ainda está com você até lá.
            </ThemedText>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.md,
  },
  heroTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  heroTexto: {
    flex: 1,
  },
  heroSplit: {
    flexDirection: 'row',
    gap: Space.xl,
  },
  heroParte: {
    gap: Space.xs,
  },
  simulador: {
    gap: Space.lg,
  },
  parcela: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingTop: Space.xs,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  calmo: {
    paddingHorizontal: Space.lg,
  },
  explicacao: {
    gap: Space.sm,
  },
  explicacaoCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
  },
  explicacaoCorpo: {
    gap: Space.sm,
  },
  legenda: {
    gap: Space.half,
  },
});
