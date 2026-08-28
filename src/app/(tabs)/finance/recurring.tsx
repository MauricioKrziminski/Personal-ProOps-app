import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Stack, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useDeleteRecurring,
  useRecurringTransactions,
  useToggleRecurring,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { brToISO, isValidBRDate, isoToBR, localDateTime, localISODate } from '@/lib/dates';
import { confirmDestructive, showItemActions } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';
import { supabase } from '@/lib/supabase';

/**
 * Recorrentes — "o que vai sair da minha conta todo mês sem eu fazer nada?".
 *
 * Como a série funciona (e por que a tela respeita isso):
 * - **RRULE + `dtstart`**: `dtstart` é a âncora imutável. A UI nunca o edita depois de criado —
 *   mudar o início é criar outra série.
 * - **`next_run_at` é a próxima ocorrência FUTURA**; `materialized_until` é controle do cron e não
 *   aparece na tela.
 * - O `finance-scheduler` materializa **90 dias à frente** como `transactions` `pending`
 *   (`cleared` se a data já passou e `auto_confirm` for true), com unique
 *   `(recurring_id, occurred_at)` garantindo que rodar duas vezes não duplica.
 */

interface FormState {
  kind: 'expense' | 'income';
  amountCents: number;
  description: string;
  category: string | null;
  accountId: string | null;
  preset: 'monthly' | 'weekly' | 'yearly';
  /** Só no preset mensal: `A cada N meses`. */
  intervalo: string;
  /** dd/mm/aaaa — vira `dtstart` E o `next_run_at` inicial. */
  inicio: string;
  /** dd/mm/aaaa, opcional: é como se encerra uma assinatura sem apagar o histórico. */
  fim: string;
  autoConfirm: boolean;
}

const DIAS_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * A RRULE sai do preset + da data de início — nunca de um campo de texto livre, que seria um
 * gerador de série quebrada. A frase de volta vem do mesmo `describeRRule` das séries da IA.
 */
function montaRRule(preset: FormState['preset'], inicio: Date, intervalo: number): string {
  if (preset === 'weekly') return `FREQ=WEEKLY;BYDAY=${DIAS_RRULE[inicio.getDay()]}`;
  if (preset === 'yearly')
    return `FREQ=YEARLY;BYMONTH=${inicio.getMonth() + 1};BYMONTHDAY=${inicio.getDate()}`;
  const passo = intervalo > 1 ? `;INTERVAL=${intervalo}` : '';
  return `FREQ=MONTHLY${passo};BYMONTHDAY=${inicio.getDate()}`;
}

/**
 * Destaque dos 30 dias: sai das ocorrências JÁ materializadas, nunca de uma soma dos
 * `amount_cents` da lista — séries semanais, mensais e anuais não somam no mesmo denominador, e um
 * número errado num card de destaque é pior que nenhum número.
 *
 * Mora aqui (e não em `use-finance.ts`) porque o hook equivalente ainda não existe; a `queryKey`
 * começa em `['recurring']` de propósito, para o invalidate por prefixo das mutations pegá-la.
 */
function useRecurringUpcoming(days = 30) {
  useRealtimeInvalidate('transactions', ['recurring']);
  const de = localISODate();
  return useQuery({
    queryKey: ['recurring', 'upcoming', String(days), de],
    queryFn: async (): Promise<{ kind: string; amount_cents: number }[]> => {
      const agora = new Date();
      // `new Date(y, m, d + days)` já vira o mês/ano sozinho
      const ate = localISODate(new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + days));
      const { data, error } = await supabase
        .from('transactions')
        .select('kind, amount_cents')
        .not('recurring_id', 'is', null)
        .eq('status', 'pending')
        .gte('occurred_at', de)
        .lte('occurred_at', ate);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Criar série. Editar NÃO passa por aqui: mudar o valor precisa reescrever, na mesma transação, as
 * ocorrências `pending` já materializadas — isso é a RPC `save_recurring`, que ainda não existe.
 * Duas chamadas do app deixariam a série nova com 90 dias de lançamentos antigos.
 */
function useCreateRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kind: 'expense' | 'income';
      amount_cents: number;
      description: string | null;
      category: string | null;
      account_id: string | null;
      rrule: string;
      next_run_at: string;
      end_date: string | null;
      auto_confirm: boolean;
    }) => {
      const { data: sessao, error: erroSessao } = await supabase.auth.getUser();
      if (erroSessao || !sessao.user) throw erroSessao ?? new Error('sem sessão');
      const { error } = await supabase.from('recurring_transactions').insert({
        ...input,
        // âncora imutável da série: sem ela a hora de parede deriva a cada rodada do cron
        dtstart: input.next_run_at,
        user_id: sessao.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
      queryClient.invalidateQueries({ queryKey: ['forecast'] });
    },
  });
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

const FORM_VAZIO: FormState = {
  kind: 'expense',
  amountCents: 0,
  description: '',
  category: null,
  accountId: null,
  preset: 'monthly',
  intervalo: '1',
  inicio: isoToBR(localISODate()),
  fim: '',
  autoConfirm: true,
};

export default function RecurringScreen() {
  const theme = useTheme();
  const toast = useToast();
  const series = useRecurringTransactions();
  const proximos = useRecurringUpcoming(30);
  const accounts = useAccounts();
  const toggle = useToggleRecurring();
  const remove = useDeleteRecurring();
  const create = useCreateRecurring();

  const [form, setForm] = useState<FormState | null>(null);

  const lista = series.data ?? [];
  const comErro = lista.filter((r) => r.last_error);
  const ativas = lista.filter((r) => r.active && !r.last_error);
  const pausadas = lista.filter((r) => !r.active && !r.last_error);

  const sai = (proximos.data ?? [])
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + Number(t.amount_cents), 0);
  const entra = (proximos.data ?? [])
    .filter((t) => t.kind === 'income')
    .reduce((s, t) => s + Number(t.amount_cents), 0);

  const inicioDate = form ? localDateTime(form.inicio, '09:00') : null;
  const inicioOk = Boolean(form && isValidBRDate(form.inicio) && inicioDate);
  const fimOk = form ? form.fim === '' || isValidBRDate(form.fim) : false;
  const podeSalvar = Boolean(form && form.amountCents > 0 && inicioOk && fimOk);
  const rrulePrevia =
    form && inicioDate
      ? montaRRule(form.preset, inicioDate, Number(form.intervalo) || 1)
      : null;

  const salvar = () => {
    if (!form || !podeSalvar || !inicioDate || !rrulePrevia) return;
    create.mutate(
      {
        kind: form.kind,
        amount_cents: form.amountCents,
        description: form.description.trim() || null,
        category: form.category,
        account_id: form.accountId,
        rrule: rrulePrevia,
        next_run_at: inicioDate.toISOString(),
        end_date: form.fim ? brToISO(form.fim) : null,
        auto_confirm: form.autoConfirm,
      },
      {
        onSuccess: () => {
          toast({ message: 'Recorrência criada.', tone: 'success' });
          setForm(null);
        },
        onError: () => toast({ message: 'Não deu para criar a recorrência.', tone: 'error' }),
      }
    );
  };

  const alternar = (r: RecurringTransaction) =>
    toggle.mutate(
      { id: r.id, active: !r.active },
      {
        onSuccess: () =>
          toast({
            message: r.active ? 'Série pausada.' : 'Série retomada.',
            tone: 'success',
          }),
        onError: () => toast({ message: 'Não deu para mudar a série.', tone: 'error' }),
      }
    );

  const apagar = (r: RecurringTransaction) =>
    confirmDestructive(
      `Apagar "${r.description ?? 'recorrência'}"?`,
      'Apagar',
      () =>
        remove.mutate(r.id, {
          onSuccess: () => toast({ message: 'Recorrência apagada.', tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar a série.', tone: 'error' }),
        }),
      // honestidade sobre o FUTURO, não só sobre o passado: a série sai, mas as ocorrências já
      // materializadas (até 90 dias) continuam pesando na projeção até serem apagadas à mão
      'A série para de gerar. Os lançamentos já criados continuam — inclusive os futuros, que seguem na projeção. Para tirá-los, apague em Lançamentos. Para só parar de gerar, pause a série.'
    );

  const acoes = (r: RecurringTransaction) =>
    showItemActions(r.description ?? 'Recorrência', [
      {
        label: 'Ver ocorrências',
        onPress: () =>
          router.push({
            pathname: '/finance/transactions',
            params: { recurringId: r.id, month: r.next_run_at.slice(0, 7) },
          }),
      },
      { label: r.active ? 'Pausar' : 'Retomar', onPress: () => alternar(r) },
      { label: 'Apagar', destructive: true, onPress: () => apagar(r) },
    ]);

  const cartaoSerie = (r: RecurringTransaction, index: number) => {
    const receita = r.kind === 'income';
    const cents = Number(r.amount_cents);
    const quando = describeRRule(r.rrule);

    return (
      <Animated.View
        key={r.id}
        layout={LinearTransition.duration(Motion.duration.base)}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${r.description ?? 'recorrência'}, ${receita ? 'receita' : 'despesa'}, ${quando}, próximo em ${isoToBR(r.next_run_at.slice(0, 10))}${r.active ? '' : ', pausado'}`}
          onPress={() => acoes(r)}
          onLongPress={() => acoes(r)}>
          <Card style={[styles.serie, r.active ? null : styles.pausada]}>
            <View style={styles.serieTopo}>
              <View style={styles.serieTitulo}>
                <Icon
                  name={receita ? 'arrow.down.left' : 'arrow.up.right'}
                  size="md"
                  color={receita ? 'success' : 'textSecondary'}
                />
                <ThemedText type="default" numberOfLines={1}>
                  {r.description ?? 'sem descrição'}
                </ThemedText>
              </View>
              <Money cents={cents} variant="headline" tone={receita ? 'success' : 'text'} />
              {/* ação primária da tela: um toque, alvo próprio de 44pt */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${r.active ? 'Pausar' : 'Retomar'} ${r.description ?? 'recorrência'}`}
                hitSlop={12}
                onPress={() => alternar(r)}
                style={styles.alternar}>
                <Icon name={r.active ? 'pause.circle' : 'play.circle'} size="lg" color="tint" />
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {quando} · próximo em {isoToBR(r.next_run_at.slice(0, 10))}
              {r.category ? ` · ${r.category}` : ''}
              {r.active ? '' : ' · pausada'}
            </ThemedText>
          </Card>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <Screen
      grouped
      onRefresh={() => {
        series.refetch();
        proximos.refetch();
      }}
      refreshing={series.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Recorrentes',
          headerLargeTitle: true,
          headerRight: () => (
            <Pressable
              accessibilityLabel="Nova recorrência"
              hitSlop={12}
              onPress={() => setForm({ ...FORM_VAZIO, inicio: isoToBR(localISODate()) })}>
              <Icon name="plus.circle.fill" size="lg" color="tint" />
            </Pressable>
          ),
        }}
      />

      {series.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único GlassCard da tela. */}
      {proximos.isError ? (
        <ErrorBand
          message="Não deu para somar os próximos 30 dias. A lista abaixo continua valendo."
          onRetry={proximos.refetch}
        />
      ) : proximos.data ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              Próximos 30 dias
            </ThemedText>
            <View style={styles.heroSplit}>
              <View style={styles.heroParte}>
                <ThemedText type="small" themeColor="textSecondary">
                  sai
                </ThemedText>
                <Money cents={sai} variant="title2" />
              </View>
              <View style={styles.heroParte}>
                <ThemedText type="small" themeColor="textSecondary">
                  entra
                </ThemedText>
                <Money cents={entra} variant="title2" tone="success" />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Só o que já foi materializado pelas suas séries — os lançamentos ainda não confirmados
              dos próximos 30 dias.
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {series.isError ? (
        <ErrorBand message="Não deu para carregar as recorrências." onRetry={series.refetch} />
      ) : null}

      {/* Vem primeiro: série parada = conta que não vai aparecer na projeção. */}
      {comErro.length > 0 ? (
        <View style={styles.secao}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.secaoTitulo}>
            PRECISA DE ATENÇÃO
          </ThemedText>
          {comErro.map((r) => (
            <Animated.View key={r.id} entering={FadeIn.duration(Motion.duration.base)}>
              <Card
                style={[
                  styles.serie,
                  { borderColor: theme.warning, borderWidth: StyleSheet.hairlineWidth },
                ]}>
                <View style={styles.serieTopo}>
                  <View style={styles.serieTitulo}>
                    <Icon name="exclamationmark.triangle" size="md" color="warning" />
                    <ThemedText type="default" numberOfLines={1}>
                      {r.description ?? 'sem descrição'}
                    </ThemedText>
                  </View>
                  <Money cents={Number(r.amount_cents)} variant="headline" />
                </View>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                  {r.last_error}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  tentativa {r.run_attempts} de 5 · retomar zera o contador
                </ThemedText>
                <View style={styles.acoesErro}>
                  <Button
                    label={r.active ? 'Pausar' : 'Retomar'}
                    size="sm"
                    variant="secondary"
                    onPress={() => alternar(r)}
                  />
                  <Button
                    label="Mais ações"
                    size="sm"
                    variant="ghost"
                    onPress={() => acoes(r)}
                  />
                </View>
              </Card>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {ativas.length > 0 ? (
        <View style={styles.secao}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.secaoTitulo}>
            ATIVAS
          </ThemedText>
          {ativas.map(cartaoSerie)}
        </View>
      ) : null}

      {pausadas.length > 0 ? (
        <View style={styles.secao}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.secaoTitulo}>
            PAUSADAS
          </ThemedText>
          {pausadas.map(cartaoSerie)}
        </View>
      ) : null}

      {!series.isLoading && !series.isError && lista.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="Nada se repete ainda"
          hint={'Manda no WhatsApp: “todo dia 5 pago 1200 de aluguel”\n— ou toca em + para cadastrar aqui.'}
          action={{
            label: 'Nova recorrência',
            onPress: () => setForm({ ...FORM_VAZIO, inicio: isoToBR(localISODate()) }),
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
            <ThemedText type="smallBold">Nova recorrência</ThemedText>
            <Button
              label="Criar"
              size="sm"
              loading={create.isPending}
              disabled={!podeSalvar}
              onPress={salvar}
            />
          </View>

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Field label="Tipo">
                <Segmented
                  options={[
                    { value: 'expense', label: 'Despesa' },
                    { value: 'income', label: 'Receita' },
                  ]}
                  value={form.kind}
                  onChange={(kind) => setForm({ ...form, kind })}
                />
              </Field>

              <Field label="Valor">
                <MoneyField
                  valueCents={form.amountCents}
                  onChangeCents={(amountCents) => setForm({ ...form, amountCents })}
                />
              </Field>

              <Field label="Descrição">
                <TextField
                  value={form.description}
                  onChangeText={(description) => setForm({ ...form, description })}
                  placeholder="Aluguel"
                />
              </Field>

              <Field label="Categoria">
                <View style={styles.chips}>
                  {SUGGESTED_CATEGORIES.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      selected={form.category === c}
                      onPress={() => setForm({ ...form, category: form.category === c ? null : c })}
                    />
                  ))}
                </View>
              </Field>

              <Field label="Repete">
                <Segmented
                  options={[
                    { value: 'monthly', label: 'Todo mês' },
                    { value: 'weekly', label: 'Toda semana' },
                    { value: 'yearly', label: 'Todo ano' },
                  ]}
                  value={form.preset}
                  onChange={(preset) => setForm({ ...form, preset })}
                />
              </Field>

              {form.preset === 'monthly' ? (
                <Field label="A cada quantos meses" hint="1 = todo mês. 2 = mês sim, mês não.">
                  <TextField
                    value={form.intervalo}
                    onChangeText={(v) =>
                      setForm({ ...form, intervalo: v.replace(/\D/g, '').slice(0, 2) })
                    }
                    placeholder="1"
                    keyboardType="number-pad"
                  />
                </Field>
              ) : null}

              <Field
                label="Começa em"
                hint="É a âncora da série e não muda depois. Data no passado lança as ocorrências antigas de uma vez."
                error={form.inicio && !inicioOk ? 'Data inválida (dd/mm/aaaa)' : undefined}>
                <TextField
                  value={form.inicio}
                  onChangeText={(inicio) => setForm({ ...form, inicio })}
                  placeholder="05/09/2026"
                  keyboardType="number-pad"
                  invalid={Boolean(form.inicio) && !inicioOk}
                />
              </Field>

              {rrulePrevia ? (
                <Animated.View key={rrulePrevia} entering={FadeIn.duration(Motion.duration.fast)}>
                  <ThemedText type="small" themeColor="tint">
                    {describeRRule(rrulePrevia)}, a partir de {form.inicio}.
                  </ThemedText>
                </Animated.View>
              ) : null}

              <Field
                label="Termina em"
                hint="Opcional. É como se encerra uma assinatura sem apagar o histórico."
                error={form.fim && !fimOk ? 'Data inválida (dd/mm/aaaa)' : undefined}>
                <TextField
                  value={form.fim}
                  onChangeText={(fim) => setForm({ ...form, fim })}
                  placeholder="31/12/2026"
                  keyboardType="number-pad"
                  invalid={Boolean(form.fim) && !fimOk}
                />
              </Field>

              <Field label="Conta">
                <Section>
                  <Row
                    title="Não informar"
                    chevron={false}
                    onPress={() => setForm({ ...form, accountId: null })}
                    trailing={
                      form.accountId === null ? (
                        <Icon name="checkmark" size="sm" color="tint" />
                      ) : undefined
                    }
                  />
                  {(accounts.data ?? []).map((a) => (
                    <Row
                      key={a.id}
                      title={a.name}
                      chevron={false}
                      onPress={() => setForm({ ...form, accountId: a.id })}
                      trailing={
                        form.accountId === a.id ? (
                          <Icon name="checkmark" size="sm" color="tint" />
                        ) : undefined
                      }
                    />
                  ))}
                </Section>
              </Field>

              <Field
                label="Confirmar automático"
                hint={
                  form.autoConfirm
                    ? 'Ligado, o lançamento já entra como pago na data.'
                    : 'Desligado, ele fica esperando você dizer que pagou.'
                }>
                <View style={styles.switchRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Entrar como pago na data
                  </ThemedText>
                  <Switch
                    accessibilityLabel="Confirmar automaticamente na data"
                    accessibilityHint="Desligado, o lançamento fica pendente esperando você confirmar"
                    value={form.autoConfirm}
                    onValueChange={(autoConfirm) => setForm({ ...form, autoConfirm })}
                  />
                </View>
              </Field>

              <ThemedText type="small" themeColor="textSecondary">
                Pelo WhatsApp é mais rápido: “todo dia 5 pago 1200 de aluguel”.
              </ThemedText>
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
  heroSplit: {
    flexDirection: 'row',
    gap: Space.xl,
  },
  heroParte: {
    gap: Space.xs,
  },
  secao: {
    gap: Space.sm,
  },
  secaoTitulo: {
    paddingHorizontal: Space.lg,
    letterSpacing: 0.5,
  },
  serie: {
    gap: Space.sm,
  },
  pausada: {
    opacity: 0.6,
  },
  serieTopo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  serieTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flexShrink: 1,
  },
  acoesErro: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  alternar: {
    minWidth: HitTarget,
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
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
