import { useInvalidateFinance } from '@/hooks/use-finance';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';

import { CamposDaSerie } from '@/components/finance/serie-form';
import { SERIE_VAZIA, serieDoRegistro, validaSerie, type SerieForm } from '@/lib/serie';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Sheet } from '@/components/ui/sheet';
import { TaskHeader } from '@/components/ui/task-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { PressableScale } from '@/components/motion/pressable-scale';
import { VerMais } from '@/components/ui/ver-mais';
import { useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { Search } from '@/components/ui/search';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useDeleteRecurring,
  useRecurringTransactions,
  useSaveRecurringSeries,
  useToggleRecurring,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { useVoltarQuandoFechar } from '@/hooks/use-voltar-quando-fechar';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useDebounced } from '@/hooks/use-debounced';
import { semAcento } from '@/lib/text';
import { brToISO, dataLocalDe, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { financeErrorMessage } from '@/lib/finance-form';
import { describeRRule } from '@/lib/rrule-text';
import { supabase } from '@/lib/supabase';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Recorrentes — "o que vai sair da minha conta todo mês sem eu fazer nada?".
 *
 * Como a série funciona (e por que a tela respeita isso):
 * - **RRULE + `dtstart`**: `dtstart` é a âncora. Editar a repetição ou o próximo vencimento
 *   (26/09/2026) muda a regra e a âncora para o próximo vencimento, e as ocorrências FUTURAS em
 *   aberto são refeitas (`update_recurring_series`); o passado não muda.
 * - **`next_run_at` é a próxima ocorrência FUTURA**; `materialized_until` é controle do cron e não
 *   aparece na tela.
 * - O `finance-scheduler` materializa **90 dias à frente** como `transactions` `pending`
 *   (`cleared` se a data já passou e `auto_confirm` for true), com unique
 *   `(recurring_id, occurred_at)` garantindo que rodar duas vezes não duplica.
 */

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
 * Criar série. Editar NÃO passa por aqui: mudar a série reescreve, na mesma transação, as
 * ocorrências `pending` já materializadas — é a RPC `update_recurring_series`.
 */
function useCreateRecurring() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      kind: 'expense' | 'income';
      amount_cents: number;
      description: string | null;
      merchant: string | null;
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
        // âncora da série: sem ela a hora de parede deriva a cada rodada do cron
        dtstart: input.next_run_at,
        user_id: sessao.user.id,
      });
      if (error) throw error;
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

export default function RecurringScreen() {
  const params = useLocalSearchParams<{ create?: string; edit?: string; kind?: string; amount?: string; description?: string; merchant?: string; category?: string; account?: string; start?: string }>();
  const theme = useTheme();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
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
  // `?create=1` já nasce vindo de fora (é o "Repetir lançamento" e o atalho do Financeiro).
  const volta = useVoltarQuandoFechar(params.create === '1');

  const [form, setForm] = useState<SerieForm | null>(() => params.create === '1' ? {
    ...SERIE_VAZIA, kind: params.kind === 'income' ? 'income' : 'expense',
    amountCents: Number(params.amount) > 0 ? Number(params.amount) : 0,
    description: params.description ?? '', merchant: params.merchant ?? '', category: params.category || null,
    accountId: params.account || null,
    inicio: params.start && isValidBRDate(params.start) ? params.start : isoToBR(localISODate()),
  } : null);

  // `isError` e não só `data`: o TanStack GUARDA o resultado anterior quando o refetch
  // falha, e sem este corte a lista seguia afirmando números embaixo da faixa que acabou
  // de dizer que não conseguiu carregar. Zerar aqui cobre lista, contadores e destaque de
  // uma vez; os estados vazios já checam `isError` e continuam calados.
  const todas = useMemo(
    () => (series.isError ? [] : (series.data ?? [])),
    [series.isError, series.data]
  );

  /**
   * Busca — 16 séries hoje, e é a lista que mais CRESCE: toda conta fixa nova entra aqui.
   *
   * Filtra no cliente porque a lista já veio inteira (não é paginada). Casa descrição e
   * categoria, sem acento e sem caixa, que é o que a busca de Lançamentos também faz.
   */
  const [busca, setBusca] = useState('');
  const termo = useDebounced(busca.trim(), 200);
  const lista = useMemo(() => {
    const t = semAcento(termo);
    if (!t) return todas;
    return todas.filter((r) =>
      semAcento(`${r.description ?? ''} ${r.category ?? ''}`).includes(t)
    );
  }, [todas, termo]);

  const comErro = lista.filter((r) => r.last_error);
  const ativas = lista.filter((r) => r.active && !r.last_error);
  const pausadas = lista.filter((r) => !r.active && !r.last_error);
  // Aos poucos (24/09/2026): é a lista que mais cresce. Uma busca nova recomeça as seções.
  const janelas = useJanelasPorGrupo(termo);
  const jErro = janelas.janelaDe('erro', comErro);
  const jAtivas = janelas.janelaDe('ativas', ativas);
  const jPausadas = janelas.janelaDe('pausadas', pausadas);

  const sai = (proximos.data ?? [])
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + Number(t.amount_cents), 0);
  const entra = (proximos.data ?? [])
    .filter((t) => t.kind === 'income')
    .reduce((s, t) => s + Number(t.amount_cents), 0);

  const { inicioDate, agendaNoPassado, podeSalvar, rrulePrevia } = validaSerie(form);

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
      const desc = form.description.trim();
      if (!antes || desc !== antes.description) patch.description = desc;
      if (!antes || form.accountId !== antes.account_id) patch.account_id = form.accountId;
      if (!antes || form.autoConfirm !== antes.auto_confirm) patch.auto_confirm = form.autoConfirm;
      const fim = form.fim ? brToISO(form.fim) : null;
      if (!antes || fim !== antes.end_date) patch.end_date = fim;
      const merchant = form.merchant.trim() || null;
      if (!antes || merchant !== (antes.merchant ?? null)) patch.merchant = merchant;
      if (!antes || form.kind !== antes.kind) patch.kind = form.kind;
      if (form.agendaMudou) {
        if (!inicioDate || !rrulePrevia || agendaNoPassado) return;
        patch.rrule = rrulePrevia;
        patch.next_run_at = inicioDate.toISOString();
      }
      if (Object.keys(patch).length === 0) {
        volta.aoFechar(() => setForm(null));
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
            volta.aoFechar(() => setForm(null));
          },
          onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para alterar a série.'), tone: 'error' }),
        },
      );
      return;
    }
    if (!podeSalvar || !inicioDate || !rrulePrevia) return;
    create.mutate(
      {
        kind: form.kind,
        amount_cents: form.amountCents,
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
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
          volta.aoFechar(() => setForm(null));
        },
        onError: () => toast({ message: 'Não deu para criar a recorrência.', tone: 'error' }),
      }
    );
  };

  const abrirEdicao = (r: RecurringTransaction) => setForm(serieDoRegistro(r));

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
      setForm(serieDoRegistro(alvo));
      volta.marcar();
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
            // Com "Desfazer": é o que deixa pausar valer ao arrastar até o fim (Deslizavel).
            action: { label: 'Desfazer', onPress: () => toggle.mutate({ id: r.id, active: r.active }, { onError: () => toast({ message: 'Não deu para desfazer.', tone: 'error' }) }) },
          }),
        onError: () => toast({ message: 'Não deu para mudar a série.', tone: 'error' }),
      }
    );

  const apagar = (r: RecurringTransaction) =>
    confirmDestructive(
      r.description ? `Apagar a recorrência ${r.description}?` : 'Apagar esta recorrência?',
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

  /** O menu da série, UMA lista para o toque (curto e longo) e o arrasto. */
  const acoesDaSerie = (r: RecurringTransaction): ItemAction[] => [
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
      { label: r.active ? 'Pausar' : 'Retomar', icon: r.active ? 'pause' : 'play', arrasto: 'direita', desfaz: true, onPress: () => alternar(r) },
      { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => apagar(r) },
    ];
  const acoes = (r: RecurringTransaction) => showItemActions(r.description ?? 'Recorrência', acoesDaSerie(r));

  const cartaoSerie = (r: RecurringTransaction, index: number) => {
    const receita = r.kind === 'income';
    const cents = Number(r.amount_cents);
    const quando = describeRRule(r.rrule);

    return (
      <Animated.View
        key={r.id}
        layout={transicaoDeLayout}
        entering={FadeInDown.duration(Motion.duration.slow).delay(
          Math.min(index * Motion.stagger.step, Motion.stagger.cap)
        )}>
        <Deslizavel titulo={r.description ?? 'Recorrência'} acoes={acoesDaSerie(r)} forma="card">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${r.description ?? 'recorrência'}, ${receita ? 'receita' : 'despesa'}, ${quando}, próximo em ${isoToBR(dataLocalDe(r.next_run_at))}${r.active ? '' : ', pausado'}`}
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
              {quando} · próximo {isoToBR(dataLocalDe(r.next_run_at)).slice(0, 5)}
              {r.category ? ` · ${r.category}` : ''}
              {r.active ? '' : ' · pausada'}
            </ThemedText>
          </Card>
        </PressableScale>
        </Deslizavel>
      </Animated.View>
    );
  };

  const loading = series.isLoading ? (
    <>
      <Skeleton height={120} radius={Radius.lg} />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </>
  ) : null;

  const upcomingContext = lista.length === 0 || termo ? null : proximos.isError ? (
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
      </Card>
    </Animated.View>
  ) : null;

  const seriesError = series.isError ? (
    <ErrorBand message="Não deu para carregar as recorrências." onRetry={series.refetch} />
  ) : null;

  const recurringSections = (
    <>
      {/* Vem primeiro: série parada = conta que não vai aparecer na projeção. */}
      {comErro.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Precisa de atenção" />
          {jErro.visiveis.map((r) => (
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
                  tentativa {r.run_attempts} de 5
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
                    variant="secondary"
                    onPress={() => acoes(r)}
                  />
                </View>
              </Card>
            </Animated.View>
          ))}
          <VerMais restantes={jErro.restantes} onPress={() => janelas.verMais('erro')} />
        </View>
      ) : null}

      {ativas.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Ativas" />
          {jAtivas.visiveis.map(cartaoSerie)}
          <VerMais restantes={jAtivas.restantes} onPress={() => janelas.verMais('ativas')} />
        </View>
      ) : null}

      {pausadas.length > 0 ? (
        <View style={styles.secao}>
          <SectionHead title="Pausadas" />
          {jPausadas.visiveis.map(cartaoSerie)}
          <VerMais restantes={jPausadas.restantes} onPress={() => janelas.verMais('pausadas')} />
        </View>
      ) : null}

      {/* Só pausadas (ou com erro): elas vêm primeiro e o vazio vira uma linha embaixo (24/09/2026). */}
      {!series.isLoading && !series.isError && lista.length > 0 && ativas.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="Nada ativo se repetindo"
          action={{
            label: 'Nova recorrência',
            onPress: () => setForm({ ...SERIE_VAZIA, inicio: isoToBR(localISODate()) }),
          }}
          compacto
        />
      ) : null}
      {!series.isLoading && !series.isError && lista.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="Nada se repete ainda"
          hint={'Manda no WhatsApp: *todo dia 5 pago 1200 de aluguel*\n— ou toca em + para cadastrar aqui.'}
          action={{
            label: 'Nova recorrência',
            onPress: () => setForm({ ...SERIE_VAZIA, inicio: isoToBR(localISODate()) }),
          }}
        />
      ) : null}
    </>
  );

  const recurringList = <View style={styles.paneBody}>{loading}{seriesError}{recurringSections}</View>;
  const recurringSummary = <View style={styles.paneBody}>{upcomingContext}</View>;
  const compactBody = <>{upcomingContext}{seriesError}{recurringSections}</>;
  const tabletBody = (
    <AdaptivePanes
      main={recurringList}
      support={upcomingContext ? recurringSummary : undefined}
      singlePane="main-only"
      singlePaneContent={compactBody}
      testID="recurring-tablet-workspace"
    />
  );

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={() => Promise.all([series.refetch(), proximos.refetch()])}
      search={
        <Search
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar recorrentes"
          accessibilityLabel="Buscar recorrências"
        />
      }>
      <Stack.Screen
        options={{
          title: 'Recorrentes',
        }}
      />

      <HeaderActions
        actions={[
          {
            label: 'Nova recorrência',
            icon: 'plus',
            onPress: () => setForm({ ...SERIE_VAZIA, inicio: isoToBR(localISODate()) }),
          },
        ]}
      />

      {!tablet ? loading : null}

      {tablet ? tabletBody : compactBody}

      <Sheet visible={form !== null} onClose={() => volta.aoFechar(() => setForm(null))}>

          <TaskHeader
            title={form?.id ? 'Editar recorrência' : 'Nova recorrência'}
            onClose={() => volta.aoFechar(() => setForm(null))}
            action={
              <Button
                label={form?.id ? 'Salvar' : 'Criar'}
                size="sm"
                loading={create.isPending || editar.isPending}
                disabled={!podeSalvar}
                onPress={salvar}
              />
            }
          />

          {form ? (
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <CamposDaSerie form={form} onChange={setForm} contas={accounts.data ?? []} />
            </ScrollView>
          ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  paneBody: {
    gap: Space.xl,
    minWidth: 0,
  },
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
    gap: Space.md,
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
});
