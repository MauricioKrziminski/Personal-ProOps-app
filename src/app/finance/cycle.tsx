import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
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
import { type CycleLine, type CycleRow, type CycleView, useCycleLines, useCycleMonth, useCycleSeries, useInvoice } from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { describeCycle } from '@/lib/cycle-label';
import { rotaDaLinha } from '@/lib/cycle-routes';
import { isoToBR } from '@/lib/dates';

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
 * ⚠️ **"Tudo aberto" expande a fatura nas COMPRAS dela**, e cada fatura busca as suas na própria
 * linha, só quando aberta. Uma consulta que trouxesse as compras de todas as faturas do ciclo
 * pagaria o custo mesmo com ninguém abrindo nada.
 */
export default function CycleDetailScreen() {
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
  const [modo, setModo] = useState(params.tipo === 'tudo' ? 'aberto' : 'resumo');

  const serie = useCycleSeries(month, month, view);
  const linhas = useCycleLines(month, view);
  const ciclo = serie.data?.find((c) => c.mes.startsWith(month)) ?? null;

  const grupos = useMemo(() => agrupar(linhas.data ?? []), [linhas.data]);

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

  return (
    /*
      ⚠️ **`<Screen>`, não um `ScrollView` próprio.** Esta era a outra tela de conteúdo que furava
      o primitivo do ritmo — e o desvio era visível: calha de `Space.md` (12) contra os 16 do app
      inteiro, e gap de 12 contra 24. Num app cuja queixa era "espaçamento bagunçado", a tela que
      escreve o próprio padding é a que diverge.
    */
    <Screen>
      <Fechamento ciclo={ciclo} month={month} />

      <Segmented
        options={[
          { value: 'resumo', label: 'Resumido' },
          { value: 'aberto', label: 'Tudo aberto' },
        ]}
        value={modo}
        onChange={setModo}
      />

      {grupos.length === 0 ? (
        <EmptyState title="Nada neste ciclo" hint="Nenhum movimento cai neste período." />
      ) : (
        grupos.map((g) => (
          <View key={g.titulo}>
            <SectionHead title={g.titulo} />
            <Section>
              {g.linhas.map((l, i) => (
                <Linha key={`${l.origin}-${l.ref_id}-${i}`} linha={l} expandida={modo === 'aberto'} />
              ))}
            </Section>
          </View>
        ))
      )}
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

/** Uma linha do ciclo. Fatura vira o cabeçalho das compras dela no modo "Tudo aberto". */
function Linha({ linha, expandida }: { linha: CycleLine; expandida: boolean }) {
  const ehFatura = linha.origin === 'invoice' || linha.origin === 'invoice_payment';
  // Só a fatura tem o que abrir, e só busca quando alguém abriu.
  const fatura = useInvoice(ehFatura && expandida ? linha.ref_id : undefined);
  const entra = Number(linha.in_cents) > 0;

  return (
    <>
      <Row
        title={linha.title}
        subtitle={`${isoToBR(linha.day)} · ${linha.method_label}`}
        trailing={
          <Money
            cents={entra ? Number(linha.in_cents) : Number(linha.out_cents)}
            tone={entra ? 'success' : 'danger'}
          />
        }
        onPress={destino(linha)}
      />
      {ehFatura && expandida
        ? (fatura.data?.transactions ?? []).map((t) => (
            <Row
              key={t.id}
              title={t.description ?? t.merchant ?? 'Compra'}
              subtitle={`${isoToBR(t.occurred_at)}${t.category ? ` · ${t.category}` : ''}`}
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
function agrupar(linhas: CycleLine[]) {
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
      titulo: `${titulo} · ${formatBRL(
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
  painel: { gap: Space.xs },
  conta: { gap: Space.xs, paddingTop: Space.sm },
  contaLinha: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Space.sm,
  },
});
