import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@/lib/consulta-em-foco';

import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Row } from '@/components/ui/row';
import { EmptyState } from '@/components/ui/empty-state';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Screen } from '@/components/ui/screen';
import { Deslizavel } from '@/components/ui/deslizavel';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Presenca } from '@/components/motion/presenca';
import { VerMais } from '@/components/ui/ver-mais';
import { useJanelasPorGrupo } from '@/hooks/use-aos-poucos';
import { HeroLabel, SectionHead } from '@/components/ui/section-head';
import { FilterBar } from '@/components/ui/filter-bar';
import { ListFilters, type FilterSelect } from '@/components/ui/list-filters';
import { Search } from '@/components/ui/search';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { HitTarget, Motion, Radius, Space, tabular } from '@/design/tokens';
import {
  useAccounts,
  useRecurringTransactions,
  useSaveRecurringSeries,
  useToggleRecurring,
  type RecurringTransaction,
} from '@/hooks/use-finance';
import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useDebounced } from '@/hooks/use-debounced';
import { semAcento } from '@/lib/text';
import { dataLocalDe, isoToBR, localISODate } from '@/lib/dates';
import { accountSelectOptions } from '@/lib/accounts';
import { listFiltersActive, type ListFiltersValue } from '@/lib/list-filters';
import { useApagarComAlcance } from '@/hooks/use-apagar-com-alcance';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { useBillReminders } from '@/hooks/use-bill-reminders';
import { hrefDoLembrete, mesmoAlvo } from '@/lib/lembrete-de-conta';
import { financeErrorMessage } from '@/lib/finance-form';
import { hrefDoLancar } from '@/lib/lancar';
import { describeRRule } from '@/lib/rrule-text';
import { estadoDaRecorrencia } from '@/lib/recurring-state';
import { emPausa, rotuloDaPausa } from '@/lib/pausa';
import { usePausa } from '@/components/finance/pausa-sheet';
import { useResumeRecurring } from '@/hooks/use-pausas';
import { supabase } from '@/lib/supabase';
import { transicaoDeLayout } from '@/components/motion/transicao';
import { useEncerrarSerie } from '@/components/finance/encerrar-serie';
import { newClientMessageId } from '@/lib/agent-chat';

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
  const params = useLocalSearchParams<Record<string, string>>();
  const theme = useTheme();
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const toast = useToast();
  const lembretes = useBillReminders();
  const lembreteDaSerie = (r: RecurringTransaction) => lembretes.data?.find((l) => mesmoAlvo(l.alvo, { recurring_id: r.id }));
  const series = useRecurringTransactions();
  const accounts = useAccounts(undefined, true);
  const proximos = useRecurringUpcoming(30);
  const toggle = useToggleRecurring();
  const apagarComAlcance = useApagarComAlcance();
  const encerrando = useEncerrarSerie();
  const pausando = usePausa();
  const retomando = useResumeRecurring();
  const reabrindo = useSaveRecurringSeries();
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
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filters, setFilters] = useState<ListFiltersValue>({});
  const filterSelects: readonly FilterSelect[] = [
    { key: 'conta', label: 'Conta', options: accountSelectOptions(accounts.data ?? [], 'Sem conta', 'none') },
    { key: 'categoria', label: 'Categoria', options: Array.from(new Set(todas.map((r) => r.category).filter((v): v is string => Boolean(v)))).sort().map((v) => ({ id: v, label: v })) },
    { key: 'estado', label: 'Estado', options: [{ id: 'ativa', label: 'Ativa' }, { id: 'pausada', label: 'Pausada' }, { id: 'encerrada', label: 'Encerrada' }] },
  ];
  const termo = useDebounced(filters.q?.trim() ?? '', 200);
  const hoje = localISODate();
  const lista = useMemo(() => {
    const t = semAcento(termo);
    return todas.filter((r) => {
      const estado = estadoDaRecorrencia(r, hoje);
      const data = dataLocalDe(r.next_run_at);
      const dataOk = (!filters.from && !filters.to) || (estado === 'ativa'
        && (!filters.from || data >= filters.from) && (!filters.to || data <= filters.to));
      return (!t || semAcento(`${r.description ?? ''} ${r.category ?? ''}`).includes(t))
        && (!filters.selections?.conta || (filters.selections.conta === 'none' ? r.account_id === null : r.account_id === filters.selections.conta))
        && (!filters.selections?.categoria || r.category === filters.selections.categoria)
        && (!filters.selections?.estado || estado === filters.selections.estado)
        && dataOk;
    });
  }, [todas, termo, hoje, filters]);

  const encerrada = (r: RecurringTransaction) => estadoDaRecorrencia(r, hoje) === 'encerrada';
  const encerradas = lista.filter(encerrada).sort((a, b) => (b.end_date ?? '').localeCompare(a.end_date ?? ''));
  const comErro = lista.filter((r) => !encerrada(r) && r.last_error);
  const ativas = lista.filter((r) => estadoDaRecorrencia(r, hoje) === 'ativa' && !r.last_error);
  const pausadas = lista.filter((r) => estadoDaRecorrencia(r, hoje) === 'pausada' && !r.last_error);
  const [verEncerradas, setVerEncerradas] = useState(false);
  // Aos poucos (24/09/2026): é a lista que mais cresce. Uma busca nova recomeça as seções.
  const janelas = useJanelasPorGrupo(JSON.stringify(filters));
  const jErro = janelas.janelaDe('erro', comErro);
  const jAtivas = janelas.janelaDe('ativas', ativas);
  const jPausadas = janelas.janelaDe('pausadas', pausadas);
  const jEncerradas = janelas.janelaDe('encerradas', encerradas);

  const sai = (proximos.data ?? [])
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + Number(t.amount_cents), 0);
  const entra = (proximos.data ?? [])
    .filter((t) => t.kind === 'income')
    .reduce((s, t) => s + Number(t.amount_cents), 0);

  // Criar e editar abrem o formulário único; a série não diz se tem passado, e o hospedeiro assume que sim.
  const abrirNova = () => router.push(hrefDoLancar('recorrente'));
  const abrirEdicao = (r: RecurringTransaction) => router.push(hrefDoLancar('recorrente', { id: r.id, origem: 'serie' }));

  /** Dentro do período de uma pausa com prazo (`active` segue true): é o mesmo grupo das pausadas. */
  const noPeriodo = (r: RecurringTransaction) => r.active && emPausa(hoje, r.paused_from ?? null, r.paused_until ?? null);

  const alternarPeriodo = (r: RecurringTransaction) =>
    retomando.mutate({ id: r.id }, {
      onSuccess: () => toast({ message: 'Série retomada.', tone: 'success' }),
      onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para retomar a série.'), tone: 'error' }),
    });

  const alternar = (r: RecurringTransaction) =>
    noPeriodo(r)
      ? alternarPeriodo(r)
      : toggle.mutate(
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

  /** Reabrir = tirar o fim: o agendador volta a gerar o que o encerramento tirou (F18). */
  const reabrir = (r: RecurringTransaction) =>
    confirmDestructive(
      r.description ? `Reabrir ${r.description}?` : 'Reabrir esta recorrência?',
      'Reabrir',
      () =>
        reabrindo.mutate(
          { id: r.id, patch: { end_date: null }, expectedRevision: Number(r.edit_revision), requestId: newClientMessageId() },
          {
            onSuccess: () => toast({ message: 'Série reaberta.', tone: 'success' }),
            onError: (error) => toast({ message: financeErrorMessage(error, 'Não deu para reabrir a série.'), tone: 'error' }),
          }
        ),
      'O fim sai e as cobranças futuras voltam a ser geradas.'
    );

  // O hook pergunta o alcance, confere o estrago no banco e confirma antes de apagar.
  const apagar = (r: RecurringTransaction) =>
    apagarComAlcance.apagar({ tipo: 'recurring', id: r.id, nome: r.description ?? 'recorrência' });

  /** O menu da série, UMA lista para o toque (curto e longo) e o arrasto. */
  const acoesDaSerie = (r: RecurringTransaction): ItemAction[] => {
    const acoesDeEdicao: ItemAction[] = encerrada(r) ? [{ label: 'Reabrir', icon: 'arrow.counterclockwise', onPress: () => reabrir(r) }] : [
      {
        // Até 09/09/2026 esta tela só sabia criar, pausar e apagar: corrigir o valor
        // do aluguel exigia apagar a série e refazer, perdendo o histórico.
        label: 'Editar',
        icon: 'pencil',
        onPress: () => abrirEdicao(r),
      },
      // Conta a pagar: receita e transferência não têm lembrete (spec §7).
      ...(r.kind === 'expense'
        ? [{ label: lembreteDaSerie(r) ? 'Editar lembrete' : 'Lembrar', icon: 'bell' as const,
            onPress: () => router.push(hrefDoLembrete({ tipo: 'serie', recurringId: r.id }, r.description ?? 'Recorrente')) }]
        : []),
      // Pausa marcada para depois: ainda não começou, e se cancela como se retoma.
      ...(r.active && r.paused_from && r.paused_until && hoje < r.paused_from
        ? [{ label: 'Cancelar pausa', icon: 'play' as const, onPress: () => alternarPeriodo(r) }]
        : []),
      noPeriodo(r)
        ? { label: 'Retomar agora', icon: 'play', arrasto: 'direita', onPress: () => alternar(r) }
        : { label: r.active ? 'Pausar' : 'Retomar', icon: r.active ? 'pause' : 'play', arrasto: 'direita', desfaz: true, onPress: () => alternar(r) },
      ...(r.active && !noPeriodo(r)
        ? [{ label: 'Pausar…', icon: 'pause' as const,
            onPress: () => pausando.abrir({ tipo: 'recurring', id: r.id, titulo: r.description ?? 'recorrência' }, dataLocalDe(r.next_run_at)) }]
        : []),
      // Cancelar uma assinatura: fica o que já aconteceu, saem as cobranças futuras (não é Pausar nem Apagar).
      { label: 'Encerrar', icon: 'xmark.circle', onPress: () => encerrando.abrir(r) },
    ];
    return [
      {
        label: 'Ver ocorrências',
        onPress: () =>
          router.push({
            pathname: '/finance/transactions',
            params: { recurringId: r.id, month: (encerrada(r) && r.end_date ? r.end_date : dataLocalDe(r.next_run_at)).slice(0, 7) },
          }),
      },
      ...acoesDeEdicao,
      { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: () => apagar(r) },
    ];
  };
  const acoes = (r: RecurringTransaction) => showItemActions(r.description ?? 'Recorrência', acoesDaSerie(r));

  const cartaoSerie = (r: RecurringTransaction, index: number) => {
    const receita = r.kind === 'income';
    const transferencia = r.kind === 'transfer';
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
          accessibilityLabel={`${r.description ?? 'recorrência'}, ${receita ? 'receita' : transferencia ? 'transferência' : 'despesa'}, ${quando}, próximo em ${isoToBR(dataLocalDe(r.next_run_at))}${r.active && !noPeriodo(r) ? '' : ', pausado'}`}
          onPress={() => acoes(r)}
          onLongPress={() => acoes(r)}>
          <Card style={[styles.serie, r.active && !noPeriodo(r) ? null : styles.pausada]}>
            <View style={styles.serieTopo}>
              <View style={styles.serieTitulo}>
                <Icon
                  name={receita ? 'arrow.down.left' : transferencia ? 'arrow.left.arrow.right' : 'arrow.up.right'}
                  size="md"
                  color={receita ? 'success' : 'textSecondary'}
                />
                <ThemedText type="default" style={styles.serieNome}>
                  {r.description ?? 'sem descrição'}
                </ThemedText>
              </View>
              <View style={styles.serieValor}>
                <Money cents={cents} variant="ticker" tone={receita ? 'success' : 'text'} />
              </View>
              {/* ação primária da tela: um toque, alvo próprio de 44pt */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${r.active && !noPeriodo(r) ? 'Pausar' : 'Retomar'} ${r.description ?? 'recorrência'}`}
                hitSlop={12}
                onPress={() => alternar(r)}
                style={styles.alternar}>
                <Icon name={r.active && !noPeriodo(r) ? 'pause.circle' : 'play.circle'} size="lg" color="tint" />
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {quando} · próximo {isoToBR(dataLocalDe(r.next_run_at)).slice(0, 5)}
              {r.category ? ` · ${r.category}` : ''}
              {r.active ? (rotuloDaPausa(r, hoje) ? ` · ${rotuloDaPausa(r, hoje)}` : '') : ' · pausada'}
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

  const upcomingContext = lista.length === 0 || listFiltersActive(filters) ? null : proximos.isError ? (
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
      {todas.length > 0 ? <FilterBar value={filters} selects={filterSelects} dateLabel="Próxima execução"
        defaultLabel="Todas as recorrências" onPress={() => setFiltersVisible(true)} /> : null}
      <ListFilters visible={filtersVisible} value={filters} onClose={() => setFiltersVisible(false)} onApply={setFilters}
        dateLabels={{ from: 'Execução (ativas) a partir de', to: 'Execução (ativas) até' }} selects={filterSelects} />
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
                    <ThemedText type="default" style={styles.serieNome}>
                      {r.description ?? 'sem descrição'}
                    </ThemedText>
                  </View>
                  <View style={styles.serieValor}>
                    <Money cents={Number(r.amount_cents)} variant="ticker" />
                  </View>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {r.last_error}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={tabular}>
                  tentativa {r.run_attempts} de 5
                </ThemedText>
                <View style={styles.acoesErro}>
                  <Button
                    label={r.active && !noPeriodo(r) ? 'Pausar' : 'Retomar'}
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

      {encerradas.length > 0 ? (
        <View style={styles.secao}>
          {filters.selections?.estado === 'encerrada' ? <SectionHead title={`Encerradas · ${encerradas.length}`} /> : <Row
            icon="archivebox"
            title={`Encerradas · ${encerradas.length}`}
            chevron={false}
            trailing={<Icon name={verEncerradas ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
            onPress={() => setVerEncerradas((v) => !v)}
            accessibilityState={{ expanded: verEncerradas }}
          />}
          <Presenca visivel={verEncerradas || filters.selections?.estado === 'encerrada'} style={styles.secao}>
            {jEncerradas.visiveis.map((r) => (
              <Deslizavel key={r.id} titulo={r.description ?? 'Recorrência'} acoes={acoesDaSerie(r)} forma="card">
                <Card style={styles.serie}>
                  <Row
                    title={r.description ?? 'sem descrição'}
                    subtitle={`Encerrada em ${isoToBR(r.end_date!)}`}
                    trailing={<Money cents={Number(r.amount_cents)} variant="ticker" tone="textSecondary" />}
                    chevron={false}
                    onPress={() => acoes(r)}
                    onLongPress={() => acoes(r)}
                    accessibilityLabel={`${r.description ?? 'recorrência'}, encerrada em ${isoToBR(r.end_date!)}. Ver ocorrências ou apagar.`}
                  />
                </Card>
              </Deslizavel>
            ))}
            <VerMais restantes={jEncerradas.restantes} onPress={() => janelas.verMais('encerradas')} />
          </Presenca>
        </View>
      ) : null}

      {/* Só pausadas (ou com erro): elas vêm primeiro e o vazio vira uma linha embaixo (24/09/2026). */}
      {!series.isLoading && !series.isError && !listFiltersActive(filters) && lista.length > 0 && ativas.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="Nada ativo se repetindo"
          action={{
            label: 'Nova recorrência',
            onPress: abrirNova,
          }}
          compacto
        />
      ) : null}
      {!series.isLoading && !series.isError && lista.length === 0 && todas.length > 0 ? (
        <EmptyState compacto icon="line.3.horizontal.decrease" title="Nenhuma recorrência encontrada"
          hint="Ajuste ou limpe os filtros para ver outras séries."
          action={{ label: 'Limpar filtros', onPress: () => setFilters({}) }} />
      ) : null}
      {!series.isLoading && !series.isError && lista.length === 0 && todas.length === 0 ? (
        <EmptyState
          icon="repeat"
          title="Nada se repete ainda"
          hint={'Manda no WhatsApp: *todo dia 5 pago 1200 de aluguel*\n— ou toca em + para cadastrar aqui.'}
          action={{
            label: 'Nova recorrência',
            onPress: abrirNova,
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

  /*
    Link antigo (`?edit=<série>`, `?create=1` do "Aplicar" de um APK anterior): o formulário agora é
    o único, e a lista não fica por baixo — fechar devolve para quem abriu.
  */
  if (params.edit) return <Redirect href={hrefDoLancar('recorrente', { id: params.edit, origem: 'serie' })} />;
  if (params.create === '1') {
    const { create: _c, de: _d, ...resto } = params;
    return <Redirect href={hrefDoLancar('recorrente', resto)} />;
  }

  return (
    <Screen
      grouped
      wide={tablet}
      onRefresh={() => Promise.all([series.refetch(), proximos.refetch()])}
      search={<Search value={filters.q ?? ''} onChangeText={(q) => setFilters((current) => ({ ...current, q }))}
        placeholder="Buscar recorrentes" accessibilityLabel="Buscar recorrências" />}>
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
            onPress: abrirNova,
          },
        ]}
      />

      {!tablet ? loading : null}

      {tablet ? tabletBody : compactBody}

      {encerrando.folha}
      {pausando.folha}
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
    gap: Space.sm,
  },
  serieTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flex: 1,
    minWidth: 0,
  },
  serieNome: {
    flexShrink: 1,
    minWidth: 0,
  },
  serieValor: {
    marginLeft: 'auto',
    alignItems: 'flex-end',
    flexShrink: 0,
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
});
