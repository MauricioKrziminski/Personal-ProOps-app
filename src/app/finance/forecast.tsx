import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
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
import { Sheet } from '@/components/ui/sheet';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useCashFlowForecast,
  useCashHistory,
  useForecastMonths,
  useForecastWithDrafts,
  useMarkPaid,
  useMonthSummary,
  useUpcomingBills,
  type Draft,
} from '@/hooks/use-finance';
import { MonthPicker, currentMonth, monthTitle } from '@/components/finance/month-picker';
import { mesDoCorte, veioDe, type MesProjetado } from '@/lib/forecast-months';
import { formatBRL, isoToBR, localISODate } from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import { settleLabel } from '@/lib/settle-labels';

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

/**
 * Até 3 anos. O teto vive em `private.clamp_forecast_days` (`20260910220000`) e vale 1095.
 *
 * Ir além de 6 meses só passou a fazer sentido depois que a recorrente virou projeção da regra
 * (`20260910140000`): antes, o ano 2 mostraria a parcela do financiamento e ZERO salário. E é o
 * que faz o rascunho poder supor uma receita em 2028 — o seletor de mês dele oferece os meses
 * DESTA janela, então horizonte curto = suposição curta.
 */
const HORIZONTES = [
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 180, label: '6 meses' },
  { dias: 365, label: '1 ano' },
  { dias: 730, label: '2 anos' },
  { dias: 1095, label: '3 anos' },
  { dias: 1825, label: '5 anos' },
  { dias: 3650, label: '10 anos' },
];

/** O rótulo do horizonte, para a tela nunca escrever "em 730 dias". */
function rotuloHorizonte(dias: number): string {
  return HORIZONTES.find((h) => h.dias === dias)?.label ?? `${dias} dias`;
}

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

  const [dias, setDias] = useState(90);
  const [comoCalculo, setComoCalculo] = useState(false);
  /**
   * Dia × Mês.
   *
   * A curva diária responde "quando aperta"; a tabela mensal responde "como fecha cada mês" —
   * que é a pergunta que o dono do produto vinha respondendo numa planilha, uma aba por mês.
   * Os dois saem da MESMA série: `agruparPorMes` não refaz conta nenhuma, só lê o acumulado do
   * último dia de cada mês.
   */
  const [modo, setModo] = useState<'dia' | 'mes'>('dia');
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  /**
   * Rascunho de cenário.
   *
   * Mora em `useState` de propósito: sair da tela desmonta o componente e o rascunho some, que é
   * exatamente o que o dono do produto pediu — *"ser meio que um rascunho e se eu voltar, ele
   * some"*. Nada disso vai para o banco nem para o AsyncStorage.
   */
  const [rascunhos, setRascunhos] = useState<Draft[]>([]);
  const [sheetAberto, setSheetAberto] = useState(false);
  const [novoTipo, setNovoTipo] = useState<'income' | 'expense'>('income');
  const [novoValor, setNovoValor] = useState(0);
  const [novoMes, setNovoMes] = useState<string | null>(null);
  const [novoParcelas, setNovoParcelas] = useState(1);
  const [novoModo, setNovoModo] = useState<'total' | 'monthly'>('total');

  /**
   * ⚠️ **Cada modo busca a SUA granularidade, e só a sua.**
   *
   * O modo Mês desenha ~120 números; baixar os 3.651 dias para somá-los no cliente custava
   * 288 KB contra 13 KB (medido pela API, 10/09/2026) e punha aritmética de dinheiro numa
   * segunda linguagem. Agora quem agrupa é `private.month_group`, e no modo Mês a série diária
   * e o histórico nem são pedidos.
   */
  const emMes = modo === 'mes';
  const forecast = useCashFlowForecast(dias, !emMes);
  const bills = useUpcomingBills(30);
  const accounts = useAccounts();
  const markPaid = useMarkPaid();

  // ⚠️ A troca do rascunho acontece AQUI, num lugar só, nos DOIS caminhos: o mensal recebe as
  // mesmas hipóteses e passa pela mesma `forecast_json` por dentro. Assim a tabela e a curva
  // não têm como discordar por caminho.
  const simulado = useForecastWithDrafts(dias, rascunhos, !emMes);
  const mensal = useForecastMonths(dias, rascunhos, emMes);
  const simulando = rascunhos.length > 0;
  // `?? forecast.data` enquanto a simulação carrega: sem isso a tela PISCA vazia a cada
  // suposição somada, e o destaque salta de um número real para nada e de volta.
  const serie = (simulando ? (simulado.data ?? forecast.data) : forecast.data) ?? [];
  const meses: MesProjetado[] = mensal.data?.meses ?? [];

  // `hoje` é o saldo do dia 0. No mensal ele vem do payload de propósito: o primeiro MÊS fecha
  // no fim do mês corrente, e usá-lo aqui mostraria esse número com o rótulo "TENHO HOJE".
  const saldoHoje = emMes
    ? Number(mensal.data?.hoje ?? 0)
    : Number(serie[0]?.balance_cents ?? 0);
  const projetados = emMes
    ? [saldoHoje, ...meses.map((m) => Number(m.saldo))]
    : serie.map((d) => Number(d.balance_cents));
  const hoje = projetados[0] ?? 0;
  const fim = projetados[projetados.length - 1] ?? 0;

  // O passado entra ANTES do dia 0 e no mesmo eixo. A foto de HOJE é descartada: ela foi tirada
  // pelo cron de madrugada e o dia 0 da projeção já é o valor de agora — manter as duas criaria
  // um degrau na emenda entre histórico e projeção.
  //
  // ⚠️ **No modo Mês o passado sai.** A curva espaça os pontos por igual: dias no passado ao
  // lado de meses no futuro daria duas escalas no mesmo eixo, e o passado apareceria esmagado.
  const historico = useCashHistory(dias, !emMes);
  // Sem `useMemo`: são duas listas de no máximo ~180 números, e memoizar em cima de
  // `projetados` (que nasce novo a cada render) faz o React Compiler desistir da tela inteira.
  const passado = emMes
    ? []
    : (historico.data ?? []).filter((p) => p.day < localISODate()).map((p) => p.cents);
  const valores = [...passado, ...projetados];
  // O que a projeção soma e o que ela tira, no horizonte escolhido.
  const entra = emMes
    ? meses.reduce((t, m) => t + Number(m.entra), 0)
    : serie.reduce((t, d) => t + Number(d.in_cents), 0);
  const sai = emMes
    ? meses.reduce((t, m) => t + Number(m.sai), 0)
    : serie.reduce((t, d) => t + Number(d.out_cents), 0);
  // O PRIMEIRO dia negativo — a data em que a pessoa precisa agir, não o pior dia.
  const primeiroNegativo = emMes
    ? (meses.find((m) => m.primeiroNegativo)?.primeiroNegativo ?? null)
    : (serie.find((d) => Number(d.balance_cents) < 0)?.day ?? null);

  // O mês expandido. `mesAberto` governa o `enabled` do hook: sem nenhum mês aberto, nenhuma
  // RPC é chamada.
  const resumoAberto = useMonthSummary(mesAberto ?? '', mesAberto !== null);
  // `recurring_covered_until` é propriedade da SÉRIE, não do mês — qualquer mês devolve o mesmo.
  // Vem do mês corrente porque essa chave já está no cache (a aba Financeiro a usa).
  const mesCorrente = useMonthSummary(localISODate().slice(0, 7));
  const corte = mesDoCorte(meses, mesCorrente.data?.recurring_covered_until ?? null);
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

  /**
   * Haptic quando o cenário VIRA de sinal — não a cada tecla.
   *
   * Antes isso pendurava em `affordability.can_afford`. Agora sai da própria série simulada:
   * `primeiroNegativo` já é calculado sobre `serie`, que é a projeção COM as hipóteses. Um
   * caminho a menos e um significado a mais — vale para receita também, não só para compra.
   */
  const fica = simulando ? primeiroNegativo === null : null;
  const vereditoAnterior = useRef<boolean | null>(null);
  useEffect(() => {
    if (fica === null) {
      vereditoAnterior.current = null;
      return;
    }
    if (vereditoAnterior.current === fica) return;
    const primeiro = vereditoAnterior.current === null;
    vereditoAnterior.current = fica;
    if (primeiro) return;
    Haptics.notificationAsync(
      fica ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );
  }, [fica]);

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
                    // Um rótulo só para a mesma intenção (design.md §10): o menu de Lançamentos
                    // diz "Paguei", e o cabeçalho do sheet já nomeia o item — repetir o nome
                    // aqui escrevia "Paguei: Aluguel" embaixo de "Aluguel".
                    label: settleLabel(receita ? 'income' : 'expense'),
                    icon: 'checkmark.circle',
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
        // ⚠️ **Só o valor fica na linha — a ação mora no toque e no menu.** Os três botões
        // que ficavam aqui não faziam nada que a própria linha já não fizesse: "Pagar fatura"
        // e "Ver dívida" repetiam literalmente o `onPress` acima, e dar baixa já está no menu
        // de toque longo. O que eles somavam era largura: o bloco passava do `minWidth: 180`
        // do título, o `flexWrap` do `Row` mandava valor e botão para a linha de baixo e a
        // linha ficava com o dobro da altura. Mesma régua de Lançamentos — o comentário longo
        // está lá.
        trailing={
          <Money
            cents={cents}
            variant="headline"
            // Receita atrasada não é dívida: `success` mesmo quando não caiu. `danger` ali
            // seria gastar a alavanca de cor do app num aviso (design.md §2b).
            tone={receita ? 'success' : b.overdue ? 'danger' : 'text'}
          />
        }
      />
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => Promise.all([forecast.refetch(), bills.refetch(), accounts.refetch(), historico.refetch()])}
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
            label: `Horizonte da projeção, ${rotuloHorizonte(dias)}`,
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
                  ? `Você fica no vermelho em ${isoToBR(primeiroNegativo)}`
                  : `Não fica negativo nos próximos ${rotuloHorizonte(dias)}`}
              </ThemedText>
            </View>

            {/* Skia não gera árvore de acessibilidade: sem este label a tela fica muda. */}
            <View
              accessible
              accessibilityLabel={`Saldo hoje ${formatBRL(hoje)}, no fim do período ${formatBRL(fim)}${primeiroNegativo ? `, negativo a partir de ${isoToBR(primeiroNegativo)}` : ''}`}>
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
                <HeroLabel>em {rotuloHorizonte(dias)}</HeroLabel>
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
                entra {formatBRL(entra)} · sai {formatBRL(sai)} em {rotuloHorizonte(dias)}
              </ThemedText>
            ) : null}
          </Card>
        </Animated.View>
      ) : null}

      {/*
        "E se…?" — o simulador de cenário.
        
        Era "Posso comprar isso?", e o nome contava a limitação: a conta vivia dentro do
        `affordability`, que SEMPRE subtrai. Perguntar "e se eu passar a receber 1.500 por mês?"
        não tinha como. Desde `20260910170000` a aritmética é `private.draft_effect`, com
        `kind` — e aí o nome do bloco não podia mais falar só de compra.
        
        Ele é o SEGUNDO bloco e sempre visível: é a pergunta mais frequente do produto.
      */}
      {!nadaParaProjetar ? (
        <Card style={styles.simulador}>
          <View style={styles.rascunhoTopo}>
            <Icon name={simulando ? 'pencil.and.outline' : 'questionmark.circle'} size="md" color={simulando ? 'warning' : 'textSecondary'} />
            <ThemedText type="smallBold" style={styles.bandText}>
              {simulando ? 'Rascunho — nada disso está salvo' : 'E se…?'}
            </ThemedText>
            {simulando ? (
              <Button label="Limpar" variant="secondary" size="sm" onPress={() => setRascunhos([])} />
            ) : null}
          </View>

          {simulando ? (
            rascunhos.map((d, i) => (
              <View key={`${d.kind}-${d.start}-${d.amount_cents}-${i}`} style={styles.rascunhoLinha}>
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  {d.kind === 'income' ? 'entra' : 'sai'} {formatBRL(d.amount_cents)}
                  {d.mode === 'monthly'
                    ? ' todo mês'
                    : d.installments > 1
                      ? ` em ${d.installments}x`
                      : ''}{' '}
                  · a partir de {isoToBR(d.start)}
                </ThemedText>
                <Button
                  label="Tirar"
                  variant="ghost"
                  size="sm"
                  onPress={() => setRascunhos((r) => r.filter((_, j) => j !== i))}
                />
              </View>
            ))
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Suponha uma entrada ou uma saída — uma vez, parcelada ou todo mês — e veja os
              meses recalculados como se você tivesse lançado de verdade.
            </ThemedText>
          )}

          {/* Falhou o cálculo? DIZ. Cair calado na projeção real mostraria o número sem a
              hipótese, com o rótulo por cima jurando que está simulando. */}
          {simulado.isError ? (
            <ErrorBand
              message="Não deu para calcular o rascunho — os números acima são os reais."
              onRetry={simulado.refetch}
            />
          ) : null}

          <Button
            label={simulando ? 'Somar outra suposição' : 'Supor um lançamento'}
            variant={simulando ? 'secondary' : 'primary'}
            size="sm"
            onPress={() => {
              setNovoTipo('income');
              setNovoValor(0);
              setNovoMes(currentMonth());
              setNovoParcelas(1);
              setNovoModo('total');
              setSheetAberto(true);
            }}
          />

          {simulando ? (
            <ThemedText type="caption" themeColor="textSecondary">
              Move o caixa. Não remonta fatura de cartão, orçamento nem cronograma de dívida.
              Sair da tela apaga.
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      {/*
        Dia × Mês. Governa só o que vem ABAIXO — o destaque e o simulador continuam nos dois
        modos, porque respondem a pergunta de entrada da tela em qualquer recorte.
      */}
      {!nadaParaProjetar && serie.length > 0 ? (
        <View style={styles.modo}>
          <Segmented
            options={[
              { value: 'dia', label: 'Dia' },
              { value: 'mes', label: 'Mês' },
            ]}
            value={modo}
            onChange={(v) => setModo(v)}
          />
        </View>
      ) : null}

      {modo === 'mes' && !nadaParaProjetar ? (
        <Section title="Saldo mês a mês, carregando a sobra">
          {meses.map((m) => (
            <View key={m.mes}>
              {/*
                A linha do corte: daqui para baixo a recorrente não é mais lançamento criado
                pelo cron, é a regra expandida (migration 20260910140000). O número continua
                válido; o que muda é a natureza dele, e o usuário tem direito de saber onde.
              */}
              {corte && m.mes > corte && meses[meses.indexOf(m) - 1]?.mes === corte ? (
                <ThemedText type="caption" themeColor="textSecondary" style={styles.corte}>
                  ─── daqui em diante é projetado da regra, não lançamento criado
                </ThemedText>
              ) : null}
              <Row
                title={monthTitle(m.mes)}
                subtitle={
                  (m.parcial ? 'de hoje até o fim do mês · ' : '') +
                  `veio de ${formatBRL(veioDe(m))} · entra ${formatBRL(m.entra)} · sai ${formatBRL(m.sai)}` +
                  (m.primeiroNegativo ? ` · no vermelho em ${isoToBR(m.primeiroNegativo)}` : '')
                }
                accessibilityLabel={`${monthTitle(m.mes)}, veio de ${formatBRL(veioDe(m))}, entra ${formatBRL(m.entra)}, sai ${formatBRL(m.sai)}, sobra ${formatBRL(m.saldo)}`}
                accessibilityState={{ expanded: mesAberto === m.mes }}
                onPress={() => setMesAberto(mesAberto === m.mes ? null : m.mes)}
                trailing={
                  <Money
                    cents={m.saldo}
                    variant="subhead"
                    tone={m.saldo < 0 ? 'danger' : 'text'}
                  />
                }
              />

              {mesAberto === m.mes ? (
                <Animated.View
                  entering={FadeIn.duration(Motion.duration.fast)}
                  style={styles.expandido}>
                  {resumoAberto.isError ? (
                    <ErrorBand
                      message="Não deu para abrir esse mês."
                      onRetry={resumoAberto.refetch}
                    />
                  ) : resumoAberto.isLoading || !resumoAberto.data ? (
                    <>
                      <Skeleton height={14} width="70%" />
                      <Skeleton height={14} width="55%" />
                    </>
                  ) : (
                    <>
                      <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                        fixas {formatBRL(Number(resumoAberto.data.fixas_cents))} · parcelas{' '}
                        {formatBRL(Number(resumoAberto.data.parcelas_cents))} · variáveis{' '}
                        {formatBRL(Number(resumoAberto.data.variaveis_cents))}
                      </ThemedText>
                      <Button
                        label="Ver todos os lançamentos"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          router.push({ pathname: '/finance/month', params: { month: m.mes } })
                        }
                      />
                    </>
                  )}
                </Animated.View>
              ) : null}
            </View>
          ))}
        </Section>
      ) : null}

      {modo === 'dia' && bills.isError ? (
        <ErrorBand message="Não deu para carregar o que vence." onRetry={bills.refetch} />
      ) : null}

      {/* `!bills.isError`: o `data` do TanStack sobrevive ao erro de refetch, e sem isso a lista
          de "Atrasado" continuava oferecendo "Pagar fatura" logo abaixo da faixa que acabou de
          dizer que não conseguiu carregar o que vence — com um botão que escreve no banco. */}
      {modo === 'dia' && !bills.isError && atrasadas.length > 0 ? (
        <Section title="Atrasado">{atrasadas.map(linhaConta)}</Section>
      ) : null}
      {modo === 'dia' && !bills.isError && aVencer.length > 0 ? (
        <Section title="O que vence">{aVencer.map(linhaConta)}</Section>
      ) : null}
      {/*
        O par de "O que vence". Vem DEPOIS de propósito: quem abre esta tela vem perguntar se o
        dinheiro dá, e a resposta é o que sai. O que entra é a segunda metade da conta.
      */}
      {modo === 'dia' && !bills.isError && aReceber.length > 0 ? (
        <Section title="O que entra">{aReceber.map(linhaConta)}</Section>
      ) : null}

      {modo === 'dia' &&
      !bills.isLoading &&
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
      {/*
        A suposição. `formSheet` porque é tarefa curta com Cancelar/Somar próprios (design.md §8),
        e nada aqui escreve no banco — o "Somar" só empilha no estado local.
      */}
      <Sheet visible={sheetAberto} onClose={() => setSheetAberto(false)}>
        <View style={styles.sheetCabecalho}>
          <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setSheetAberto(false)}>
            <ThemedText type="default" themeColor="tint">
              Cancelar
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold">Supor um lançamento</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: novoValor <= 0 || novoMes === null }}
            disabled={novoValor <= 0 || novoMes === null}
            hitSlop={12}
            onPress={() => {
              if (novoValor <= 0 || novoMes === null) return;
              // Dia 1 do mês escolhido — a granularidade da pergunta é o MÊS ("quanto eu fico
              // em novembro"), e fingir precisão de dia num número inventado é falsa exatidão.
              //
              // ⚠️ Mas nunca ANTES de hoje: a projeção começa hoje, e uma hipótese datada no
              // passado entra no saldo (o delta vale para todo dia >= início) sem ter um dia na
              // janela para aparecer em "entra/sai" — o destaque subia e a linha de fluxo
              // continuava zerada, que foi o que apareceu na verificação de 10/09/2026.
              const primeiroDia = `${novoMes}-01`;
              const inicio = primeiroDia < localISODate() ? localISODate() : primeiroDia;
              setRascunhos((r) => [
                ...r,
                {
                  kind: novoTipo,
                  amount_cents: novoValor,
                  start: inicio,
                  installments: novoModo === 'monthly' ? 1 : novoParcelas,
                  mode: novoModo,
                },
              ]);
              // ⚠️ Supor num mês além do horizonte aberto estica o horizonte.
              //
              // Sem isto, a hipótese entrava na conta e o usuário não via NADA mudar: a janela
              // de 90 dias não alcança agosto de 2028, e a tabela mês a mês só desenha o que
              // está na série. O rascunho pareceria ter sido ignorado.
              const alvo = new Date(Number(novoMes.slice(0, 4)), Number(novoMes.slice(5, 7)), 0);
              const precisa = Math.ceil((alvo.getTime() - Date.now()) / 86400000);
              const maior = HORIZONTES.filter((h) => h.dias >= precisa).at(0) ?? HORIZONTES.at(-1)!;
              if (maior.dias > dias) setDias(maior.dias);

              setSheetAberto(false);
              setModo('mes');
            }}>
            <ThemedText
              type="smallBold"
              themeColor={novoValor <= 0 || novoMes === null ? 'textSecondary' : 'tint'}>
              Somar
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.sheetCorpo}>
          <Field label="É entrada ou saída?">
            <Segmented
              options={[
                { value: 'income', label: 'Entra' },
                { value: 'expense', label: 'Sai' },
              ]}
              value={novoTipo}
              onChange={(v) => setNovoTipo(v)}
            />
          </Field>

          {/*
            ⚠️ Vem ANTES do valor e das parcelas de propósito (`frontend.md`): é o controle que
            muda o SIGNIFICADO do valor e quais campos existem abaixo. Depois deles, a tela se
            remontaria debaixo do dedo.
          */}
          <Field label="Acontece uma vez ou todo mês?">
            <Segmented
              options={[
                { value: 'total', label: 'Uma vez' },
                { value: 'monthly', label: 'Todo mês' },
              ]}
              value={novoModo}
              onChange={(v) => setNovoModo(v)}
            />
          </Field>

          <Field label={novoModo === 'monthly' ? 'Valor por mês' : 'Valor'}>
            <MoneyField valueCents={novoValor} onChangeCents={setNovoValor} autoFocus />
          </Field>

          {/*
            ⚠️ `MonthPicker`, não `SelectField`.
            
            O seletor listava os meses DA JANELA aberta — com o horizonte em 90 dias, quatro
            opções, e supor uma receita em 2028 era impossível mesmo com a projeção sabendo
            chegar lá. E uma lista de 36 meses aberta no lugar comeria a tela inteira.
            
            `MonthPicker` já existe para exatamente isto: setas de mês, escolha de ano, uma
            linha só. É o mesmo controle de "O mês inteiro", então o gesto já é conhecido.
          */}
          <Field label="A partir de qual mês">
            <MonthPicker month={novoMes ?? currentMonth()} onChange={setNovoMes} />
          </Field>

          {/* Parcelar só faz sentido em "uma vez": "todo mês" já é a repetição. */}
          {novoModo === 'total' ? (
            <Field label="Em quantas vezes">
              <Segmented
                options={PARCELAS.map((n) => ({ value: String(n), label: `${n}x` }))}
                value={String(novoParcelas)}
                onChange={(v) => setNovoParcelas(Number(v))}
              />
            </Field>
          ) : null}

          <ThemedText type="caption" themeColor="textSecondary">
            {novoModo === 'monthly'
              ? 'Repete todo mês até o fim da projeção. '
              : ''}
            Some ao seu fluxo real — saldo de hoje, faturas, parcelas, financiamentos e
            recorrentes — e recalcula os meses daqui para frente. Sair da tela apaga.
          </ThemedText>
        </View>
      </Sheet>

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
  modo: {
    marginTop: Space.xs,
  },
  rascunhoFaixa: {
    gap: Space.sm,
  },
  rascunhoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  rascunhoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  sheetCorpo: {
    gap: Space.md,
    padding: Space.lg,
  },
  sheetCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  corte: {
    paddingHorizontal: Space.md,
    paddingTop: Space.sm,
    paddingBottom: Space.xs,
  },
  expandido: {
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingBottom: Space.md,
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
