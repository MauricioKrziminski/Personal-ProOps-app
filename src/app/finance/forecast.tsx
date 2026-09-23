import { useEffect, useRef, useState, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { useBRL } from '@/components/ui/conceal';
import { FinanceAnalysisPanes } from '@/components/finance/finance-analysis-panes';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/finance/chip';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { MonthRuler, useMonthRuler } from '@/components/finance/month-ruler';
import { Calendar } from '@/components/finance/calendar';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Skeleton, SkeletonChart, SkeletonList } from '@/components/ui/skeleton';
import { MeasuredSparkline } from '@/components/ui/measured-sparkline';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useAnticipationCandidates,
  useCashFlowForecast,
  useCashHistory,
  useForecastMonths,
  useForecastWithDrafts,
  useMarkPaid,
  useMonthSummary,
  useUpcomingBills,
  type Draft,
} from '@/hooks/use-finance';
import { useTelaPronta } from '@/hooks/use-tela-pronta';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useTheme } from '@/hooks/use-theme';
import { MonthPicker, currentMonth, monthTitle } from '@/components/finance/month-picker';
import { mesDoCorte, veioDe, type MesProjetado } from '@/lib/forecast-months';
import {
  diasAte,
  formatBRL,
  isoToBR,
  localISODate,
  somaDias,
} from '@/lib/dates';
import { showItemActions } from '@/lib/item-actions';
import {
  agruparHipoteses,
  draftsDoAdiantamento,
  quantasQueCabem,
  substituirGrupo,
  escolherParcelas,
  ultimoDia,
  valorSugerido,
  type Quais,
} from '@/lib/anticipation';
import { AdiantarCampos } from '@/components/finance/anticipation-fields';
import { QuantityField } from '@/components/ui/quantity-field';
import { faixaDeParcelas } from '@/lib/finance-form';
import { settleDone, settleLabel } from '@/lib/settle-labels';

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
/**
 * A legenda de um ciclo, e por que a PRIMEIRA linha fala diferente das outras.
 *
 * A projeção começa HOJE, então o primeiro ciclo quase sempre está pela metade — e nele
 * "entra/sai" é o que ainda vai acontecer, não o ciclo inteiro. Escrito com as mesmas palavras
 * das outras linhas, um ciclo que já recebeu o salário no dia 20 aparece como
 * `Setembro · entra R$ 0,00`, e a leitura óbvia é *"o app perdeu meu salário"*. Ele não perdeu:
 * o salário já está DENTRO do "hoje você tem".
 *
 * A última linha tem o problema espelhado — ela é parcial porque o HORIZONTE corta ali, não
 * porque falta acontecer.
 */
function legendaDoMes(
  m: MesProjetado,
  primeiro: boolean,
  ultimo: boolean,
  // Helper de módulo: o formatador entra por parâmetro para a legenda obedecer ao "esconder saldo".
  brl: (cents: number) => string
): string {
  const janela = `${isoToBR(m.de)} a ${isoToBR(m.ate)}`;
  const vermelho = m.primeiroNegativo ? ` · no vermelho em ${isoToBR(m.primeiroNegativo)}` : '';

  if (primeiro && m.parcial) {
    return (
      `${janela} · hoje você tem ${brl(veioDe(m))}` +
      ` · ainda entra ${brl(m.entra)} · ainda sai ${brl(m.sai)}${vermelho}`
    );
  }
  const corte = ultimo && m.parcial ? ' · a projeção termina aqui' : '';
  return (
    `${janela} · veio de ${brl(veioDe(m))}` +
    ` · entra ${brl(m.entra)} · sai ${brl(m.sai)}${vermelho}${corte}`
  );
}

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


/** O dia do pagamento suposto: o 1º do mês escolhido — ou hoje, no mês corrente. */
function diaDoPagamento(mes: string | null): string {
  const primeiro = `${mes ?? currentMonth()}-01`;
  const hoje = localISODate();
  return primeiro < hoje ? hoje : primeiro;
}

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
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const theme = useTheme();
  const toast = useToast();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';

  const [dias, setDias] = useState(90);
  /**
   * Até quando projetar, escolhido à mão — o pedido foi *"deixar um filtro que ele seleciona a
   * data de quando até quando ele quer projetar"*.
   *
   * ⚠️ **O "de quando" tem UM valor certo e ele não é escolha: HOJE.** Uma projeção de caixa
   * parte do saldo que existe agora; começar em outra data exigiria um saldo daquela data, que
   * é justamente o que a projeção está calculando. Por isso o controle é "até", e a tela escreve
   * "de hoje até <data>" em vez de oferecer um campo que só aceita um valor.
   */
  const [horizonteAberto, setHorizonteAberto] = useState(false);
  /** O campo de data nasce fechado toda vez que o sheet abre — ver o comentário no `Sheet`. */
  const [calendarioAberto, setCalendarioAberto] = useState(false);
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
  const [novoTipo, setNovoTipo] = useState<'income' | 'expense' | 'adiantar'>('income');
  const [novoValor, setNovoValor] = useState(0);
  const [novoMes, setNovoMes] = useState<string | null>(null);
  const [novoParcelas, setNovoParcelas] = useState(1);
  const [novoModo, setNovoModo] = useState<'total' | 'monthly'>('total');
  /*
    Adiantar parcelas (spec 2026-09-21): QUAL item, QUANTAS parcelas, as últimas ou as
    próximas, e o valor a pagar — `null` segue a sugestão do banco (valor presente no
    financiamento); digitar fixa o valor até a escolha mudar, e a escolha nova volta à sugestão.
  */
  const [adiantarId, setAdiantarId] = useState<string | null>(null);
  const [adiantarQtd, setAdiantarQtd] = useState(1);
  const [adiantarQuais, setAdiantarQuais] = useState<Quais>('ultimas');
  const [adiantarValor, setAdiantarValor] = useState<number | null>(null);
  /**
   * O `grupo` da hipótese aberta para edição; `null` = o sheet cria uma nova.
   * Editar é refazer a hipótese com o formulário preenchido e TROCAR os drafts dela no mesmo
   * lugar da lista (`substituirGrupo`) — um adiantamento tem 1 + N drafts, e mexer draft a draft
   * deixaria parcela cancelada sem o pagamento, ou o contrário.
   */
  const [editando, setEditando] = useState<string | null>(null);

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
  const regua = useMonthRuler();
  const mensal = useForecastMonths(dias, rascunhos, emMes, regua.view);
  const simulando = rascunhos.length > 0;
  const hipoteses = useMemo(() => agruparHipoteses(rascunhos), [rascunhos]);

  const pagarEm = diaDoPagamento(novoMes);
  const adiantaveis = useAnticipationCandidates(pagarEm, sheetAberto && novoTipo === 'adiantar');
  const itemAdiantar = adiantaveis.data?.find((i) => i.ref_id === adiantarId) ?? null;
  // A quantidade ASSENTA no que ainda vence depois do pagamento (`quantasQueCabem`): trocar o
  // mês para mais tarde diminui o número na tela, em vez de travar a hipótese com um erro.
  const qtdAdiantar = quantasQueCabem(itemAdiantar, adiantarQtd);
  const parcelasAdiantar = itemAdiantar ? escolherParcelas(itemAdiantar, qtdAdiantar, adiantarQuais) : [];
  const valorAdiantar = adiantarValor ?? valorSugerido(parcelasAdiantar);
  const podeAplicar = novoTipo === 'adiantar'
    ? parcelasAdiantar.length > 0 && valorAdiantar > 0
    : novoValor > 0 && novoMes !== null;
  // `?? forecast.data` enquanto a simulação carrega: sem isso a tela PISCA vazia a cada
  // suposição somada, e o destaque salta de um número real para nada e de volta.
  const serie = (simulando ? (simulado.data ?? forecast.data) : forecast.data) ?? [];
  const meses: MesProjetado[] = useMemo(() => mensal.data?.meses ?? [], [mensal.data]);

  /**
   * A lista de meses SEM o ciclo que o horizonte cortou no meio.
   *
   * ⚠️ **Um ciclo pela metade não é um mês, e mostrá-lo como mês MENTE.** Com horizonte de 90
   * dias a partir de 14/09, a janela termina em 13/12 — e o ciclo "Janeiro de 2027" começa em
   * 11/12. Sobravam 3 dias, nenhum deles com lançamento, e a tela escrevia
   * `Janeiro de 2027 · entra R$ 0,00 · sai R$ 0,00`, que se lê como "janeiro não tem salário".
   * Não tem: pedindo 420 dias o mesmo janeiro devolve `entra 7.566,52 · sai 5.965,40`.
   *
   * O caso silencioso é pior que o zero: com o corte caindo no meio do ciclo, `entra`/`sai` vêm
   * NÃO-nulos e incompletos — um mês que parece só barato.
   *
   * ⚠️ **Só a LISTA perde a linha; `meses` continua inteiro** para o gráfico e para o "no fim do
   * período". O saldo do ciclo cortado é o saldo real no fim do horizonte; o que não vale é o
   * `entra`/`sai` dele. O primeiro mês também é `parcial` (começou antes de hoje) e continua —
   * ali a metade que falta já passou, e a legenda diz "ainda entra / ainda sai".
   */
  const mesesInteiros = useMemo(() => {
    const ultimo = meses[meses.length - 1];
    return ultimo && meses.length > 1 && ultimo.parcial ? meses.slice(0, -1) : meses;
  }, [meses]);
  const cicloCortado = meses.length > mesesInteiros.length ? meses[meses.length - 1] : null;

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
  const projecaoCarregando = emMes
    ? mensal.isLoading || mensal.isPlaceholderData
    : forecast.isLoading;
  const nadaParaProjetar =
    !projecaoCarregando &&
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

  const pagar = (id: string, titulo: string, kind: string | null | undefined) =>
    markPaid.mutate(
      { id, paidAt: localISODate() },
      {
        onSuccess: () => toast({ message: `${titulo}: ${settleDone(kind)}.`, tone: 'success' }),
        // otimista sem rollback visível faz o usuário achar que pagou
        onError: () => toast({ message: `Não deu para dar baixa em ${titulo}.`, tone: 'error' }),
      }
    );


  /** O último dia da projeção — o que o sheet marca no calendário e escreve no subtítulo. */
  const ate = somaDias(localISODate(), dias);

  /** Atalho e calendário desembocam aqui: aplicam e fecham, num gesto só. */
  const aplicarHorizonte = (d: number) => {
    setDias(Math.min(Math.max(d, 1), 3650));
    setCalendarioAberto(false);
    setHorizonteAberto(false);
  };

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
                    onPress: () => pagar(b.ref_id, b.title, b.kind),
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

  /** Grava a hipótese: nova vai para o fim; editada troca a antiga no mesmo lugar. */
  const gravar = (novos: Draft[]) =>
    setRascunhos((anteriores) =>
      editando ? substituirGrupo(anteriores, editando, novos) : [...anteriores, ...novos]);

  /** Adicionar mais uma prepara outra hipótese; ver resultado inclui a atual e encerra a montagem. */
  const aplicarSuposicao = (verResultado: boolean) => {
    // ⚠️ Não só o relógio: `h${Date.now()}` dava o MESMO grupo a duas hipóteses criadas no mesmo
    // milissegundo, e elas viravam uma linha só (e "Tirar" levava as duas). Era a intermitência
    // de `simple-finance-ui.test.ts` ("esperava 2 hipóteses, veio 1"), anterior a 22/09/2026.
    const grupo = editando ?? `h${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // editar sempre fecha: "Salvar" é o único caminho da edição
    const fecha = verResultado || editando !== null;
    if (novoTipo === 'adiantar') {
      if (!itemAdiantar || !podeAplicar) {
        if (verResultado && rascunhos.length > 0) {
          setSheetAberto(false);
          setModo('mes');
        }
        return;
      }
      gravar(draftsDoAdiantamento(itemAdiantar, parcelasAdiantar, valorAdiantar, pagarEm, grupo,
        { quantas: qtdAdiantar, quais: adiantarQuais }));
      // O ganho de adiantar "as últimas" está no FIM do contrato: a janela vai até a última
      // parcela tirada, senão a projeção mostraria só o custo.
      const precisa = diasAte(ultimoDia(parcelasAdiantar, pagarEm));
      const maior = HORIZONTES.find((h) => h.dias >= precisa) ?? HORIZONTES[HORIZONTES.length - 1];
      if (maior.dias > dias) setDias(maior.dias);
      Haptics.selectionAsync();
      setAdiantarId(null);
      setAdiantarValor(null);
      if (fecha) {
        setSheetAberto(false);
        setEditando(null);
        setModo('mes');
      }
      return;
    }
    if (novoValor <= 0 || novoMes === null) {
      if (verResultado && rascunhos.length > 0) {
        setSheetAberto(false);
        setModo('mes');
      }
      return;
    }
    const primeiroDia = `${novoMes}-01`;
    // A projeção começa hoje: uma hipótese no mês atual não pode entrar no passado.
    const inicio = primeiroDia < localISODate() ? localISODate() : primeiroDia;
    const hipotese: Draft = {
      kind: novoTipo,
      amount_cents: novoValor,
      start: inicio,
      installments: novoModo === 'monthly' ? 1 : novoParcelas,
      mode: novoModo,
      grupo,
    };
    gravar([hipotese]);

    // Uma hipótese num mês distante precisa ampliar a janela para aparecer no resultado.
    const alvo = new Date(Number(novoMes.slice(0, 4)), Number(novoMes.slice(5, 7)), 0);
    const precisa = Math.ceil((alvo.getTime() - Date.now()) / 86400000);
    const maior = HORIZONTES.find((h) => h.dias >= precisa) ?? HORIZONTES[HORIZONTES.length - 1];
    if (maior.dias > dias) setDias(maior.dias);

    Haptics.selectionAsync();
    setNovoValor(0);
    if (fecha) {
      setSheetAberto(false);
      setEditando(null);
      setModo('mes');
    }
  };

  const abrirNova = () => {
    setEditando(null);
    setNovoTipo('income');
    setNovoValor(0);
    setNovoMes(currentMonth());
    setNovoParcelas(1);
    setNovoModo('total');
    setAdiantarId(null);
    setAdiantarValor(null);
    setSheetAberto(true);
  };

  /** Abre o sheet com a hipótese do jeito que ela foi feita. */
  const abrirEdicao = (grupo: string, d: Draft) => {
    setEditando(grupo);
    setNovoMes(d.start.slice(0, 7));
    if (d.adiantar) {
      setNovoTipo('adiantar');
      setAdiantarId(d.adiantar.ref_id);
      setAdiantarQtd(d.adiantar.quantas);
      setAdiantarQuais(d.adiantar.quais);
      // o valor que a pessoa aprovou — escolher outra coisa volta à sugestão
      setAdiantarValor(d.amount_cents);
    } else {
      setNovoTipo(d.kind);
      setNovoValor(d.amount_cents);
      setNovoModo(d.mode === 'monthly' ? 'monthly' : 'total');
      setNovoParcelas(d.installments);
    }
    setSheetAberto(true);
  };

  const tirarEditando = () => {
    if (!editando) return;
    setRascunhos((r) => r.filter((d) => d.grupo !== editando));
    setEditando(null);
    setSheetAberto(false);
  };

  /*
    O PORTÃO DA TELA (Fase 5) — 8 consultas, 5 portões antes disto.

    ⚠️ **`forecast`, `simulado` e `historico` alternam por `!emMes`**, então uma delas está sempre
    desligada. `simulado` fica FORA da lista (ela só existe com rascunho); as outras duas entram,
    e a que estiver desligada é resolvida pelo `fetchStatus` em vez de prender a tela.
  */
  const pronta = useTelaPronta(forecast, bills, accounts, mensal, historico, mesCorrente);

  if (!pronta) {
    return (
      <Screen grouped>
        <SkeletonChart altura={168} />
        <SkeletonList linhas={3} />
        <SkeletonList linhas={2} />
      </Screen>
    );
  }

  const curveDecision = (emMes ? mensal.isError : forecast.isError) ? (
    <ErrorBand
      message="Não deu para carregar a projeção."
      onRetry={emMes ? mensal.refetch : forecast.refetch}
    />
  ) : (projecaoCarregando || (emMes ? meses.length > 0 : serie.length > 0)) && !nadaParaProjetar ? (
    <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
      <Card style={styles.hero}>
        {projecaoCarregando ? (
          <>
            <Skeleton width="72%" height={24} />
            <Skeleton height={96} radius={Radius.sm} />
            <Skeleton width="65%" height={32} />
            <View style={styles.heroSplit}>
              <Skeleton width="36%" height={58} />
              <Skeleton width="36%" height={58} />
            </View>
            <Skeleton width="60%" height={18} />
          </>
        ) : (
          <>
            <View style={styles.heroTitulo}>
              {primeiroNegativo ? <Icon name="exclamationmark.triangle" size="md" color="danger" /> : null}
              <ThemedText
                type="smallBold"
                themeColor={primeiroNegativo ? 'danger' : 'text'}
                style={styles.heroTexto}>
                {primeiroNegativo
                  ? `Você fica no vermelho em ${isoToBR(primeiroNegativo)}`
                  : `Não fica negativo nos próximos ${rotuloHorizonte(dias)}`}
              </ThemedText>
            </View>
            <View
              accessible
              accessibilityLabel={`Saldo hoje ${formatBRL(hoje)}, no fim do período ${formatBRL(fim)}${primeiroNegativo ? `, negativo a partir de ${isoToBR(primeiroNegativo)}` : ''}`}>
              <MeasuredSparkline
                values={valores}
                height={96}
                showZero
                pastCount={passado.length + 1}
              />
            </View>
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
            {entra > 0 || sai > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
                entra {brl(entra)} · sai {brl(sai)} em {rotuloHorizonte(dias)}
              </ThemedText>
            ) : null}
          </>
        )}
      </Card>
    </Animated.View>
  ) : null;

  const scenario = !nadaParaProjetar ? (
    <Card style={styles.simulador}>
      <View style={styles.rascunhoTopo}>
        <Icon
          name={simulando ? 'pencil.and.outline' : 'questionmark.circle'}
          size="md"
          color={simulando ? 'warning' : 'textSecondary'}
        />
        <View style={styles.rascunhoTitulo}>
          <ThemedText type="smallBold">
            {simulando ? 'Rascunho' : 'E se…?'}
          </ThemedText>
          {simulando ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {hipoteses.length} {hipoteses.length === 1 ? 'hipótese' : 'hipóteses'} · temporário
            </ThemedText>
          ) : null}
        </View>
      </View>
      {simulando ? (
        hipoteses.map(({ chave, principal: d }) => {
          const texto = d.rotulo
            ? `sai ${brl(d.amount_cents)} · ${d.rotulo} · em ${isoToBR(d.start)}`
            : `${d.kind === 'income' ? 'entra' : 'sai'} ${brl(d.amount_cents)}${
                d.mode === 'monthly' ? ' todo mês' : d.installments > 1 ? ` em ${d.installments}x` : ''
              } · a partir de ${isoToBR(d.start)}`;
          return (
            // A linha É o botão de editar: um botão por linha ("Tirar") poluía o card, e tirar
            // mora no sheet de edição, ao lado do que se está desistindo.
            <Pressable
              key={chave}
              accessibilityRole="button"
              accessibilityLabel={`Editar hipótese: ${texto}`}
              onPress={() => abrirEdicao(chave, d)}
              style={({ pressed }) => [
                styles.rascunhoLinha,
                {
                  borderTopColor: theme.separator,
                  backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                },
              ]}>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                style={[tabular, styles.rascunhoDescricao]}>
                {texto}
              </ThemedText>
              <Icon name="chevron.right" size="sm" color="textSecondary" />
            </Pressable>
          );
        })
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Suponha uma entrada, uma saída ou adiantar parcelas, e veja os meses recalculados
          como se tivesse acontecido de verdade.
        </ThemedText>
      )}
      {simulado.isError ? (
        <ErrorBand
          message="Não deu para calcular o rascunho — os números acima são os reais."
          onRetry={simulado.refetch}
        />
      ) : null}
      <View style={styles.rascunhoAcoes}>
        <Button
          label={simulando ? 'Adicionar outra hipótese' : 'Supor um lançamento'}
          variant={simulando ? 'secondary' : 'primary'}
          size="sm"
          onPress={abrirNova}
        />
        {simulando ? (
          <Button label="Limpar" variant="secondary" size="sm" onPress={() => setRascunhos([])} />
        ) : null}
      </View>
      {simulando ? (
        <ThemedText type="caption" themeColor="textSecondary">
          Só muda esta projeção. Nada é salvo.
        </ThemedText>
      ) : null}
    </Card>
  ) : null;

  return (
    <Screen wide={tablet}
      stagger
      grouped
      onRefresh={() => Promise.all([forecast.refetch(), bills.refetch(), accounts.refetch(), historico.refetch()])}>
      <Stack.Screen
        options={{
          title: 'Projeção',
        }}
      />

      <HeaderActions
        actions={[
          {
            label: `Horizonte da projeção, de hoje até ${isoToBR(somaDias(localISODate(), dias))}`,
            icon: 'calendar',
            onPress: () => {
              setCalendarioAberto(false);
              setHorizonteAberto(true);
            },
          },
        ]}
      />

      <Sheet visible={horizonteAberto} onClose={() => setHorizonteAberto(false)}>
        <TaskHeader
          title="Até quando projetar"
          subtitle={`de hoje até ${isoToBR(ate)}`}
          onClose={() => setHorizonteAberto(false)}
        />

        {/*
          ⚠️ **Atalhos abertos, calendário COLAPSADO** (11/09/2026, pedido do dono do produto:
          *"pedi para que fosse um campo, que ao clicar ele expandisse, e ao selecionar ou fechar
          ele, ele voltasse a colapsar"*).

          É o mesmo idioma do `SelectField` (design.md §1): campo de formulário mostra o VALOR, e
          a lista — aqui a grade de dias — é o que aparece quando se vai trocá-lo. Ele abre NO
          LUGAR e não em `Modal`, porque já estamos dentro de um `Sheet`.

          Eu tinha argumentado contra, com o motivo errado: o sheet tem altura fixa, então
          colapsar não encolhe o sheet. Só que o que sobra fechado é ESPAÇO, e o que sobrava
          aberto era uma grade de 42 células competindo com os oito atalhos — duas respostas
          para a mesma pergunta, as duas gritando.

          O estado morre junto com o sheet: abrir de novo mostra o campo fechado.
        */}
        <ScrollView contentContainerStyle={styles.horizonteCorpo}>
          <View style={styles.horizonteAtalhos}>
            {HORIZONTES.map((h) => (
              <Chip
                key={h.dias}
                label={h.label}
                selected={h.dias === dias}
                onPress={() => aplicarHorizonte(h.dias)}
              />
            ))}
          </View>

          <Section>
            <Row
              title="Outra data"
              subtitle={isoToBR(ate)}
              chevron={false}
              accessibilityState={{ expanded: calendarioAberto }}
              accessibilityLabel={`Outra data, ${isoToBR(ate)}`}
              trailing={
                <Icon
                  name={calendarioAberto ? 'chevron.up' : 'chevron.down'}
                  size="sm"
                  color="textSecondary"
                />
              }
              onPress={() => {
                Haptics.selectionAsync();
                setCalendarioAberto((aberto) => !aberto);
              }}
            />
            {calendarioAberto ? (
              <Calendar
                value={ate}
                onChange={(iso) => aplicarHorizonte(diasAte(iso))}
                // Hoje não é horizonte (a projeção precisa de pelo menos um dia à frente), e o
                // teto é o mesmo `clamp_forecast_days` do banco — 10 anos.
                min={somaDias(localISODate(), 1)}
                max={somaDias(localISODate(), 3650)}
              />
            ) : null}
          </Section>
        </ScrollView>
      </Sheet>

      {curveDecision || scenario ? (
        <FinanceAnalysisPanes
          primary={curveDecision}
          support={scenario}
          compact={<>{curveDecision}{scenario}</>}
        />
      ) : null}

      {/*
        Por dia × Por mês. Governa só o que vem ABAIXO — o destaque e o simulador continuam nos
        dois modos, porque respondem a pergunta de entrada da tela em qualquer recorte.

        ⚠️ **Os dois controles numa LINHA, e o da esquerda deixou de dizer "Mês".** Empilhados e
        sem `gap`, eles liam como um controle partido ao meio — a mesma queixa do seletor de
        período ("grudado sem gap nenhum"). Pior: lado a lado, a palavra "Mês" aparecia nos DOIS
        querendo dizer coisas diferentes — à esquerda é a GRANULARIDADE da série (um ponto por
        dia ou por mês), à direita é a BORDA do mês (civil ou ciclo).

        Quem muda de rótulo é o da esquerda, porque ele é local a esta tela; a régua fala a mesma
        língua em sete telas, e mudar o texto só aqui criaria dois nomes para a mesma intenção
        (contagem anti-slop §10).
      */}
      {!nadaParaProjetar && (projecaoCarregando || (emMes ? meses.length > 0 : serie.length > 0)) ? (
        <View style={styles.modo}>
          <View style={styles.modoGranularidade}>
            <Segmented
              options={[
                { value: 'dia', label: 'Por dia' },
                { value: 'mes', label: 'Por mês' },
              ]}
              value={modo}
              onChange={(v) => setModo(v)}
            />
          </View>
          {/* A régua qualifica só o modo Mês: no modo Dia a série é diária e não tem borda de
              mês para escolher. */}
          {modo === 'mes' ? (
            <MonthRuler value={regua.view} onChange={regua.setView} visible={regua.temCiclo} />
          ) : null}
        </View>
      ) : null}

      {modo === 'mes' && !nadaParaProjetar ? (
        <Section title="Saldo mês a mês, carregando a sobra">
          {mesesInteiros.map((m, iMes) => (
            <View key={m.mes}>
              {/*
                A linha do corte: daqui para baixo a recorrente não é mais lançamento criado
                pelo cron, é a regra expandida (migration 20260910140000). O número continua
                válido; o que muda é a natureza dele, e o usuário tem direito de saber onde.
              */}
              {corte && m.mes > corte && mesesInteiros[iMes - 1]?.mes === corte ? (
                <ThemedText type="caption" themeColor="textSecondary" style={styles.corte}>
                  ─── daqui em diante é projetado da regra, não lançamento criado
                </ThemedText>
              ) : null}
              <Row
                title={monthTitle(m.mes)}
                subtitle={legendaDoMes(m, iMes === 0, iMes === meses.length - 1, brl)}
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
                  {/*
                    ⚠️ **O expandido NÃO lê `month_summary`.** Aquela RPC conta o cartão na data
                    da COMPRA, e este mês foi projetado pela data do PAGAMENTO: o recorte abria
                    debaixo do número e dizia outra coisa, na mesma tela. Quem detalha o que está
                    dentro do ciclo é a tela do ciclo, que soma exatamente este número.
                  */}
                  <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                    entra {brl(m.entra)} · sai {brl(m.sai)}
                  </ThemedText>
                  <Button
                    label="Ver tudo que está aqui dentro"
                    variant="secondary"
                    size="sm"
                    onPress={() =>
                      router.push({
                        pathname: '/finance/cycle',
                        params: { month: m.mes, view: regua.view, tipo: 'sai' },
                      })
                    }
                  />
                </Animated.View>
              ) : null}
            </View>
          ))}
          {cicloCortado ? (
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.corte}>
              {`A projeção para em ${isoToBR(cicloCortado.de)}. O ciclo seguinte entraria pela metade — aumente o horizonte para vê-lo inteiro.`}
            </ThemedText>
          ) : null}
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
      {/* Ambas as ações existem desde a primeira hipótese; adicionar mais uma mantém o formulário aberto. */}
      <Sheet visible={sheetAberto} onClose={() => { setSheetAberto(false); setEditando(null); }}>
        <TaskHeader
          title={editando ? 'Editar hipótese' : 'Nova hipótese'}
          subtitle={!editando && simulando ? `${hipoteses.length} ${hipoteses.length === 1 ? 'hipótese no cenário' : 'hipóteses no cenário'}` : undefined}
          onClose={() => { setSheetAberto(false); setEditando(null); }}
          action={
            <Button
              label={editando ? 'Salvar' : 'Ver resultado'}
              size="sm"
              disabled={editando ? !podeAplicar : !simulando && !podeAplicar}
              onPress={() => aplicarSuposicao(true)}
            />
          }
        />

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetCorpo}>
          <Field label="O que você quer supor?">
            <Segmented
              options={[
                { value: 'income', label: 'Entra' },
                { value: 'expense', label: 'Sai' },
                { value: 'adiantar', label: 'Adiantar' },
              ]}
              value={novoTipo}
              onChange={(v) => setNovoTipo(v)}
            />
          </Field>

          {novoTipo === 'adiantar' ? (
            <AdiantarCampos
              consulta={adiantaveis}
              item={itemAdiantar}
              itemId={adiantarId}
              onItem={(id) => {
                setAdiantarId(id);
                setAdiantarQtd(1);
                setAdiantarQuais('ultimas');
                setAdiantarValor(null);
              }}
              quantas={qtdAdiantar}
              onQuantas={(n) => {
                setAdiantarQtd(n);
                setAdiantarValor(null);
              }}
              quais={adiantarQuais}
              onQuais={(q) => {
                setAdiantarQuais(q);
                setAdiantarValor(null);
              }}
              mes={novoMes}
              onMes={(m) => {
                setNovoMes(m);
                setAdiantarValor(null);
              }}
              parcelas={parcelasAdiantar}
              valor={valorAdiantar}
              onValor={setAdiantarValor}
            />
          ) : (
          <>

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
            linha só. É o mesmo controle de "Entradas e saídas", então o gesto já é conhecido.
          */}
          <Field label="A partir de qual mês">
            <MonthPicker month={novoMes ?? currentMonth()} onChange={setNovoMes} />
          </Field>

          {/* Parcelar só faz sentido em "uma vez": "todo mês" já é a repetição. */}
          {novoModo === 'total' ? (
            <Field label="Em quantas vezes">
              {/* O mesmo campo aberto do lançamento (`faixaDeParcelas`): lista fixa não deixava 5x. */}
              <QuantityField
                value={novoParcelas}
                min={faixaDeParcelas(0).min}
                max={faixaDeParcelas(0).max}
                accessibilityLabel="Em quantas vezes"
                onChange={setNovoParcelas}
              />
            </Field>
          ) : null}
          </>
          )}

          {editando ? (
            <Button
              label="Tirar hipótese"
              variant="secondary"
              tone="danger"
              block
              style={styles.sheetAction}
              onPress={tirarEditando}
            />
          ) : (
            <Button
              label="Adicionar mais uma"
              icon="plus"
              variant="secondary"
              block
              style={styles.sheetAction}
              disabled={!podeAplicar}
              onPress={() => aplicarSuposicao(false)}
            />
          )}
        </ScrollView>
      </Sheet>

    </Screen>
  );
}

const styles = StyleSheet.create({
  horizonteCorpo: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xl,
    gap: Space.lg,
  },
  horizonteAtalhos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    // A 384dp × fonte 1,3 os dois não cabem lado a lado; a régua desce em vez de espremer.
    flexWrap: 'wrap',
  },
  // Come a sobra da linha: a régua tem largura fixa, a granularidade fica com o resto.
  modoGranularidade: { flex: 1, minWidth: 160 },
  rascunhoFaixa: {
    gap: Space.sm,
  },
  rascunhoTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  rascunhoTitulo: {
    flex: 1,
    gap: Space.half,
  },
  rascunhoLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingTop: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rascunhoDescricao: {
    flex: 1,
  },
  rascunhoAcoes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  sheetCorpo: {
    gap: Space.md,
    padding: Space.lg,
  },
  sheetAction: {
    marginTop: Space.sm,
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
