import { useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ErrorCard } from '@/components/error-card';
import { Card } from '@/components/ui/card';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { Chip } from '@/components/finance/chip';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, tabular } from '@/design/tokens';
import { localISODate } from '@/hooks/use-items';
import { formatNumberBR } from '@/lib/dates';
import {
  useAnnualReport,
  useFirstTransactionYear,
  type AnnualCategoryRow,
  type YearEndBalance,
} from '@/hooks/use-finance';

/** Quantas categorias de gasto aparecem antes do "ver todas". */
const TOP_CATEGORIES = 8;

/**
 * Valor em reais com **vírgula** decimal.
 *
 * O CSV usa `;` como separador de coluna, que é o dialeto pt-BR — e nesse dialeto o decimal é
 * vírgula. Com ponto (o que a tela fazia antes) o Excel em português lê a coluna como texto e não
 * soma nada, que é justamente o uso da exportação.
 */
function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function montaCsv(ano: number, categorias: AnnualCategoryRow[], saldos: YearEndBalance[]): string {
  return [
    `Relatorio anual ${ano}`,
    '',
    'Tipo;Categoria;Total;Lancamentos',
    ...categorias.map(
      (c) =>
        `${c.kind === 'income' ? 'Receita' : 'Despesa'};${c.category};${reais(Number(c.total_cents))};${c.tx_count}`
    ),
    '',
    `Bens e direitos em 31/12/${ano}`,
    'Tipo;Nome;Valor',
    ...saldos.map(
      (s) => `${s.kind === 'account' ? 'Conta' : 'Bem'};${s.name};${reais(Number(s.balance_cents))}`
    ),
  ].join('\n');
}

/**
 * Relatórios — o ano fechado.
 *
 * A pergunta que faz alguém abrir esta tela em março não é "gastei mais com o quê?", é **"o que
 * eu escrevo na declaração?"**. Por isso *Bens e Direitos* (`year_end_balances`) sobe para logo
 * abaixo do card de destaque, e não fica em quarto lugar embaixo de duas listas de categoria.
 */
export default function ReportsScreen() {
  const toast = useToast();
  const anoAtual = Number(localISODate().slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [verTodas, setVerTodas] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useAnnualReport(ano);

  const primeiroAno = useFirstTransactionYear();
  // Do ano corrente para TRÁS: o padrão é o ano corrente, e ele precisa estar visível sem rolar.
  // Enquanto a consulta não volta, um ano só — melhor oferecer de menos que oferecer vazio.
  const anos = useMemo(() => {
    const inicio = Math.min(primeiroAno.data ?? anoAtual, anoAtual);
    return Array.from({ length: anoAtual - inicio + 1 }, (_, i) => anoAtual - i);
  }, [primeiroAno.data, anoAtual]);

  const receitas = (data?.categories ?? []).filter((c) => c.kind === 'income');
  const despesas = (data?.categories ?? []).filter((c) => c.kind === 'expense');
  const maiorDespesa = Math.max(...despesas.map((d) => Number(d.total_cents)), 1);
  const visiveis = verTodas ? despesas : despesas.slice(0, TOP_CATEGORIES);

  // `annual_summary` devolve linha zerada para ano sem movimento — o que decide se a tela tem
  // conteúdo é a contagem, não a existência do registro.
  const summary = data?.summary ?? null;
  const temMovimento = Number(summary?.tx_count ?? 0) > 0;
  const temConteudo = temMovimento || (data?.yearEnd ?? []).length > 0;

  const exportar = async () => {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        title: `Relatorio ${ano}`,
        message: montaCsv(ano, data.categories, data.yearEnd),
      });
    } catch {
      toast({ message: 'Não deu para exportar agora.', tone: 'error' });
    }
  };

  return (
    <Screen grouped onRefresh={refetch} refreshing={isRefetching}>
      <Stack.Screen
        options={{
          title: 'Relatórios',
          headerLargeTitle: true,
        }}
      />

      {/* Ação some quando não há o que exportar — array vazio, não botão desabilitado. */}
      <HeaderActions
        actions={
          data && temConteudo
            ? [{ label: 'Exportar CSV do ano', icon: 'square.and.arrow.up', onPress: exportar }]
            : []
        }
      />

      {/* Antes de qualquer número: sem saber o ano, o resto não quer dizer nada. */}
      {/* Fileira rolável, não `Segmented`: o segmentado divide a largura em partes iguais e
          quebra a partir de ~4 opções — e o número de anos agora cresce com o uso do app.
          Com UM ano só ela some: seletor de uma opção não seleciona nada, e o ano já está escrito
          no destaque ("Sobrou em 2026") e no título de Bens e Direitos. Mesma régua do badge de
          aba e do card que soma uma lista de um item. */}
      {anos.length > 1 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.anos}>
        {anos.map((a) => (
          <Chip
            key={a}
            label={String(a)}
            selected={a === ano}
            onPress={() => {
              setAno(a);
              setVerTodas(false);
            }}
          />
        ))}
      </ScrollView>
      ) : null}

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading && !isError ? (
        <>
          <Skeleton height={132} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da tela: responde a pergunta do ano em um olhar. */}
      {!isError && temMovimento && summary ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Sobrou em {ano}</HeroLabel>
            <Money
              cents={Number(summary.balance_cents)}
              variant="money"
              tone={Number(summary.balance_cents) < 0 ? 'danger' : 'text'}
            />
            <View style={styles.heroLinha}>
              <View style={styles.heroMetade}>
                <HeroLabel>Recebido</HeroLabel>
                <Money cents={Number(summary.income_cents)} variant="headline" tone="success" />
              </View>
              <View style={styles.heroMetade}>
                <HeroLabel>Gasto</HeroLabel>
                <Money cents={Number(summary.expense_cents)} variant="headline" />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              Guardou {formatNumberBR(Number(summary.savings_rate))}% do que entrou · {summary.tx_count}{' '}
              {Number(summary.tx_count) === 1 ? 'lançamento' : 'lançamentos'}
            </ThemedText>
          </Card>
        </Animated.View>
      ) : null}

      {/* Segundo lugar, e não quarto: é a ficha que a pessoa veio copiar. */}
      {!isError && !isLoading && temConteudo ? (
        <Animated.View
          entering={FadeInDown.duration(Motion.duration.slow).delay(Motion.stagger.step)}
          style={styles.bloco}
        >
          <ThemedText type="small" themeColor="textSecondary" style={styles.nota}>
            Contas e bens no último dia do ano — é o que a ficha “Bens e Direitos” da declaração
            pede. Dívidas e financiamentos entram em outra ficha e não aparecem aqui.
          </ThemedText>

          {(data?.yearEnd ?? []).length > 0 ? (
            <Section title={`Bens e direitos em 31/12/${ano}`}>
              {(data?.yearEnd ?? []).map((s) => (
                <Row
                  key={`${s.kind}-${s.name}`}
                  title={s.name}
                  icon={s.kind === 'account' ? 'banknote' : 'chart.line.uptrend.xyaxis'}
                  chevron={false}
                  accessibilityLabel={`${s.name}, ${(Number(s.balance_cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em 31 de dezembro`}
                  trailing={<Money cents={Number(s.balance_cents)} variant="headline" />}
                />
              ))}
            </Section>
          ) : (
            <Section title={`Bens e direitos em 31/12/${ano}`}>
              <Row
                title="Nenhuma conta cadastrada"
                subtitle="Cadastre para o saldo de 31/12 sair aqui"
                icon="banknote"
                onPress={() => router.push('/finance/accounts')}
              />
            </Section>
          )}
        </Animated.View>
      ) : null}

      {despesas.length > 0 ? (
        <Animated.View
          entering={FadeInDown.duration(Motion.duration.slow).delay(Motion.stagger.step * 2)}
          style={styles.bloco}
        >
          <Section title="Para onde foi">
            {visiveis.map((c) => (
              <View key={c.category} style={styles.categoria}>
                <View style={styles.categoriaTopo}>
                  <ThemedText type="default" numberOfLines={1} style={styles.categoriaNome}>
                    {c.category}
                  </ThemedText>
                  <Money cents={Number(c.total_cents)} variant="headline" />
                </View>
                <ProgressBar value={Number(c.total_cents)} max={maiorDespesa} />
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  {Math.round((Number(c.total_cents) / maiorDespesa) * 100)}% do maior ·{' '}
                  {c.tx_count} {Number(c.tx_count) === 1 ? 'lançamento' : 'lançamentos'}
                </ThemedText>
              </View>
            ))}
          </Section>
          {despesas.length > TOP_CATEGORIES && !verTodas ? (
            <Button
              label={`Ver todas as ${despesas.length}`}
              variant="secondary"
              size="sm"
              onPress={() => setVerTodas(true)}
            />
          ) : null}
        </Animated.View>
      ) : null}

      {receitas.length > 0 ? (
        <Animated.View
          entering={FadeInDown.duration(Motion.duration.slow).delay(Motion.stagger.step * 3)}
        >
          {/* Sem barra: quem tem duas fontes de renda não precisa de gráfico para compará-las. */}
          <Section title="De onde veio">
            {receitas.map((c) => (
              <Row
                key={c.category}
                title={c.category}
                chevron={false}
                trailing={<Money cents={Number(c.total_cents)} variant="headline" tone="success" />}
              />
            ))}
          </Section>
        </Animated.View>
      ) : null}

      {!isLoading && !isError && !temConteudo ? (
        <EmptyState
          icon="calendar"
          title={`Nada lançado em ${ano}`}
          hint={
            'Escolha outro ano aí em cima — ou manda “gastei 45 no mercado”\nno WhatsApp para o ano que vem já nascer pronto.'
          }
        />
      ) : null}

      {!isLoading && !isError && temConteudo ? (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.rodape}>
          Só lançamentos confirmados, sem transferências entre suas contas.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  anos: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  hero: {
    gap: Space.sm,
  },
  heroLinha: {
    flexDirection: 'row',
    gap: Space.xl,
  },
  heroMetade: {
    gap: 2,
  },
  bloco: {
    gap: Space.md,
  },
  nota: {
    paddingHorizontal: Space.lg,
  },
  categoria: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  categoriaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  categoriaNome: {
    flex: 1,
  },
  rodape: {
    paddingHorizontal: Space.lg,
  },
});
