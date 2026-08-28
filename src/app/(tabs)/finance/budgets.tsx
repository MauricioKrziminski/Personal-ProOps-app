import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Chip } from '@/components/finance/chip';
import { MonthPicker, currentMonth } from '@/components/finance/month-picker';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Screen } from '@/components/ui/screen';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { useToast } from '@/components/ui/toast';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  INCOME_CATEGORIES,
  SUGGESTED_CATEGORIES,
  useBudgetsStatus,
  useDeleteBudget,
  useSaveBudget,
  useTransactionsSummary,
  type BudgetStatus,
} from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { formatBRL, monthBounds } from '@/lib/dates';
import { showItemActions, type ItemAction } from '@/lib/item-actions';
import { supabase } from '@/lib/supabase';

/**
 * Orçamentos — "quanto ainda posso gastar em cada categoria este mês?".
 *
 * A resposta é o que SOBRA do limite, não o que já foi gasto (isso é a aba Financeiro). Por isso
 * o destaque é a sobra do mês e a primeira seção é a das categorias que já apertam.
 *
 * Três decisões que valem comentário:
 * - **Salvar é sempre a RPC `save_budget`.** Os dois unique de `budgets` são parciais
 *   (`month is null` / `month is not null`), e o PostgREST não manda o predicado no `ON CONFLICT`:
 *   todo `.upsert()` morre com `42P10`.
 * - **Remover distingue "só este mês" do "padrão"** (ver `useBudgetRows` abaixo).
 * - **O form é um `Modal` `pageSheet` da própria tela**, não uma rota nova: criar rota exigiria
 *   mexer no `_layout` da pilha, fora do escopo desta entrega.
 */

interface BudgetRow {
  id: string;
  category: string;
  limit_cents: number;
  rollover: boolean;
  /** `YYYY-MM-01` quando a linha sobrescreve um mês; `null` no limite padrão. */
  month: string | null;
}

/**
 * `useBudgets()` (`use-finance.ts`) seleciona só `id, category, limit_cents` — sem `month` não dá
 * para saber qual linha é o limite padrão e qual é o override do mês, e a tela apagava "a primeira
 * com aquela categoria". Enquanto a coluna não entra no select do hook, a consulta mora aqui.
 *
 * A `queryKey` começa em `['budgets']` de propósito: o invalidate das mutations de finanças casa
 * por prefixo, então salvar/remover continua atualizando esta lista sem nenhum fio extra.
 */
function useBudgetRows() {
  useRealtimeInvalidate('budgets', ['budgets']);
  return useQuery({
    queryKey: ['budgets', 'with-month'],
    queryFn: async (): Promise<BudgetRow[]> => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, category, limit_cents, month, rollover')
        .order('category');
      if (error) throw error;
      return data as BudgetRow[];
    },
  });
}

interface FormState {
  category: string | null;
  limitCents: number;
  scope: 'default' | 'month';
  rollover: boolean;
  /** Em edição a categoria é a identidade do orçamento: fixa, não editável. */
  editing: boolean;
}

const CATEGORIAS_DESPESA = SUGGESTED_CATEGORIES.filter(
  (c) => !(INCOME_CATEGORIES as readonly string[]).includes(c)
);

/** `2026-08` → `agosto` (para o rótulo da ação de remover e das legendas). */
function nomeDoMes(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
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

export default function BudgetsScreen() {
  const theme = useTheme();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [form, setForm] = useState<FormState | null>(null);
  const [noControleAberto, setNoControleAberto] = useState(true);

  const status = useBudgetsStatus(month);
  const rows = useBudgetRows();
  const { from, to } = monthBounds(month);
  const resumo = useTransactionsSummary(from, to);
  const save = useSaveBudget();
  const remove = useDeleteBudget();

  const linhas = status.data ?? [];
  const limite = linhas.reduce((s, b) => s + Number(b.limit_cents), 0);
  const gasto = linhas.reduce((s, b) => s + Number(b.spent_cents), 0);
  const noLimite = linhas.filter((b) => Number(b.spent_cents) <= Number(b.limit_cents)).length;

  const pctDe = (b: BudgetStatus) =>
    Number(b.limit_cents) > 0 ? Number(b.spent_cents) / Number(b.limit_cents) : 0;

  const apertando = linhas.filter((b) => pctDe(b) >= 0.8).sort((a, b) => pctDe(b) - pctDe(a));
  const tranquilas = linhas.filter((b) => pctDe(b) < 0.8);

  // Categorias com gasto no mês e sem limite nenhum: a conversão mais natural da tela.
  const semLimite = (resumo.data ?? [])
    .filter((r) => r.kind === 'expense' && !linhas.some((b) => b.category === r.category))
    .sort((a, b) => Number(b.total_cents) - Number(a.total_cents));

  const mesFuturo = month > currentMonth();

  const abrirNovo = (categoria?: string) =>
    setForm({
      category: categoria ?? null,
      limitCents: 0,
      scope: mesFuturo ? 'month' : 'default',
      rollover: false,
      editing: false,
    });

  const abrirEdicao = (b: BudgetStatus) =>
    setForm({
      category: b.category,
      // o limite BASE, nunca o efetivo — este já vem com o rollover somado
      limitCents: Number(b.base_limit_cents),
      scope: b.month ? 'month' : 'default',
      rollover: Boolean(b.rollover),
      editing: true,
    });

  const verLancamentos = (category: string) =>
    router.push({ pathname: '/finance/transactions', params: { month, category } });

  const salvar = () => {
    if (!form?.category || form.limitCents <= 0) return;
    const entrada = {
      category: form.category,
      limit_cents: form.limitCents,
      rollover: form.rollover,
      month: form.scope === 'month' ? month : null,
    };
    save.mutate(entrada, {
      onSuccess: () => {
        toast({ message: `Limite de ${entrada.category} salvo.`, tone: 'success' });
        setForm(null);
      },
      // o banco explica o motivo (limite ≤ 0, categoria vazia, sem workspace); esconder isso
      // atrás de "não deu para salvar" é jogar fora a única informação útil
      onError: (erro: Error) =>
        toast({ message: `Não deu para salvar. ${erro.message}`, tone: 'error' }),
    });
  };

  const remover = (row: BudgetRow, rotulo: string) =>
    remove.mutate(row.id, {
      onSuccess: () =>
        toast({
          message: `${rotulo} removido.`,
          tone: 'success',
          action: {
            label: 'Desfazer',
            onPress: () =>
              save.mutate(
                {
                  category: row.category,
                  limit_cents: row.limit_cents,
                  // sem isto o desfazer devolvia o limite SEM o acúmulo de sobra
                  rollover: row.rollover,
                  month: row.month ? row.month.slice(0, 7) : null,
                },
                {
                  onError: () =>
                    toast({ message: 'Não deu para restaurar o limite.', tone: 'error' }),
                }
              ),
          },
        }),
      onError: () => toast({ message: 'Não deu para remover o limite.', tone: 'error' }),
    });

  const acoes = (b: BudgetStatus) => {
    const daCategoria = (rows.data ?? []).filter((r) => r.category === b.category);
    const doMes = daCategoria.find((r) => r.month === `${month}-01`);
    const padrao = daCategoria.find((r) => r.month === null);

    const acoesDaLinha: ItemAction[] = [
      { label: 'Editar limite', onPress: () => abrirEdicao(b) },
      { label: 'Ver lançamentos', onPress: () => verLancamentos(b.category) },
    ];

    // Sem a lista de linhas não dá para saber o que se está apagando: melhor não oferecer.
    if (rows.isError || rows.isLoading) {
      acoesDaLinha.push({ label: 'Recarregue para poder remover', onPress: () => rows.refetch() });
    } else {
      if (doMes) {
        acoesDaLinha.push({
          label: `Remover só o limite de ${nomeDoMes(month)}`,
          destructive: true,
          onPress: () => remover(doMes, `Limite de ${nomeDoMes(month)}`),
        });
      }
      if (padrao) {
        acoesDaLinha.push({
          label: 'Remover o limite padrão',
          destructive: true,
          onPress: () => remover(padrao, 'Limite padrão'),
        });
      }
    }

    showItemActions(b.category, acoesDaLinha);
  };

  const linhaOrcamento = (b: BudgetStatus, index: number) => {
    const gastoCents = Number(b.spent_cents);
    const limiteCents = Number(b.limit_cents);
    const pct = pctDe(b);
    const estourou = gastoCents > limiteCents;
    const tom = estourou ? 'danger' : pct >= 0.8 ? 'warning' : 'success';
    const sobra = limiteCents - gastoCents;

    return (
      <Animated.View
        key={b.category}
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${b.category}, gastou ${formatBRL(gastoCents)} de ${formatBRL(limiteCents)}, ${Math.round(pct * 100)} por cento${estourou ? ', estourou' : ''}`}
          onPress={() => verLancamentos(b.category)}
          onLongPress={() => acoes(b)}>
          <Card style={styles.linha}>
            <View style={styles.linhaTopo}>
              <View style={styles.linhaTitulo}>
                {estourou ? (
                  <Icon name="exclamationmark.triangle" size="sm" color="danger" />
                ) : null}
                <ThemedText type="default" numberOfLines={1}>
                  {b.category}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" themeColor={tom} style={tabular}>
                {Math.round(pct * 100)}%
              </ThemedText>
            </View>

            <ProgressBar value={gastoCents} max={limiteCents} tone={tom} />

            <View style={styles.valores}>
              <Money cents={gastoCents} variant="subhead" tone="textSecondary" />
              <ThemedText type="small" themeColor="textSecondary">
                de
              </ThemedText>
              <Money cents={limiteCents} variant="subhead" tone="textSecondary" />
              <ThemedText type="small" themeColor="textSecondary">
                ·
              </ThemedText>
              <ThemedText type="small" themeColor={estourou ? 'danger' : 'textSecondary'}>
                {estourou ? 'estourou em' : 'faltam'}
              </ThemedText>
              <Money
                cents={Math.abs(sobra)}
                variant="subhead"
                tone={estourou ? 'danger' : 'textSecondary'}
              />
            </View>

            {/* De onde o limite vem — sem isso o número parece arbitrário. */}
            {Number(b.rollover_cents) > 0 || b.month ? (
              <View style={styles.origem}>
                {Number(b.rollover_cents) > 0 ? (
                  <>
                    <Money cents={Number(b.base_limit_cents)} variant="footnote" tone="textSecondary" />
                    <ThemedText type="footnote" themeColor="textSecondary">
                      +
                    </ThemedText>
                    <Money cents={Number(b.rollover_cents)} variant="footnote" tone="textSecondary" />
                    <ThemedText type="footnote" themeColor="textSecondary">
                      que sobrou
                    </ThemedText>
                  </>
                ) : null}
                {b.month ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    só este mês
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
          </Card>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => {
        status.refetch();
        rows.refetch();
        resumo.refetch();
      }}
      refreshing={status.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Orçamentos',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions actions={[{ label: 'Novo orçamento', icon: 'plus', onPress: () => abrirNovo() }]} />

      <MonthPicker month={month} onChange={setMonth} />

      {status.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela: é o número que decide o comportamento de hoje à noite. */}
      {status.isError ? (
        <ErrorBand message="Não deu para carregar os orçamentos." onRetry={status.refetch} />
      ) : linhas.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <HeroLabel>Sobrou do mês</HeroLabel>
            <Money
              cents={limite - gasto}
              variant="money"
              tone={limite - gasto < 0 ? 'danger' : 'text'}
            />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {noLimite} de {linhas.length}{' '}
              {linhas.length === 1 ? 'categoria no limite' : 'categorias no limite'}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {apertando.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Passando do limite" />
          {apertando.map(linhaOrcamento)}
        </View>
      ) : null}

      {tranquilas.length > 0 ? (
        <View style={styles.secao}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: noControleAberto }}
            accessibilityLabel={`No controle, ${tranquilas.length} categorias`}
            onPress={() => setNoControleAberto((v) => !v)}>
            <SectionHead
              title="No controle"
              action={
                <Icon
                  name={noControleAberto ? 'chevron.up' : 'chevron.down'}
                  size="sm"
                  color="textSecondary"
                />
              }
            />
          </Pressable>
          {noControleAberto ? tranquilas.map(linhaOrcamento) : null}
        </View>
      ) : null}

      {resumo.isError ? (
        <ErrorBand
          message="Não deu para ver em que você gastou sem limite."
          onRetry={resumo.refetch}
        />
      ) : semLimite.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Sem limite definido" />
          {semLimite.slice(0, 5).map((r) => (
            <Card key={r.category} style={styles.linha}>
              <View style={styles.linhaTopo}>
                <ThemedText type="default" numberOfLines={1}>
                  {r.category}
                </ThemedText>
                <Money cents={Number(r.total_cents)} variant="headline" tone="textSecondary" />
              </View>
              <Button
                label="Definir limite"
                variant="secondary"
                size="sm"
                onPress={() => abrirNovo(r.category)}
              />
            </Card>
          ))}
        </View>
      ) : null}

      {!status.isLoading && !status.isError && linhas.length === 0 ? (
        <EmptyState
          icon="chart.bar.doc.horizontal"
          title={
            mesFuturo
              ? `${nomeDoMes(month).charAt(0).toUpperCase()}${nomeDoMes(month).slice(1)} ainda usa seus limites padrão`
              : 'Você ainda não tem limite nenhum'
          }
          hint={
            mesFuturo
              ? 'Toque em + para sobrescrever só este mês.'
              : 'Comece pelo que mais aperta: mercado. Toque em + e defina quanto quer gastar por mês.'
          }
          action={{
            label: 'Definir limite',
            onPress: () => abrirNovo(semLimite[0]?.category),
          }}
        />
      ) : null}

      <Modal
        visible={form !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setForm(null)}>
        <View style={[styles.sheet, { backgroundColor: theme.groupedBackground }]}>
          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">
              {form?.editing ? 'Editar limite' : 'Novo orçamento'}
            </ThemedText>
            <Button
              label="Salvar"
              size="sm"
              loading={save.isPending}
              disabled={!form?.category || (form?.limitCents ?? 0) <= 0}
              onPress={salvar}
            />
          </View>

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field
                label="Categoria"
                hint={
                  form.editing ? 'A categoria é a identidade do orçamento e não muda.' : undefined
                }>
                {form.editing ? (
                  <ThemedText type="default">{form.category}</ThemedText>
                ) : (
                  <View style={styles.chips}>
                    {CATEGORIAS_DESPESA.map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        selected={form.category === c}
                        onPress={() => setForm({ ...form, category: form.category === c ? null : c })}
                      />
                    ))}
                  </View>
                )}
              </Field>

              <Field label="Limite">
                <MoneyField
                  valueCents={form.limitCents}
                  onChangeCents={(limitCents) => setForm({ ...form, limitCents })}
                />
              </Field>

              <Field
                label="Escopo"
                hint={`Só este mês sobrescreve o limite padrão em ${nomeDoMes(month)} e não mexe nos outros.`}>
                <Segmented
                  options={[
                    { value: 'default', label: 'Todo mês' },
                    { value: 'month', label: 'Só este mês' },
                  ]}
                  value={form.scope}
                  onChange={(scope) => setForm({ ...form, scope })}
                />
              </Field>

              <Field
                label="Acumular sobra"
                hint={
                  form.rollover
                    ? 'O que sobrar de um mês soma no limite do mês seguinte. Um mês só — a sobra não empilha. E vale a partir do primeiro mês inteiro depois de você criar o orçamento.'
                    : 'Sem acúmulo: cada mês começa do zero.'
                }>
                <View style={styles.switchRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Somar a sobra do mês anterior
                  </ThemedText>
                  <Switch
                    accessibilityLabel="Acumular a sobra do mês anterior"
                    value={form.rollover}
                    onValueChange={(rollover) => setForm({ ...form, rollover })}
                  />
                </View>
              </Field>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: Space.sm,
  },
  secao: {
    gap: Space.sm,
  },
  linha: {
    gap: Space.sm,
  },
  linhaTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  linhaTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    flexShrink: 1,
  },
  valores: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  origem: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.xs,
  },
  band: {
    alignItems: 'center',
    gap: Space.sm,
  },
  bandText: {
    textAlign: 'center',
  },
  sheet: {
    flex: 1,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  sheetBody: {
    gap: Space.xl,
    padding: Space.lg,
    paddingBottom: Space.xxxl,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
});
