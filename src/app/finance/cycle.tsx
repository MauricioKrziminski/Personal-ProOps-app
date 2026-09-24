import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBRL } from '@/components/ui/conceal';
import { ErrorCard } from '@/components/error-card';
import { FinanceAnalysisPanes } from '@/components/finance/finance-analysis-panes';
import { monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { type CycleLine, type CycleRow, type CycleView, useCycleLines, useCycleMonth, useCycleSeries, useInvoice } from '@/hooks/use-finance';
import { describeCycle } from '@/lib/cycle-label';
import { rotaDaLinha } from '@/lib/cycle-routes';
import { isoToBR, mesmoMes } from '@/lib/dates';

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
  const params = useLocalSearchParams<{ month?: string; view?: string; tipo?: string }>();
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
  const ciclo = serie.data?.find((c) => mesmoMes(c.mes, month)) ?? null;

  const grupos = useMemo(() => {
    const todas = linhas.data ?? [];
    const doLado = todas.filter((l) =>
      lado === 'tudo' ? true : lado === 'entra' ? Number(l.in_cents) > 0 : Number(l.in_cents) === 0
    );
    return agrupar(doLado, brl);
  }, [linhas.data, lado, brl]);

  if (serie.isError || linhas.isError) {
    return (
      <Screen>
        <ErrorCard
          onRetry={() => {
            void serie.refetch();
            void linhas.refetch();
          }}
        />
      </Screen>
    );
  }

  if (serie.isPending || !ciclo) {
    return (
      <Screen>
        <Skeleton height={220} radius={Radius.md} />
      </Screen>
    );
  }

  const fechamento = <Fechamento ciclo={ciclo} month={month} />;
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
    <EmptyState
      title={lado === 'tudo' ? 'Nada neste ciclo' : lado === 'entra' ? 'Nada entrou' : 'Nada saiu'}
      hint={lado === 'tudo'
        ? 'Nenhum movimento cai neste período.'
        : 'O filtro acima mostra o outro lado do período.'}
    />
  ) : grupos.map((g) => (
    <View key={g.titulo} style={styles.grupo}>
      <SectionHead title={g.titulo} />
      <Section>
        {g.linhas.map((l, i) => (
          <Linha key={`${l.origin}-${l.ref_id}-${i}`} linha={l} />
        ))}
      </Section>
    </View>
  ));
  const compact = <>{fechamento}{filtro}{movimentos}</>;

  return (
    /*
      ⚠️ **`<Screen>`, não um `ScrollView` próprio.** Esta era a outra tela de conteúdo que furava
      o primitivo do ritmo — e o desvio era visível: calha de `Space.md` (12) contra os 16 do app
      inteiro, e gap de 12 contra 24. Num app cuja queixa era "espaçamento bagunçado", a tela que
      escreve o próprio padding é a que diverge.
    */
    <Screen wide={tablet}>
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
function Fechamento({ ciclo, month }: { ciclo: CycleRow; month: string }) {
  const nome = monthTitle(month).replace(/ de \d{4}$/, '').toLowerCase();
  const d = describeCycle(ciclo, nome);
  const faltou = Number(ciclo.faltou_pagar ?? 0);

  return (
    <Card style={styles.painel}>
      <HeroLabel>{d.label}</HeroLabel>
      <Money cents={d.cents} variant="money" tone={d.ruim ? 'danger' : 'text'} signed />
      <ThemedText type="caption" themeColor="textSecondary">
        {`${isoToBR(ciclo.ini)} a ${isoToBR(ciclo.fim)} · ciclo ${ciclo.estado}`}
      </ThemedText>

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
    <View style={styles.contaLinha}>
      <ThemedText type={forte ? 'smallBold' : 'small'} themeColor={forte ? 'text' : 'textSecondary'}>
        {rotulo}
      </ThemedText>
      <Money cents={cents} variant={forte ? 'ticker' : 'footnote'} tone={tone} signed />
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
function Linha({ linha }: { linha: CycleLine }) {
  const abre = linha.origin === 'invoice' && !linha.atrasada;
  const fatura = useInvoice(abre ? linha.ref_id : undefined);
  const entra = Number(linha.in_cents) > 0;
  // A linha cabe a 384dp × fonte 1,3: o ano já está no cabeçalho do ciclo, o cartão já está no
  // título da fatura, e o "(atrasada)" desce para o subtítulo. Quem DECIDE que ela é atrasada
  // continua sendo a coluna `atrasada`; o sufixo só é tirado do texto quando ela diz que é.
  const titulo = linha.atrasada ? linha.title.replace(/\s*\(atrasada\)$/, '') : linha.title;
  const subtitulo = [
    linha.atrasada ? 'atrasada' : null,
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
      {abre
        ? (fatura.data?.transactions ?? []).map((t) => (
            <Row
              key={t.id}
              title={t.description ?? t.merchant ?? 'Compra'}
              subtitle={`${isoToBR(t.occurred_at).slice(0, 5)}${t.category ? ` · ${t.category}` : ''}`}
              trailing={<Money cents={Number(t.amount_cents)} variant="footnote" />}
              onPress={() => router.push({ pathname: '/finance/[txId]', params: { txId: t.id } })}
            />
          ))
        : null}
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
  const balde = (l: CycleLine) => {
    if (Number(l.in_cents) > 0) return 'Entradas';
    if (l.origin === 'invoice' || l.origin === 'invoice_payment') return 'Faturas de cartão';
    if (l.origin === 'debt_schedule') return 'Parcelas de financiamento';
    if (l.origin === 'recurring_projection') return 'Previstos da recorrência';
    return 'Boletos, pix e gastos';
  };
  const ordem = [
    'Faturas de cartão',
    'Boletos, pix e gastos',
    'Parcelas de financiamento',
    'Previstos da recorrência',
    'Entradas',
  ];

  const mapa = new Map<string, CycleLine[]>();
  for (const l of linhas) {
    const k = balde(l);
    const atual = mapa.get(k);
    if (atual) atual.push(l);
    else mapa.set(k, [l]);
  }

  return ordem
    .filter((t) => mapa.has(t))
    .map((titulo) => ({
      // O subtotal mora no cabeçalho: sem ele, "qual grupo pesou" só sai somando de cabeça.
      titulo: `${titulo} · ${brl(
        (mapa.get(titulo) ?? []).reduce((s, l) => s + Number(l.in_cents) + Number(l.out_cents), 0),
      )}`,
      linhas: (mapa.get(titulo) ?? []).sort((a, b) => a.day.localeCompare(b.day)),
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
  conta: { gap: Space.xs, paddingTop: Space.sm },
  contaLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
});
