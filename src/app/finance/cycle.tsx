import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useBRL } from '@/components/ui/conceal';
import { ErrorCard } from '@/components/error-card';
import { FinanceAnalysisPanes } from '@/components/finance/finance-analysis-panes';
import { monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Icon } from '@/components/ui/icon';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { VerMais } from '@/components/ui/ver-mais';
import { useAosPoucos, useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { type CycleLine, type CycleRow, type CycleView, type Draft, type RegistroParaSimular, type Transaction, useCicloSimulado, useCycleLines, useCycleMonth, useCycleSeries, useInvoice, useRegistrosSimulados } from '@/hooks/use-finance';
import { DetalheDoCicloSheet } from '@/components/finance/detalhe-do-ciclo-sheet';
import { LinhaDoTempo } from '@/components/finance/linha-do-tempo';
import { describeCycle } from '@/lib/cycle-label';
import { baldeDaOrigem, ORDEM_DOS_BALDES } from '@/lib/detalhe-do-ciclo';
import { rotaDaLinha } from '@/lib/cycle-routes';
import { isoToBR, mesmoMes } from '@/lib/dates';
import { rotuloDaCompra } from '@/lib/data-da-compra';
import { motivoDaHipotese } from '@/lib/rascunho';
import type { Hipotese } from '@/lib/hipotese';
import { useRascunho } from '@/hooks/use-rascunho';

/**
 * **Por que o ciclo fechou naquele valor** — a tela que justifica o número da home.
 *
 * ## O que ela corrige
 *
 * A primeira versão listava por DIA e somava `entra − sai`, e isso criou um TERCEIRO número para
 * setembro: a home dizia `−371,64` (a dívida), o `resultado` do ciclo era `0,72` (o caixa) e esta
 * tela dizia `−867,25` (o fluxo). A queixa foi direta (13/09/2026): *"ainda não entendi por que a
 * tela 'ver o que fecha o ciclo' dá valor diferente da do que realmente fechou o ciclo"*.
 *
 * ⚠️ **Ela abre com a MESMA descrição da home** — `describeCycle`, a função única — e mostra a
 * CONTA que chega até lá antes de qualquer lista. Um detalhe que não reconstrói o número que ele
 * explica não é detalhe: é um quarto número.
 *
 * ## Por que agrupa por NATUREZA, não por dia
 *
 * Pedido: *"mostrando faturas separadas, lançamentos pix, ter filtro de mostrar todos juntos
 * abrindo todas as faturas"*. Por dia, a fatura de R$ 2.080 ficava ao lado de um pix de R$ 37 sem
 * nada dizer que são naturezas diferentes. Por natureza, "o que pesou foi o cartão" se lê num
 * relance — e o subtotal de cada grupo está no próprio cabeçalho.
 *
 * ## ⚠️ A FATURA ATRASADA é uma linha só; a do ciclo abre (15/09/2026)
 *
 * Havia um modo "Tudo aberto" que expandia TODA fatura nas transações que a compõem, e o sintoma
 * que o dono do produto pegou na hora foi: no ciclo de 11/09 a 10/10 apareciam compras de
 * **25/08 e 31/08**. A fatura ATRASADA cai neste ciclo pelo vencimento, mas as compras dela
 * aconteceram no ciclo anterior — expandi-la trazia datas de fora para dentro de um período que
 * se lê como fechado. E a queixa nomeia por que ela não deve abrir: *"a fatura é uma só, eu não
 * escolho quais lançamentos eu fiquei de pagar da fatura"*. Atrasada, ela é dívida a quitar: UM
 * card, e as compras ficam na tela da fatura.
 *
 * A fatura DO CICLO, ainda a vencer, é o contrário — ela abre, com todas as compras dela,
 * **inclusive as de alguns dias antes do início do ciclo**. Não é inconsistência: é o que ele
 * está acumulando agora, e a fatura atual não começa na borda do ciclo, começa no fechamento do
 * cartão. Foi o pedido literal.
 *
 * Quem separa os dois é `linha.atrasada`, coluna que veio na `20260915120000`. Ler o sufixo
 * "(atrasada)" do título resolveria hoje e quebraria no dia em que alguém mexesse na frase, e o
 * `day` não serve: ele chega clampado em `greatest(due_date, current_date)`, então fatura que
 * vence HOJE e fatura vencida têm o mesmo dia.
 *
 * ## O seletor passou a filtrar o LADO, que é o que os atalhos já prometiam
 *
 * Com a expansão fora, `Resumido | Tudo aberto` não tinha mais o que fazer — era o único uso do
 * modo. E `tipo=entra` / `tipo=sai`, que a home e a Projeção MANDAM em três itens de menu ("O que
 * entra", "O que sai"), eram lidos por ninguém: os três caíam na mesma lista sem filtro. O
 * seletor agora é esse filtro, e o parâmetro escolhe a aba de entrada.
 */
export default function CycleDetailScreen() {
  // Dinheiro no meio de frase obedece ao "esconder saldo" — `Money` não cabe em texto corrido.
  const brl = useBRL();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const params = useLocalSearchParams<{ month?: string; view?: string; tipo?: string; hipoteses?: string }>();
  const view = (params.view === 'civil' ? 'civil' : 'cycle') as CycleView;
  /*
    ⚠️ **Sem `month` no link, cai no ciclo CORRENTE — não em string vazia.**
    Era `params.month ?? ''`, e `cycle_lines('')` quebra: a tela abria direto no "Algo deu
    errado". Só não aparecia porque todo caminho de dentro do app passa o parâmetro — um deep
    link, um atalho ou uma notificação não passam. Mesma classe do mês civil vs mês de ciclo:
    mês sem padrão sensato vira erro ou período errado.
  */
  const mesCorrente = useCycleMonth(view);
  const month = params.month || mesCorrente;
  const [lado, setLado] = useState(params.tipo === 'entra' || params.tipo === 'sai' ? params.tipo : 'tudo');

  const serie = useCycleSeries(month, month, view);
  const linhas = useCycleLines(month, view);
  // Aberto pela Projeção com rascunho (`?hipoteses=1`), o ciclo é o real com o rascunho do
  // APARELHO gravado (08/10/2026): hipóteses e adiantamentos viram registros em `simular` —
  // criados, lidos e desfeitos. A parcela adiantada some do ciclo dela, como sumiria de verdade.
  // De outro lugar, o ciclo é o real.
  const comHipoteses = params.hipoteses === '1';
  const { rascunho: noAparelho } = useRascunho();
  const simulados = useRegistrosSimulados(
    comHipoteses ? noAparelho.hipoteses : SEM_HIPOTESES,
    comHipoteses ? noAparelho.adiantamentos : SEM_ADIANTAMENTOS,
    comHipoteses,
  );
  const registros = simulados.pronto ? simulados.registros : SEM_REGISTROS;
  const esperandoRascunho = comHipoteses && !simulados.pronto && !simulados.falhou;
  const comDetalhadas = registros.length > 0;
  const simulado = useCicloSimulado(registros, month, view);
  const ciclo = comDetalhadas
    ? (simulado.data?.ciclo ?? null)
    : (serie.data?.find((c) => mesmoMes(c.mes, month)) ?? null);
  const linhasBase = comDetalhadas ? simulado.data?.linhas : linhas.data;

  /**
   * Quantas linhas cada grupo mostra (24/09/2026): um ciclo tem 30 a 150 movimentos, e desenhar
   * todos de uma vez era a tela inteira de uma vez. Recomeça quando o mês, a régua ou o lado mudam.
   */
  const janelas = useJanelasPorGrupo(`${month}|${view}|${lado}`);

  const criadosNaSimulacao = useMemo(() => new Set(simulado.data?.idsHipotese ?? []), [simulado.data]);
  const grupos = useMemo(() => {
    const criados = criadosNaSimulacao;
    const faturasCom = new Set(simulado.data?.faturasComHipotese ?? []);
    // A linha que a hipótese CRIOU vira linha de hipótese (grupo próprio, sem destino — o registro
    // não existe); a fatura que já existia continua no grupo dela, dizendo que inclui a hipótese.
    const base = (linhasBase ?? []).map((l) =>
      criados.has(l.ref_id)
        ? { ...l, origin: 'hipotese', method_label: 'hipótese' }
        : faturasCom.has(l.ref_id)
          ? { ...l, method_label: [l.method_label, 'inclui hipótese'].filter(Boolean).join(' · ') }
          : l,
    );
    const doLado = base.filter((l) =>
      lado === 'tudo' ? true : lado === 'entra' ? Number(l.in_cents) > 0 : Number(l.in_cents) === 0
    );
    return agrupar(doLado, brl);
  }, [linhasBase, simulado.data, criadosNaSimulacao, lado, brl]);

  // A leitura que falha DENTRO do `simular` volta em `erros` (a RPC responde 200): com o ciclo ou
  // as linhas nulos, é erro — senão a tela ficava no esqueleto para sempre.
  const leituraSimuladaFalhou = comDetalhadas && simulado.isSuccess && (!simulado.data?.ciclo || !simulado.data?.linhas);
  if (serie.isError || linhas.isError || simulados.falhou || (comDetalhadas && simulado.isError) || leituraSimuladaFalhou) {
    return (
      <Screen>
        <ErrorCard
          onRetry={() => {
            void serie.refetch();
            void linhas.refetch();
            if (comDetalhadas) void simulado.refetch();
          }}
        />
      </Screen>
    );
  }

  if (serie.isPending || esperandoRascunho || !ciclo || (comDetalhadas && simulado.isPending)) {
    return (
      <Screen>
        <Skeleton height={220} radius={Radius.md} />
      </Screen>
    );
  }

  const errosDaSimulacao = simulado.data?.erros ?? [];
  const fechamento = (
    <>
      <Fechamento ciclo={ciclo} month={month} view={view} registros={registros} />
      {simulados.mudaram.length > 0 ? (
        <ThemedText type="small" themeColor="warning">
          {simulados.mudaram.length === 1
            ? 'Um adiantamento do rascunho ficou de fora: as parcelas dele mudaram. Refaça-o na Projeção.'
            : `${simulados.mudaram.length} adiantamentos do rascunho ficaram de fora: as parcelas deles mudaram. Refaça-os na Projeção.`}
        </ThemedText>
      ) : null}
      {errosDaSimulacao.map((e, i) => (
        <ThemedText key={i} type="small" themeColor="danger">
          {`Não deu para simular ${e.indice !== undefined ? `a ${e.indice + 1}ª hipótese` : 'uma leitura'}: ${motivoDaHipotese(e)}`}
        </ThemedText>
      ))}
    </>
  );
  const filtro = (
    <Segmented
      options={[
        { value: 'tudo', label: 'Tudo' },
        { value: 'entra', label: 'Entrou' },
        { value: 'sai', label: 'Saiu' },
      ]}
      value={lado}
      onChange={setLado}
    />
  );
  const movimentos = grupos.length === 0 ? (
    <EmptyState compacto
      title={lado === 'tudo' ? 'Nada neste ciclo' : lado === 'entra' ? 'Nada entrou' : 'Nada saiu'}
      hint={lado === 'tudo'
        ? 'Nenhum movimento cai neste período.'
        : 'O filtro acima mostra o outro lado do período.'}
    />
  ) : grupos.map((g) => {
    const j = janelas.janelaDe(g.chave, g.linhas);
    return (
      <View key={g.chave} style={styles.grupo}>
        <SectionHead title={g.titulo} />
        <Section>
          {j.visiveis.map((l, i) => (
            <Linha
              key={`${l.origin}-${l.ref_id}-${i}`}
              linha={l}
              compras={comDetalhadas ? (simulado.data?.comprasDasFaturas?.[l.ref_id] ?? []) : undefined}
              criados={criadosNaSimulacao}
            />
          ))}
        </Section>
        <VerMais restantes={j.restantes} onPress={() => janelas.verMais(g.chave)} />
      </View>
    );
  });
  const compact = <>{fechamento}{filtro}{movimentos}</>;

  return (
    /*
      ⚠️ **`<Screen>`, não um `ScrollView` próprio.** Esta era a outra tela de conteúdo que furava
      o primitivo do ritmo — e o desvio era visível: calha de `Space.md` (12) contra os 16 do app
      inteiro, e gap de 12 contra 24. Num app cuja queixa era "espaçamento bagunçado", a tela que
      escreve o próprio padding é a que diverge.
    */
    // Puxar para atualizar, como as outras telas de dados (25/09/2026): era a única sem.
    <Screen wide={tablet} onRefresh={() => Promise.all([serie.refetch(), linhas.refetch(), ...(comDetalhadas ? [simulado.refetch()] : [])])}>
      {tablet ? (
        <FinanceAnalysisPanes primary={fechamento} support={<>{filtro}{movimentos}</>} compact={compact} />
      ) : compact}
    </Screen>
  );
}

/**
 * A conta que chega ao número da home, na ordem em que se lê.
 *
 * ⚠️ **`Faltou pagar` fica FORA da soma, de propósito.** O dinheiro não saiu da conta: por isso
 * `comecei + entrou − saiu` dá o caixa que de fato ficou, e a dívida é uma linha à parte. Somar
 * as duas seria o abatimento automático que o dono do produto recusou.
 */
function Fechamento({ ciclo, month, view, registros }: { ciclo: CycleRow; month: string; view: CycleView; registros: RegistroParaSimular[] }) {
  const hipoteses = registros.length;
  const nome = monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase();
  const d = describeCycle(ciclo, nome);
  const faltou = Number(ciclo.faltou_pagar ?? 0);
  const [detalhe, setDetalhe] = useState(false);

  return (
    <Card style={styles.painel}>
      <HeroLabel>{d.label}</HeroLabel>
      {/* O número abre "Como chego nesse valor" (07/10/2026): conta por conta, e o que ainda vem. */}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Mostra como chego nesse valor"
        onPress={() => setDetalhe(true)}
        style={styles.numero}>
        <Money cents={d.cents} variant="money" tone={d.ruim ? 'danger' : 'text'} signed />
        <Icon name="chevron.right" size="sm" color="textSecondary" />
      </Pressable>
      <DetalheDoCicloSheet
        visible={detalhe}
        onClose={() => setDetalhe(false)}
        month={month}
        view={view}
        rascunho={hipoteses > 0 ? Number(ciclo.resultado) : null}
        registros={registros}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        {`${isoToBR(ciclo.ini)} a ${isoToBR(ciclo.fim)} · ciclo ${ciclo.estado}`}
      </ThemedText>
      {hipoteses > 0 ? (
        <ThemedText type="caption" themeColor="warning">
          {`Com ${hipoteses === 1 ? 'a hipótese' : `as ${hipoteses} hipóteses`} do rascunho · nada é salvo`}
        </ThemedText>
      ) : null}

      <View style={styles.conta}>
        <Conta rotulo="Comecei com" cents={Number(ciclo.comecei_com)} />
        <Conta rotulo="Entrou" cents={Number(ciclo.entrou)} tone="success" />
        <Conta rotulo="Saiu" cents={-Number(ciclo.saiu)} tone="danger" />
        <Conta
          rotulo="Sobrou na conta"
          cents={Number(ciclo.caixa_no_fim ?? ciclo.resultado)}
          forte
        />
        {faltou > 0 ? <Conta rotulo="Faltou pagar" cents={-faltou} tone="danger" forte /> : null}
      </View>
    </Card>
  );
}

function Conta({
  rotulo,
  cents,
  tone = 'text',
  forte,
}: {
  rotulo: string;
  cents: number;
  tone?: 'text' | 'success' | 'danger';
  forte?: boolean;
}) {
  return (
    // Rótulo e valor lado a lado quando cabem; com fonte grande o valor desce inteiro para a linha
    // de baixo. Encolhendo o rótulo, ele partia no meio da palavra ("Com/ecei", "So/bro/u").
    <View style={styles.contaLinha}>
      <ThemedText type={forte ? 'smallBold' : 'small'} themeColor={forte ? 'text' : 'textSecondary'} style={styles.contaRotulo}>
        {rotulo}
      </ThemedText>
      <View style={styles.contaValor}>
        <Money cents={cents} variant={forte ? 'ticker' : 'footnote'} tone={tone} signed />
      </View>
    </View>
  );
}

/**
 * Uma linha do ciclo. A fatura A VENCER abre nas compras dela; a ATRASADA não — ver o cabeçalho.
 *
 * ⚠️ **A consulta só sai quando vai ser desenhada.** `useInvoice` recebe o id condicionado a
 * `abre`, não a "é fatura": com o segundo, toda fatura atrasada dispararia um fetch cujo
 * resultado é jogado fora, e numa tela com seis faturas isso é seis consultas para nada.
 */
function Linha({ linha, compras: simuladas, criados }: {
  linha: CycleLine;
  /** No ciclo simulado, as compras da fatura vêm de DENTRO da simulação (com o rascunho gravado). */
  compras?: Transaction[];
  /** O que a simulação criou: não existe de verdade, então não abre detalhe. */
  criados?: ReadonlySet<string>;
}) {
  const brl = useBRL();
  const abre = linha.origin === 'invoice' && !linha.atrasada;
  const fatura = useInvoice(abre && !simuladas ? linha.ref_id : undefined);
  // As compras da fatura aberta também vêm aos poucos: uma fatura tem de 30 a 150 compras.
  const compras = useAosPoucos(abre ? (simuladas ?? fatura.data?.transactions ?? []) : [], linha.ref_id);
  const entra = Number(linha.in_cents) > 0;
  // A linha cabe a 384dp × fonte 1,3: o ano já está no cabeçalho do ciclo, o cartão já está no
  // título da fatura, e o "(atrasada)" desce para o subtítulo. Quem DECIDE que ela é atrasada
  // continua sendo a coluna `atrasada`; o sufixo só é tirado do texto quando ela diz que é.
  // O banco escreve "(atrasada)" na fatura e "(atrasado)" no boleto: o sufixo sai do título nos
  // dois, e o subtítulo diz a palavra que ele tinha.
  const sufixo = linha.atrasada ? linha.title.match(/\s*\((atrasad[ao])\)$/) : null;
  const titulo = sufixo ? linha.title.slice(0, sufixo.index) : linha.title;
  const subtitulo = [
    linha.atrasada ? (sufixo?.[1] ?? 'atrasado') : null,
    isoToBR(linha.day).slice(0, 5),
    linha.method_label && !titulo.includes(linha.method_label) ? linha.method_label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <Row
        title={titulo}
        subtitle={subtitulo}
        trailing={
          <Money
            cents={entra ? Number(linha.in_cents) : Number(linha.out_cents)}
            tone={entra ? 'success' : 'danger'}
          />
        }
        onPress={destino(linha)}
      />
      {/* As compras da fatura a vencer, na linha do tempo das listas que se abrem (08/10/2026): o
          trilho diz que elas são PARTE da fatura acima, e não linhas soltas do ciclo. */}
      {abre && compras.visiveis.length > 0 ? (
        <View style={styles.dentroDaFatura}>
          <LinhaDoTempo
            grupos={[{
              itens: compras.visiveis.map((t) => {
                const titulo = t.description ?? t.merchant ?? 'Compra';
                // A data da COMPRA: a parcela 2 em diante mora no mês em que cai, e a linha dizia a
                // data dela como se fosse a da compra ("Mostre sempre a data do lançamento").
                const hipotese = criados?.has(t.id) ?? false;
                const apoio = [hipotese ? 'hipótese' : null, rotuloDaCompra(t) ?? isoToBR(t.occurred_at).slice(0, 5), t.category].filter(Boolean).join(' · ');
                return {
                  chave: t.id,
                  titulo,
                  apoio,
                  cents: Number(t.amount_cents),
                  estado: 'item' as const,
                  accessibilityLabel: `${titulo}, ${apoio}, ${brl(Number(t.amount_cents))}`,
                  onPress: hipotese ? undefined : () => router.push({ pathname: '/finance/[txId]', params: { txId: t.id } }),
                };
              }),
            }]}
          />
        </View>
      ) : null}
      {abre ? <VerMais restantes={compras.restantes} onPress={compras.verMais} /> : null}
    </>
  );
}

/**
 * A ordem dos grupos é a de quem pesa na decisão: cartão primeiro (costuma ser o maior), depois o
 * que sai da conta, o financiamento, e as entradas por último — quem abre esta tela veio entender
 * um número ruim, não comemorar o salário.
 */
/**
 * ⚠️ **`brl` entra por PARÂMETRO, não por hook.** Isto é helper de módulo, e o subtotal do
 * cabeçalho é dinheiro visível: precisa obedecer ao "esconder saldo" como o resto da tela.
 */
function agrupar(linhas: CycleLine[], brl: (cents: number) => string) {
  const balde = (l: CycleLine) => baldeDaOrigem(l.origin, Number(l.in_cents) > 0);

  const mapa = new Map<string, CycleLine[]>();
  for (const l of linhas) {
    const k = balde(l);
    const atual = mapa.get(k);
    if (atual) atual.push(l);
    else mapa.set(k, [l]);
  }

  // Hipóteses primeiro: é o que a pessoa veio ver ao abrir o ciclo pela Projeção com um rascunho.
  return ORDEM_DOS_BALDES
    .filter((t) => mapa.has(t))
    .map((titulo) => ({
      chave: titulo,
      // O subtotal mora no cabeçalho: sem ele, "qual grupo pesou" só sai somando de cabeça.
      titulo: `${titulo} · ${brl(
        (mapa.get(titulo) ?? []).reduce((s, l) => s + Number(l.in_cents) + Number(l.out_cents), 0),
      )}`,
      // Do mais recente para o mais antigo (24/09/2026: *"em tudo tem que ser do mais recente
      // para o mais antigo"*); no mesmo dia, o maior valor primeiro.
      linhas: (mapa.get(titulo) ?? []).sort(
        (a, b) =>
          b.day.localeCompare(a.day) ||
          Number(b.in_cents) + Number(b.out_cents) - Number(a.in_cents) - Number(a.out_cents),
      ),
    }));
}

function destino(l: CycleLine) {
  const rota = rotaDaLinha(l.origin, l.ref_id);
  return rota ? () => router.push(rota as never) : undefined;
}

const styles = StyleSheet.create({
  // Título do grupo → linhas a `Space.md`: sem isto o rótulo encostava no card (23/09/2026).
  grupo: { gap: Space.md },
  painel: { gap: Space.xs },
  // As compras abertas sob a fatura: recuadas, para o trilho ficar sob o título dela.
  dentroDaFatura: { paddingLeft: Space.md, paddingRight: Space.sm, paddingBottom: Space.sm },
  numero: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, alignSelf: 'flex-start' },
  conta: { gap: Space.xs, paddingTop: Space.sm },
  contaLinha: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    columnGap: Space.sm,
  },
  contaRotulo: { flexShrink: 0, maxWidth: '100%' },
  contaValor: { marginLeft: 'auto' },
});

const SEM_ADIANTAMENTOS: Draft[] = [];
const SEM_HIPOTESES: Hipotese[] = [];
const SEM_REGISTROS: RegistroParaSimular[] = [];
