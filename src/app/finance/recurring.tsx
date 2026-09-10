import { useInvalidateFinance } from '@/hooks/use-finance';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';

import { CategoryPicker } from '@/components/finance/category-picker';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Screen } from '@/components/ui/screen';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
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
import { validRecurringRange } from '@/lib/finance-form';
import { describeRRule } from '@/lib/rrule-text';
import { supabase } from '@/lib/supabase';
import { AccountPicker } from '@/components/finance/account-picker';

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
  /**
   * Presente = está EDITANDO uma série que já existe. A frequência e a âncora saem
   * da tela nesse modo: `dtstart` é imutável por desenho e trocar a frequência
   * implicaria remontar o calendário já materializado — isso continua sendo apagar
   * e criar de novo, que é honesto.
   */
  id?: string;
  /** Só no modo edição: a cadência que a série já tem, para mostrar (não para editar). */
  rrule?: string;
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
  const invalidate = useInvalidateFinance();
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
    onSuccess: invalidate,
  });
}

/**
 * Editar a série. Vai por RPC porque não é UM update: a regra manda nas ocorrências
 * que ainda não existem e as já materializadas (90 dias à frente, `pending`) precisam
 * acompanhar — senão os próximos três meses ficam com o valor velho e o quarto com o
 * novo. As passadas não mudam, que é a regra que o dono do produto pediu.
 */
function useSaveRecurringSeries() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, patch }: {
      id: string;
      patch: {
        amount_cents?: number;
        category?: string | null;
        description?: string | null;
        account_id?: string | null;
        auto_confirm?: boolean;
        end_date?: string | null;
      };
    }) => {
      const { data, error } = await supabase.rpc('update_recurring_series', {
        p_recurring_id: id,
        p_patch: patch,
        p_propagate: true,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: invalidate,
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

/**
 * O formulário aberto sobre uma série existente. Frequência e âncora ficam de fora
 * (`dtstart` é imutável e mudar a cadência implicaria remontar o que já foi materializado);
 * o `rrule` vai junto só para o resumo continuar legível.
 */
function formDaSerie(r: RecurringTransaction): FormState {
  return {
    id: r.id,
    rrule: r.rrule,
    kind: r.kind === 'income' ? 'income' : 'expense',
    amountCents: Number(r.amount_cents),
    description: r.description ?? '',
    category: r.category,
    accountId: r.account_id,
    preset: 'monthly',
    intervalo: '1',
    inicio: isoToBR((r.dtstart ?? r.next_run_at).slice(0, 10)),
    fim: r.end_date ? isoToBR(r.end_date) : '',
    autoConfirm: r.auto_confirm,
  };
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
  const params = useLocalSearchParams<{ create?: string; edit?: string; kind?: string; amount?: string; description?: string; category?: string; account?: string; start?: string }>();
  const theme = useTheme();
  const toast = useToast();
  const series = useRecurringTransactions();
  const proximos = useRecurringUpcoming(30);
  const accounts = useAccounts();
  const toggle = useToggleRecurring();
  const remove = useDeleteRecurring();
  const create = useCreateRecurring();
  const editar = useSaveRecurringSeries();
  /** Qual `?edit=` já foi consumido — sem isto, fechar o sheet reabriria no render seguinte. */
  const [edicaoAberta, setEdicaoAberta] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(() => params.create === '1' ? {
    ...FORM_VAZIO, kind: params.kind === 'income' ? 'income' : 'expense',
    amountCents: Number(params.amount) > 0 ? Number(params.amount) : 0,
    description: params.description ?? '', category: params.category || null,
    accountId: params.account || null,
    inicio: params.start && isValidBRDate(params.start) ? params.start : isoToBR(localISODate()),
  } : null);

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const lista = series.isError ? [] : (series.data ?? []);
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
  const fimOk = form ? form.fim === '' || (isValidBRDate(form.fim) && inicioOk && brToISO(form.fim) >= brToISO(form.inicio)) : false;
  const podeSalvar = Boolean(form && form.amountCents > 0 && inicioOk && fimOk && validRecurringRange(brToISO(form.inicio), form.fim ? brToISO(form.fim) : '', form.preset === 'monthly' ? form.intervalo : '1'));
  const rrulePrevia =
    form && inicioDate
      ? montaRRule(form.preset, inicioDate, Number(form.intervalo) || 1)
      : null;

  const salvar = () => {
    if (!form) return;
    if (form.id) {
      /**
       * Só o que MUDOU. `update_recurring_series` propaga toda chave presente para as
       * ocorrências futuras: mandar o objeto inteiro faria "corrigi só o valor do
       * aluguel" reescrever a categoria e o nome de ocorrências que alguém ajustou à
       * mão. É a mesma regra do `patchDaSerie` do formulário de lançamento.
       */
      const antes = lista.find((r) => r.id === form.id);
      const patch: Parameters<typeof editar.mutate>[0]['patch'] = {};
      if (!antes || form.amountCents !== Number(antes.amount_cents)) patch.amount_cents = form.amountCents;
      if (!antes || form.category !== antes.category) patch.category = form.category;
      const desc = form.description.trim() || null;
      if (!antes || desc !== antes.description) patch.description = desc;
      if (!antes || form.accountId !== antes.account_id) patch.account_id = form.accountId;
      if (!antes || form.autoConfirm !== antes.auto_confirm) patch.auto_confirm = form.autoConfirm;
      const fim = form.fim ? brToISO(form.fim) : null;
      if (!antes || fim !== antes.end_date) patch.end_date = fim;
      if (Object.keys(patch).length === 0) {
        setForm(null);
        return;
      }
      editar.mutate(
        { id: form.id, patch },
        {
          onSuccess: (quantas) => {
            toast({
              message: quantas > 0
                ? `Série alterada e ${quantas} ${quantas === 1 ? 'ocorrência futura' : 'ocorrências futuras'} junto.`
                : 'Série alterada.',
              tone: 'success',
            });
            setForm(null);
          },
          onError: () => toast({ message: 'Não deu para alterar a série.', tone: 'error' }),
        },
      );
      return;
    }
    if (!podeSalvar || !inicioDate || !rrulePrevia) return;
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

  const abrirEdicao = (r: RecurringTransaction) => setForm(formDaSerie(r));

  /**
   * `?edit=<id>` abre a edição direto, como `?create=1` já abria a criação — dá destino
   * para link de fora e é o que torna o sheet conferível sem toque (a vitrine monta por URL).
   *
   * Ajuste de estado NO RENDER, não em efeito: a série chega DEPOIS do primeiro render (a
   * query ainda carregava), então o inicializador do `useState` não a alcança; e `setState`
   * dentro de `useEffect` é o que o React Compiler recusa, por encadear renders. Este é o
   * padrão documentado de "ajustar estado quando a entrada muda", com guarda de idempotência.
   */
  if (params.edit && params.edit !== edicaoAberta && form === null) {
    const alvo = lista.find((r) => r.id === params.edit);
    if (alvo) {
      setEdicaoAberta(params.edit);
      setForm(formDaSerie(alvo));
    }
  }

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
      // O trigger `recurring_drop_future` (20260909090000) leva junto as ocorrências futuras
      // ainda em aberto. O que fica é histórico e conta atrasada — nenhum dos dois some
      // porque a série parou de existir.
      'As ocorrências futuras saem da projeção junto. O histórico e o que está atrasado ficam. Para só parar de gerar, pause a série.'
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
      {
        // Até 09/09/2026 esta tela só sabia criar, pausar e apagar: corrigir o valor
        // do aluguel exigia apagar a série e refazer, perdendo o histórico.
        label: 'Editar',
        icon: 'pencil' as const,
        onPress: () => abrirEdicao(r),
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
                <ThemedText type="default">
                  {r.description ?? 'sem descrição'}
                </ThemedText>
              </View>
              <Money cents={cents} variant="ticker" tone={receita ? 'success' : 'text'} />
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
      onRefresh={() => Promise.all([series.refetch(), proximos.refetch()])}
      refreshing={series.isRefetching}>
      <Stack.Screen
        options={{
          title: 'Recorrentes',
          headerLargeTitle: true,
        }}
      />

      <HeaderActions
        actions={[
          {
            label: 'Nova recorrência',
            icon: 'plus',
            onPress: () => setForm({ ...FORM_VAZIO, inicio: isoToBR(localISODate()) }),
          },
        ]}
      />

      {series.isLoading ? (
        <>
          <Skeleton height={120} radius={Radius.lg} />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {/* O único destaque da tela. Some quando não há série: "SAI R$ 0,00 / ENTRA R$ 0,00" em
          cima de um empty state é cabeçalho vazio para a tela parecer cheia — exatamente o que a
          regra da aba Hoje proíbe. */}
      {lista.length === 0 ? null : proximos.isError ? (
        <ErrorBand
          message="Não deu para somar os próximos 30 dias. A lista abaixo continua valendo."
          onRetry={proximos.refetch}
        />
      ) : proximos.data ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Próximos 30 dias</HeroLabel>
            <View style={styles.heroSplit}>
              <View style={styles.heroParte}>
                <HeroLabel>sai</HeroLabel>
                <Money cents={sai} variant="title2" />
              </View>
              <View style={styles.heroParte}>
                <HeroLabel>entra</HeroLabel>
                <Money cents={entra} variant="title2" tone="success" />
              </View>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Só o que já foi materializado pelas suas séries — os lançamentos ainda não confirmados
              dos próximos 30 dias.
            </ThemedText>
          </Card>
        </Animated.View>
      ) : null}

      {series.isError ? (
        <ErrorBand message="Não deu para carregar as recorrências." onRetry={series.refetch} />
      ) : null}

      {/* Vem primeiro: série parada = conta que não vai aparecer na projeção. */}
      {comErro.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Precisa de atenção" />
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
                    <ThemedText type="default">
                      {r.description ?? 'sem descrição'}
                    </ThemedText>
                  </View>
                  <Money cents={Number(r.amount_cents)} variant="ticker" />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
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
          <SectionHead title="Ativas" />
          {ativas.map(cartaoSerie)}
        </View>
      ) : null}

      {pausadas.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Pausadas" />
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

      <Sheet visible={form !== null} onClose={() => setForm(null)}>

          <View style={styles.sheetHead}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setForm(null)} />
            <ThemedText type="smallBold">{form?.id ? 'Editar recorrência' : 'Nova recorrência'}</ThemedText>
            <Button
              label={form?.id ? 'Salvar' : 'Criar'}
              size="sm"
              loading={create.isPending || editar.isPending}
              // Editando, a validação de calendário não se aplica: frequência e âncora
              // não estão na tela. O que precisa valer é valor > 0 e o fim opcional.
              disabled={form?.id ? !(form.amountCents > 0 && fimOk) : !podeSalvar}
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
                  onChange={(kind) =>
                    // Trocar o tipo leva o padrão junto ENQUANTO a série é nova. Numa série
                    // existente o valor é escolha dele e não pode ser reescrito por baixo.
                    setForm({ ...form, kind, ...(form.id ? {} : { autoConfirm: kind !== 'income' }) })
                  }
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
                <CategoryPicker
                  value={form.category}
                  onChange={(category) => setForm({ ...form, category })}
                />
              </Field>

              {form.id ? (
                // Editando: a frequência e a âncora saem da tela. `dtstart` é imutável
                // por desenho e mudar a cadência implicaria remontar o que já foi
                // materializado — o resumo fica, para a pessoa saber o que está mexendo.
                <ThemedText type="small" themeColor="textSecondary">
                  {describeRRule(form.rrule ?? '')}, desde {form.inicio}. Para mudar a
                  frequência, apague a série e crie outra.
                </ThemedText>
              ) : (
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
              )}

              {!form.id && form.preset === 'monthly' ? (
                <Field label="A cada quantos meses" hint="1 = todo mês. 2 = mês sim, mês não." error={Number(form.intervalo) < 1 ? 'Informe um intervalo de 1 a 99 meses' : undefined}>
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

              {form.id ? null : (
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
              )}

              {!form.id && rrulePrevia ? (
                <Animated.View key={rrulePrevia} entering={FadeIn.duration(Motion.duration.fast)}>
                  <ThemedText type="small" themeColor="tint">
                    {describeRRule(rrulePrevia)}, a partir de {form.inicio}.
                  </ThemedText>
                </Animated.View>
              ) : null}

              {/*
                ⚠️ **O placeholder era uma DATA PLAUSÍVEL (`31/12/2026`), e o campo lia como
                preenchido.** `placeholderTextColor` é `textSecondary`, a mesma cor de subtítulo:
                num campo chamado "Termina em", uma data cinza dentro da caixa é indistinguível de
                um valor gravado. A leitura do dono do produto em 09/09/2026 foi literal — *"como
                assim 'Termina em'? Se é recorrente não termina"* —, ou seja, ele entendeu que o
                salário dele pararia no fim do ano.

                Placeholder diz FORMATO; a dica diz o que o vazio SIGNIFICA. A série sem fim é o
                caso normal (salário, aluguel); a data existe para as que realmente acabam —
                financiamento de 48x, assinatura com cancelamento marcado.
              */}
              <Field
                label="Termina em"
                hint="Deixe em branco para não ter fim. Preencha só se a série acaba (um financiamento, por exemplo) — e nunca antes do início."
                error={form.fim && !fimOk ? 'Informe data válida igual ou posterior ao início' : undefined}>
                <TextField
                  value={form.fim}
                  onChangeText={(fim) => setForm({ ...form, fim })}
                  placeholder="dd/mm/aaaa"
                  keyboardType="number-pad"
                  invalid={Boolean(form.fim) && !fimOk}
                />
              </Field>

              <Field label="Conta">
                <AccountPicker
                  accounts={accounts.data ?? []}
                  value={form.accountId}
                  onChange={(accountId: string | null) => setForm({ ...form, accountId })}
                  emptyLabel="Não informar"
                />
              </Field>

              {/*
                Receita e despesa NÃO falam a mesma língua aqui. O texto antigo era todo de
                despesa ("entra como pago", "você dizer que pagou") num campo que aparece para
                os dois — o mesmo defeito que `settle-labels.ts` já tinha corrigido em outro
                lugar ("ninguém paga um salário que vai receber").

                E o padrão inverte: despesa recorrente é boleto que você sabe que sai; receita
                de terceiro é Pix que pode não chegar. Por isso receita nova nasce DESLIGADA —
                ver `FORM_VAZIO` e o `20260909110000`.
              */}
              <Field
                label={form.kind === 'income' ? 'Receber automático' : 'Confirmar automático'}
                hint={
                  form.kind === 'income'
                    ? form.autoConfirm
                      ? 'Ligado, entra no saldo sozinho na data — serve para salário, que cai sem falta.'
                      : 'Desligado, fica esperando você confirmar que o dinheiro caiu. É o certo para Pix de terceiro.'
                    : form.autoConfirm
                      ? 'Ligado, o lançamento já entra como pago na data.'
                      : 'Desligado, ele fica esperando você dizer que pagou.'
                }>
                <View style={styles.switchRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {form.kind === 'income' ? 'Entrar como recebido na data' : 'Entrar como pago na data'}
                  </ThemedText>
                  <Switch
                    accessibilityLabel={
                      form.kind === 'income'
                        ? 'Marcar como recebido automaticamente na data'
                        : 'Confirmar automaticamente na data'
                    }
                    accessibilityHint="Desligado, o lançamento fica pendente esperando você confirmar"
                    value={form.autoConfirm}
                    onValueChange={(autoConfirm) => setForm({ ...form, autoConfirm })}
                  />
                </View>
              </Field>

              <ThemedText type="small" themeColor="textSecondary">
                Os lançamentos aparecem após o processamento da série. Criar aqui não registra um gasto avulso.
              </ThemedText>
            </ScrollView>
          ) : null}
      </Sheet>
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
