import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';

import { ErrorCard } from '@/components/error-card';
import { HeaderActions } from '@/components/ui/header-actions';
import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Deslizavel } from '@/components/ui/deslizavel';
import { VerMais } from '@/components/ui/ver-mais';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { ListFilters, type FilterSelect } from '@/components/ui/list-filters';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { SkeletonRow } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useBillReminders } from '@/hooks/use-bill-reminders';
import {
  formatDateBR,
  useDeleteReminder,
  useReminders,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import { confirmDestructive, showItemActions, type ItemAction } from '@/lib/item-actions';
import { emPausa, rotuloDaPausa } from '@/lib/pausa';
import { usePausa } from '@/components/finance/pausa-sheet';
import { usePauseReminder } from '@/hooks/use-pausas';
import { dataLocalDe, localISODate } from '@/lib/dates';
import { describeRRule } from '@/lib/rrule-text';
import { alvoComoParam, resumoDosAvisos } from '@/lib/lembrete-de-conta';
import { listFiltersActive, type ListFiltersValue } from '@/lib/list-filters';

const filterSelects: readonly FilterSelect[] = [
  { key: 'status', label: 'Estado', options: [{ id: 'active', label: 'Ativos' }, { id: 'paused', label: 'Pausados' }] },
  { key: 'channel', label: 'Canal', options: [{ id: 'push', label: 'Notificação' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'both', label: 'Notificação e WhatsApp' }] },
];

/**
 * Lista completa de lembretes.
 *
 * Deixou de ser aba: lembrete não é um destino, é algo que vence — o que vence hoje aparece na aba
 * **Hoje**. Esta tela é o arquivo completo, incluindo os pausados, e vive no Stack raiz.
 */
export default function RemindersScreen() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  const [filters, setFilters] = useState<ListFiltersValue>({});
  const [filtering, setFiltering] = useState(false);
  const filtered = listFiltersActive(filters);
  const status = filters.selections?.status;
  const channel = filters.selections?.channel;
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useReminders({
    from: filters.from, to: filters.to, q: filters.q,
    ...(status === 'active' || status === 'paused' ? { status, hoje: localISODate() } : {}),
    channel: channel === 'push' || channel === 'whatsapp' || channel === 'both' ? channel : undefined,
  });
  const lembretesDeConta = useBillReminders();
  const toggle = useToggleReminder();
  const pausando = usePausa();
  const retomando = usePauseReminder();
  const hoje = localISODate();
  /** Dentro do período de uma pausa com prazo (`active` segue true): é o grupo dos pausados. */
  const rotulo = (r: Reminder) => rotuloDaPausa({ active: true, paused_from: r.paused_from ?? null, paused_until: r.paused_until ?? null }, hoje);
  const noPeriodo = (r: Reminder) => r.active && emPausa(hoje, r.paused_from ?? null, r.paused_until ?? null);
  const remove = useDeleteReminder();
  const toast = useToast();

  // `isError` e não só `data`: o TanStack guarda o resultado anterior quando o refetch
  // falha, e sem este corte a tela seguia afirmando números embaixo da faixa de erro.
  const reminders = isError ? [] : (data?.pages.flat() ?? []).filter((r) => (!r.parent_reminder_id || r.active));
  const active = reminders.filter((r) => r.active && !noPeriodo(r));
  const paused = reminders.filter((r) => !r.active || noPeriodo(r));

  /** O menu do lembrete, declarado UMA vez: o toque longo e o arrasto leem a mesma lista. */
  const acoesDoLembrete = (r: Reminder): ItemAction[] => {
    const alternar = (active: boolean, desfazendo = false) =>
      toggle.mutate(
        { id: r.id, active },
        {
          onSuccess: () =>
            desfazendo
              ? undefined
              : toast({
                  message: active ? 'Lembrete retomado.' : 'Lembrete pausado.',
                  tone: 'success',
                  action: { label: 'Desfazer', onPress: () => alternar(!active, true) },
                }),
          onError: () => toast({ message: 'Não deu para mudar o lembrete.', tone: 'error' }),
        },
      );
    const onDelete = () =>
      confirmDestructive('Apagar este lembrete?', 'Apagar', () =>
        remove.mutate(r.id, {
          onSuccess: () => toast({ message: 'Lembrete apagado.', tone: 'success' }),
          onError: () => toast({ message: 'Não deu para apagar.', tone: 'error' }),
        }),
        r.title,
      );

    const retomarAgora = () =>
      retomando.mutate({ id: r.id, from: null, until: null }, {
        onSuccess: () => toast({ message: 'Lembrete retomado.', tone: 'success' }),
        onError: () => toast({ message: 'Não deu para retomar o lembrete.', tone: 'error' }),
      });

    return [
      { label: 'Editar', arrasto: 'fora', onPress: () => router.push(`/reminder-form?id=${r.id}`) },
      noPeriodo(r)
        ? { label: 'Retomar agora', icon: 'play', arrasto: 'direita', onPress: retomarAgora }
        : {
            label: r.active ? 'Pausar' : 'Retomar',
            icon: r.active ? 'pause' : 'play',
            arrasto: 'direita',
            desfaz: true,
            onPress: () => alternar(!r.active),
          },
      ...(r.active && r.paused_from && r.paused_until && hoje < r.paused_from
        ? [{ label: 'Cancelar pausa', icon: 'play' as const, onPress: retomarAgora }]
        : []),
      ...(r.active && !noPeriodo(r) && r.recurrence
        ? [{ label: 'Pausar por um tempo…', icon: 'pause' as const,
            onPress: () => pausando.abrir({ tipo: 'reminder', id: r.id, titulo: r.title }, dataLocalDe(r.next_run_at)) }]
        : []),
      { label: 'Apagar', icon: 'trash', destructive: true, arrasto: 'esquerda', onPress: onDelete },
    ];
  };

  const line = (r: Reminder) => (
    <Deslizavel key={r.id} titulo={r.title} acoes={acoesDoLembrete(r)}>
      <Row
        title={r.title}
        subtitle={
          r.parent_reminder_id
            ? `Ocorrência editada · ${formatDateBR(r.next_run_at)}`
            : r.skip_run_at === r.next_run_at
            ? `${describeRRule(r.recurrence)} · próxima após a ocorrência editada${r.active && rotulo(r) ? ` · ${rotulo(r)}` : ''}`
            : r.recurrence
            ? `${describeRRule(r.recurrence)}${emPausa(dataLocalDe(r.next_run_at), r.paused_from ?? null, r.paused_until ?? null) ? '' : ` · próximo ${formatDateBR(r.next_run_at)}`}${r.active && rotulo(r) ? ` · ${rotulo(r)}` : ''}`
            : formatDateBR(r.next_run_at)
        }
        icon={r.active && !noPeriodo(r) ? 'bell' : 'bell.slash'}
        accessibilityLabel={`${r.title}, ${r.active && !noPeriodo(r) ? 'ativo' : 'pausado'}`}
        onPress={() => router.push(`/reminder-form?id=${r.id}`)}
        onLongPress={() => showItemActions(r.title, acoesDoLembrete(r))}
      />
    </Deslizavel>
  );

  const activeSection =
    active.length > 0 ? <Section title="Ativos">{active.map(line)}</Section> : null;
  const pausedSection =
    paused.length > 0 ? (
      <View style={styles.pausedPane}>
        <Section title="Pausados">{paused.map(line)}</Section>
      </View>
    ) : null;
  // Só pausados: eles vêm primeiro e o vazio vira uma linha embaixo (24/09/2026).
  const semAtivos =
    !filtered && !isLoading && !isError && reminders.length > 0 && active.length === 0 ? (
      <EmptyState
        icon="bell"
        title="Nenhum lembrete ativo"
        action={{ label: 'Novo lembrete', onPress: () => router.push('/reminder-form') }}
        compacto
      />
    ) : null;
  const list = (
    <>
      {activeSection}
      {pausedSection}
      {semAtivos}
    </>
  );

  return (
    <Screen grouped wide={tablet} onRefresh={refetch}>
      <Stack.Screen
        options={{
          title: 'Lembretes',
        }}
      />

      <FilterBar value={filters} selects={filterSelects} dateLabel="Próxima execução"
        defaultLabel="Todos os lembretes" onPress={() => setFiltering(true)} />

      {/* Criar é `+` no header, como em Contas, Cartões, Orçamentos, Metas, Dívidas, Recorrentes
          e Regras. Aqui era um botão de bloco no CORPO, e esta era a única tela de lista do app
          sem ação nenhuma no header — mesma intenção, dois lugares diferentes. */}
      <HeaderActions
        actions={[
          { label: 'Novo lembrete', icon: 'plus', onPress: () => router.push('/reminder-form') },
        ]}
      />

      {isError ? <ErrorCard onRetry={refetch} /> : null}

      {isLoading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : null}

      {tablet && activeSection && pausedSection ? (
        <AdaptivePanes
          main={activeSection}
          support={pausedSection}
          singlePaneContent={list}
          testID="reminders-tablet-workspace"
        />
      ) : (
        list
      )}

      {lembretesDeConta.isError ? <ErrorCard onRetry={() => lembretesDeConta.refetch()} /> : null}
      {!lembretesDeConta.isError && lembretesDeConta.data?.length ? (
        <Section title="Contas">
          {lembretesDeConta.data.map((c) => (
            <Row
              key={alvoComoParam(c.alvo)}
              icon="bell"
              title={c.title}
              subtitle={[resumoDosAvisos(c.avisos), c.next_due ? `vence ${formatDateBR(c.next_due)}` : 'sem próximo vencimento'].join(' · ')}
              onPress={() => router.push({ pathname: '/reminder-form', params: { conta: alvoComoParam(c.alvo), nome: c.title } })}
            />
          ))}
        </Section>
      ) : null}

      {/* Fora dos painéis: continua acessível no tablet com ativos e pausados lado a lado. */}
      <VerMais
        restantes={hasNextPage ? null : 0}
        carregando={isFetchingNextPage}
        onPress={() => void fetchNextPage()}
      />

      {!isLoading && !isError && reminders.length === 0 && !lembretesDeConta.data?.length ? (
        <EmptyState
          icon="bell"
          title={filtered ? 'Nenhum lembrete com esses filtros' : 'Nenhum lembrete ainda'}
          hint={filtered ? 'Ajuste os filtros para encontrar outros lembretes.' : 'Manda *me lembra de pagar o aluguel dia 5*\nno WhatsApp — ou crie um aqui.'}
          action={filtered ? { label: 'Limpar filtros', onPress: () => setFilters({}) } : { label: 'Novo lembrete', onPress: () => router.push('/reminder-form') }}
        />
      ) : null}
      {pausando.folha}
      <ListFilters visible={filtering} value={filters} onClose={() => setFiltering(false)} onApply={setFilters}
        dateLabels={{ from: 'Próxima execução a partir de', to: 'Próxima execução até' }} selects={filterSelects} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pausedPane: { gap: Space.lg, minWidth: 0 },
});
