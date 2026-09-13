import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { currentMonth, monthTitle } from '@/components/finance/month-picker';
import { useMonthRuler } from '@/components/finance/month-ruler';
import { PeriodBar } from '@/components/finance/period-bar';
import { ThemedText } from '@/components/themed-text';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { HeroPanel } from '@/components/ui/hero-panel';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { SectionHead } from '@/components/ui/section-head';
import { Screen } from '@/components/ui/screen';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Radius, Space } from '@/design/tokens';
import { formatBRL } from '@/hooks/use-items';
import { isoToBR } from '@/lib/dates';
import {
  useCycleLines,
  useCycleSeries,
  type CycleLine,
  type CycleRow,
  type CycleView,
} from '@/hooks/use-finance';

/**
 * **A linha do tempo de ciclos** — a única tela que responde "quanto eu tenho / quanto vou ter".
 *
 * Spec: `docs/superpowers/specs/2026-09-13-linha-do-tempo-de-ciclos-design.md`.
 *
 * ## Por que ela existe
 *
 * Ela substitui TRÊS superfícies que discordavam entre si (13/09/2026), e a discordância era
 * medida, não impressão:
 *
 * | sintoma | antes |
 * |---|---|
 * | o mesmo rótulo, valores diferentes | `TENHO HOJE` valia −370,92 na Hoje e **0,72** em "Entradas e saídas" |
 * | as mesmas seções em duas telas | `Atrasado` / `O que vence` / `O que entra` na Hoje **e** na Projeção |
 * | a mesma pergunta, duas respostas | "Entradas e saídas" contava o cartão na data da COMPRA e a Projeção na data do PAGAMENTO — as duas navegavam meses, nenhuma dizia qual era qual |
 *
 * A queixa do dono do produto foi literal: *"eu ainda estou 100% perdido no app, muito perdido
 * mesmo… tem muitas telas que mostram o que seria o valor projetado até um mês específico, aí
 * tem outra tela que mostra diferente"*.
 *
 * ## O modelo, inteiro
 *
 * **Uma unidade de tempo (o ciclo) e uma base (o dia em que o dinheiro sai da conta).** Compra
 * no cartão entra no ciclo em que a FATURA VENCE. Passado, presente e futuro são a mesma tela —
 * muda o tempo verbal e o estado, nunca a conta.
 *
 * ⚠️ **Ciclo fechado termina em DOIS números, e isso é regra de produto.** Pedido explícito:
 * *"se eu não paguei nada com esse saldo, o saldo na conta permanece exatamente na conta e o que
 * faltou pagar continua faltando pagar"*. Saldo em conta NÃO abate dívida sozinho — compensar os
 * dois só é honesto quando sobra positivo, porque aí a sobra de fato entra no ciclo seguinte.
 * Ver `docs/ideias/GUARDAR-DINHEIRO.md`.
 *
 * ⚠️ **Quem calcula é o banco, numa função só** (`private.cash_events`). Reproduzir a régua de
 * "fatura no vencimento" em TypeScript seria a segunda cópia, e o modo de falha é mudo: dois
 * números na mesma tela discordando sem erro nenhum. Foi assim que esta tela nasceu.
 */
export default function FinanceScreen() {
  const [month, setMonth] = useState(currentMonth);
  const regua = useMonthRuler();

  /*
    A série pede DOZE ciclos a partir do escolhido, não um. `comecei_com` de um ciclo futuro é o
    `resultado` do anterior — pedir um por vez devolveria cada um partindo do caixa de hoje, e a
    corrente, que é o produto, não existiria. Um ciclo cujo início já passou usa o caixa REAL,
    então o passado não depende de quem veio antes.
  */
  const serie = useCycleSeries(month, shiftMonths(month, 11), regua.view);
  const linhas = useCycleLines(month, regua.view);

  const ciclo = serie.data?.find((c) => c.mes.startsWith(month)) ?? null;
  const proximos = (serie.data ?? []).filter((c) => !c.mes.startsWith(month)).slice(0, 3);

  if (serie.isError) {
    return (
      <Screen grouped topBar={<AppHeader title="Financeiro" />}>
        <ErrorCard onRetry={() => { void serie.refetch(); }} />
      </Screen>
    );
  }

  return (
    <Screen
      grouped
      topBar={
        <AppHeader
          title="Financeiro"
          action={
            <HeaderIconButton
              icon="slider.horizontal.3"
              label="Gerenciar contas, cartões e orçamentos"
              onPress={() => router.push('/finance/manage')}
            />
          }
        />
      }>
      <PeriodBar month={month} onChangeMonth={setMonth} ruler={regua} />

      {serie.isPending || !ciclo ? (
        <Skeleton height={180} radius={Radius.lg} />
      ) : (
        <CicloHero ciclo={ciclo} />
      )}

      <Recortes month={month} view={regua.view} linhas={linhas.data ?? []} carregando={linhas.isPending} />

      {proximos.length > 0 ? (
        <>
          <SectionHead title="Os próximos ciclos" />
          <Section>
            {proximos.map((c) => (
              <Row
                key={c.mes}
                title={monthTitle(c.mes.slice(0, 7))}
                subtitle={`${isoToBR(c.ini)} a ${isoToBR(c.fim)}`}
                trailing={<Money cents={c.resultado} tone="auto" signed />}
                onPress={() => setMonth(c.mes.slice(0, 7))}
              />
            ))}
          </Section>
        </>
      ) : null}

      <ComoEuCalculo />
    </Screen>
  );
}

/**
 * O destaque. Ciclo fechado abre com o que ACONTECEU; aberto e previsto, com o que vai acontecer
 * — o tempo verbal é a única diferença, porque a conta é a mesma.
 */
function CicloHero({ ciclo }: { ciclo: CycleRow }) {
  const fechado = ciclo.estado === 'fechado';
  const faltou = ciclo.faltou_pagar ?? 0;

  /*
    ⚠️ **Ciclo fechado NÃO lidera com o número líquido.** Ele mostra o caixa que de fato ficou, e
    o que ficou devendo é uma segunda linha. Recusa explícita do dono do produto (13/09/2026):
    *"não é porque meu saldo na conta é de 0,72 que fechei o ciclo com −370,92. Se eu não paguei
    nada com esse saldo, o saldo na conta permanece exatamente na conta e o que faltou pagar
    continua faltando pagar."*

    Ciclo aberto e previsto lideram com o resultado porque ali a pergunta é outra — "como vou
    terminar se eu pagar tudo" —, e aí o número único é a resposta certa.
  */
  if (fechado) {
    return (
      <HeroPanel
        label="Sobrou na conta"
        value={<Money cents={ciclo.caixa_no_fim ?? 0} variant="heroMoney" tone="auto" />}
        secondary={{
          text: `entrou ${formatBRL(ciclo.entrou)} · saiu ${formatBRL(ciclo.saiu)}`,
          negative: (ciclo.caixa_no_fim ?? 0) < 0,
        }}
        concealable
        footer={
          faltou > 0 ? (
            <View style={styles.fechamentoLinha}>
              <ThemedText type="footnote" themeColor="onHeroMuted">
                Ficou faltando pagar
              </ThemedText>
              <Money cents={faltou} variant="footnote" tone="danger" />
            </View>
          ) : undefined
        }
      />
    );
  }

  return (
    <HeroPanel
      label={ciclo.estado === 'aberto' ? 'Vou fechar em' : 'Devo fechar em'}
      value={<Money cents={ciclo.resultado} variant="heroMoney" tone="auto" signed />}
      secondary={{
        text: `veio de ${formatBRL(ciclo.comecei_com)} · entra ${formatBRL(ciclo.entrou)} · sai ${formatBRL(ciclo.saiu)}`,
        negative: ciclo.resultado < 0,
      }}
      concealable
    />
  );
}

/** Os recortes do ciclo. Cada um abre o detalhe; nenhum recalcula nada. */
function Recortes({
  month,
  view,
  linhas,
  carregando,
}: {
  month: string;
  view: CycleView;
  linhas: CycleLine[];
  carregando: boolean;
}) {
  const abrir = (tipo: 'entra' | 'sai' | 'faturas') => () =>
    router.push({ pathname: '/finance/cycle', params: { month, view, tipo } });
  const total = useMemo(() => {
    const entra = linhas.reduce((s, l) => s + Number(l.in_cents), 0);
    const sai = linhas.reduce((s, l) => s + Number(l.out_cents), 0);
    // Fatura tem DOIS tipos de evento e os dois são fatura para quem olha: o pagamento que já
    // saiu da conta (`invoice_payment`) e o que ainda falta pagar (`invoice`). Contar só um
    // mostrava R$ 0,00 num ciclo fechado, onde tudo já virou pagamento.
    const faturas = linhas
      .filter((l) => l.origin === 'invoice' || l.origin === 'invoice_payment')
      .reduce((s, l) => s + Number(l.out_cents), 0);
    return { entra, sai, faturas };
  }, [linhas]);

  if (carregando) return <Section><SkeletonRow /><SkeletonRow /><SkeletonRow /></Section>;

  return (
    <>
      <SectionHead title="O ciclo por dentro" />
      <Section>
        <Row
          title="O que entra"
          trailing={<Money cents={total.entra} tone="success" />}
          onPress={abrir('entra')}
        />
        <Row
          title="O que sai"
          trailing={<Money cents={total.sai} tone="danger" />}
          onPress={abrir('sai')}
        />
        <Row
          title="Faturas"
          subtitle="contam no ciclo em que vencem"
          trailing={<Money cents={total.faturas} />}
          onPress={abrir('faturas')}
        />
        <Row title="Onde o dinheiro foi" onPress={() => router.push({ pathname: '/finance/month', params: { month } })} />
        <Row title="Orçamento" onPress={() => router.push('/finance/budgets')} />
      </Section>
    </>
  );
}

/**
 * A regra inteira, em uma frase, recolhida. Ela precisa existir porque é a única coisa que o
 * usuário tem que saber para os números fazerem sentido — e precisa ficar recolhida porque
 * repetir isso em cada tela era metade da poluição que esta refatoração removeu.
 */
function ComoEuCalculo() {
  return (
    <ThemedText type="footnote" themeColor="textSecondary" style={styles.nota}>
      Tudo conta pelo dia em que o dinheiro sai da conta. Compra no cartão entra no ciclo em que a
      fatura vence.
    </ThemedText>
  );
}

/** `2026-09` + 11 → `2027-08`. Sem `Date`, que erraria o fuso na virada do mês. */
function shiftMonths(month: string, n: number) {
  const [a, m] = month.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  fechamentoLinha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Space.sm },
  nota: { paddingHorizontal: Space.xs, paddingTop: Space.sm },
});
