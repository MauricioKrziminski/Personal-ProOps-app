import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GoalContributionFields } from '@/components/finance/goal-contribution-fields';
import { MonthRuler } from '@/components/finance/month-ruler';
import { ErrorCard } from '@/components/error-card';
import { Presenca } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { concealText, useBRL, useConceal } from '@/components/ui/conceal';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { MeasuredSparkline } from '@/components/ui/measured-sparkline';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { SelectField } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { SwitchRow } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { VerMais } from '@/components/ui/ver-mais';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useGoalPlanning } from '@/hooks/use-goal-planning';
import { fetchGoalHorizonPlanning, useGoalHorizonPlanning, useSaveGoalHorizon } from '@/hooks/use-goal-horizon';
import { useAosPoucos } from '@/hooks/use-aos-poucos';
import { isoToBR } from '@/lib/dates';
import { GoalPlanAttemptCancelledError, goalPlanWriteError } from '@/lib/goal-plan-save';
import { goalHorizonDrafts, goalHorizonInput, goalHorizonPreview, type GoalHorizonItem, type GoalHorizonState } from '@/lib/goal-horizon';
import { type GoalPlanningDailyPoint, type GoalPlanningMonth, type GoalPlanningState } from '@/lib/goal-planning';

const HORIZONS = [30, 90, 180, 365, 730, 1095, 1825, 3650].map(days => ({
  id: String(days), label: days >= 365 ? `${Math.round(days / 365)} ${days === 365 ? 'ano' : 'anos'}` : `${days} dias`,
}));
type Scope = { ws?: string; goalId?: string };
type Session = { snapshot: GoalHorizonState; items: GoalHorizonItem[]; days: number; view: 'civil' | 'cycle'; mode: 'month' | 'day'; focus?: string };

/** The screen owns the session; responsive panels only render its launcher. */
export function useGoalPlanEditor(days = 365, view: 'civil' | 'cycle' = 'civil', mode: 'month' | 'day' = 'month') {
  const save = useSaveGoalHorizon();
  const toast = useToast();
  const [visible, setVisible] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [needsReview, setNeedsReview] = useState(false);
  const nonce = useRef(0);
  const loading = useRef(false);
  const submitting = useRef(false);
  const requested = useRef<Scope>({});
  const busy = save.isPending || Boolean(save.unconfirmedInput);
  let preview = null;
  if (session) {
    try { preview = goalHorizonPreview(session.snapshot, session.items); } catch { /* Incomplete drafts stay editable. */ }
  }
  const query = useGoalHorizonPlanning(session?.days ?? days, session?.view ?? view, session?.mode ?? mode,
    preview, Boolean(session && preview), session?.snapshot.workspace_id);
  const current = !needsReview && preview !== null && query.isSuccess && !query.isFetching && !query.isError && session
    && query.data.goals_fingerprint === session.snapshot.goals_fingerprint
    && query.data.edit_revision === session.snapshot.edit_revision ? query.data : null;
  let valid = false;
  if (session && current) {
    try { goalHorizonInput(session.snapshot, session.items); valid = true; } catch { /* A preview may explain incomplete choices. */ }
  }
  const load = (scope: Scope) => {
    if (loading.current || submitting.current || busy) return;
    requested.current = scope; loading.current = true;
    const visit = ++nonce.current;
    setVisible(true); setSession(null); setOpening(true); setError(''); setNeedsReview(false);
    void fetchGoalHorizonPlanning(days, view, mode, null, scope.ws).then(snapshot => {
      if (visit !== nonce.current) return;
      setSession({ snapshot, items: goalHorizonDrafts(snapshot), days, view, mode, focus: scope.goalId });
    }, failure => { if (visit === nonce.current) setError(goalPlanWriteError(failure)); })
      .finally(() => { if (visit === nonce.current) { loading.current = false; setOpening(false); } });
  };
  const close = () => {
    if (submitting.current || busy) return;
    nonce.current++; loading.current = false;
    setVisible(false); setSession(null); setOpening(false); setError(''); setNeedsReview(false);
  };
  const update = (goalId: string, patch: Partial<Omit<GoalHorizonItem, 'goal_id'>>) => {
    if (busy || submitting.current) return;
    setSession(old => old ? { ...old, items: old.items.map(item => item.goal_id === goalId ? { ...item, ...patch } : item) } : old);
    setError('');
  };
  const setPeriod = (period: Pick<Session, 'days' | 'view'>) => {
    if (busy || submitting.current) return false;
    setSession(old => old ? { ...old, ...period } : old);
    return true;
  };
  const submit = (resolve = false) => {
    if (!session || submitting.current || (resolve && !save.unconfirmedInput)) return;
    let input;
    try { input = save.unconfirmedInput ?? goalHorizonInput(session.snapshot, session.items); }
    catch (failure) { setError(goalPlanWriteError(failure)); return; }
    if (!resolve && !save.unconfirmedInput && !valid) return;
    submitting.current = true; setError('');
    const request = resolve ? save.resolveAsync() : save.mutateAsync(input);
    void request.then(() => {
      setVisible(false); setSession(null);
      toast({ message: 'Plano de metas salvo.', tone: 'success' });
    }, failure => {
      setError(goalPlanWriteError(failure));
      if (failure instanceof GoalPlanAttemptCancelledError || (failure && typeof failure === 'object'
        && 'code' in failure && ['PT409', '40001'].includes(String(failure.code)))) setNeedsReview(true);
    }).finally(() => { submitting.current = false; });
  };
  const outdated = needsReview || Boolean(session && preview && query.isSuccess && !query.isFetching &&
    (query.data.goals_fingerprint !== session.snapshot.goals_fingerprint || query.data.edit_revision !== session.snapshot.edit_revision));
  return { visible, session, opening, error, busy, current, query, valid, outdated, save, close, update, setPeriod,
    open: (scope: Scope = {}) => { if (!visible) void load(scope); }, reload: () => { void load(requested.current); }, submit };
}

function Qualifications({ state }: { state: GoalPlanningState }) {
  const brl = useBRL();
  const { concealed } = useConceal();
  return <View style={styles.qualifications}>
    {state.first_pressure_on ? <ThemedText type="small" themeColor="warning">
      {concealed ? concealText() : `Disponibilidade negativa a partir de ${isoToBR(state.first_pressure_on)}.`}
    </ThemedText> : null}
    {!state.income_present ? <ThemedText type="footnote" themeColor="textSecondary">Sem entradas futuras previstas neste período.</ThemedText> : null}
    {state.unassigned_goals_cents > 0 ? <ThemedText type="footnote" themeColor="textSecondary">
      {brl(state.unassigned_goals_cents)} guardados em metas sem origem identificada. A disponibilidade pode mudar ao vincular esse dinheiro.
    </ThemedText> : null}
    {state.incomplete_goal_ids.length ? <ThemedText type="footnote" themeColor="warning">
      {state.incomplete_goal_ids.length} {state.incomplete_goal_ids.length === 1 ? 'meta precisa' : 'metas precisam'} de aporte ou primeira data.
    </ThemedText> : null}
    {state.missed_deadline_goal_ids.length ? <ThemedText type="footnote" themeColor="warning">
      {state.missed_deadline_goal_ids.length} {state.missed_deadline_goal_ids.length === 1 ? 'meta não alcança' : 'metas não alcançam'} o prazo com este plano.
    </ThemedText> : null}
    {state.excluded_goal_ids.length ? <ThemedText type="footnote" themeColor="textSecondary">
      {state.excluded_goal_ids.length} {state.excluded_goal_ids.length === 1 ? 'meta fora' : 'metas fora'} desta simulação.
    </ThemedText> : null}
  </View>;
}

function PlanningResult({ state, pending, periodKey }: { state: GoalPlanningState | null; pending: boolean; periodKey: string }) {
  const brl = useBRL();
  const { concealed } = useConceal();
  const [periodsVisible, setPeriodsVisible] = useState(false);
  const [height, setHeight] = useState(160);
  const points: (GoalPlanningDailyPoint | GoalPlanningMonth)[] = state ? (state.mode === 'month' ? state.months : state.points) : [];
  const periods = useAosPoucos(points, periodKey, 4);
  const last = points.at(-1);
  // A query transition keeps this component, expansion and measured space alive. Financial
  // readings render only from the current successful scenario; stale amounts are never kept.
  if (!state) return pending ? <Skeleton height={height} /> : null;
  return <View testID="goal-plan-result" style={styles.block}
    onLayout={event => { const measured = event.nativeEvent.layout.height; if (Math.abs(measured - height) > 1) setHeight(measured); }}>
    <View style={styles.reading}>
      <ThemedText type="small" themeColor="textSecondary">Menor disponibilidade no período</ThemedText>
      <Money cents={state.minimum_available_cents} variant="title2" tone={concealed ? 'text' : state.minimum_available_cents < 0 ? 'danger' : 'text'} />
      <ThemedText type="footnote" themeColor="textSecondary">{state.workspace_name} · {isoToBR(state.as_of)} · próximos {state.days} dias</ThemedText>
      <Qualifications state={state} />
    </View>
    {!concealed && points.length > 1 ? <View style={styles.reading} accessible
      accessibilityLabel={`Comparação do caixa previsto com disponibilidade após o plano. No fim, caixa ${brl(last!.cash_cents)} e disponível ${brl(last!.available_cents)}.`}>
      <MeasuredSparkline values={points.map(point => point.available_cents)} comparisonValues={points.map(point => point.cash_cents)} height={96} showZero />
      <ThemedText type="caption" themeColor="textSecondary">Linha contínua: disponível · tracejada: caixa{state.mode === 'month' ? ' · fim de cada período' : ''}</ThemedText>
    </View> : null}
    <Section title="O efeito do plano">
      <Row inlineValue title="Aportes previstos no período" trailing={<Money cents={last?.cumulative_planned_cents ?? 0} variant="ticker" />} />
      <Row inlineValue title="Já separado no caixa" subtitle="Lastro atual da reserva e das metas" trailing={<Money cents={state.reserved_cash_cents} variant="ticker" />} />
      {last ? <Row inlineValue title="Caixa previsto no fim" trailing={<Money cents={last.cash_cents} variant="ticker" />} /> : null}
      {last ? <Row inlineValue title="Disponível no fim" trailing={<Money cents={last.available_cents} variant="ticker" />} /> : null}
      <Row title="Ver períodos" chevron={false} accessibilityState={{ expanded: periodsVisible }} onPress={() => setPeriodsVisible(value => !value)} />
    </Section>
    <Presenca visivel={periodsVisible} imediata>
      <Section title="Caixa e disponível">
        {periods.visiveis.map(point => {
          const period = 'month' in point ? `${isoToBR(point.from)} – ${isoToBR(point.to)}${point.partial ? ' · parcial' : ''}` : isoToBR(point.day);
          return <Row inlineValue key={'month' in point ? point.month : point.day} title={period}
            subtitle={`Caixa ${brl(point.cash_cents)} · aportes ${brl(point.planned_cents)}`}
            accessibilityLabel={`${period}, caixa ${brl(point.cash_cents)}, aportes ${brl(point.planned_cents)}, disponível ${brl(point.available_cents)}`}
            trailing={<Money cents={point.available_cents} variant="ticker" />} />;
        })}
      </Section>
      <VerMais restantes={periods.restantes} onPress={periods.verMais} />
    </Presenca>
  </View>;
}

export function GoalPlanningSummary({ query, editor, actionLabel = 'Simular juntas', hint }: {
  query: ReturnType<typeof useGoalPlanning>; editor: ReturnType<typeof useGoalPlanEditor>; actionLabel?: string; hint?: string;
}) {
  if (query.isLoading) return <Skeleton height={80} />;
  if (query.isError || !query.data) return <ErrorCard message="Não consegui conferir o plano das metas." onRetry={() => { void query.refetch(); }} />;
  const state = query.data;
  if (!state.goals.length) return null;
  return <View style={styles.block}><Section title="Plano de metas">
    <Row inlineValue title="Menor disponibilidade" subtitle={`${state.workspace_name} · próximos ${state.days} dias`}
      trailing={<Money cents={state.minimum_available_cents} variant="ticker" />} />
    <Row title={actionLabel} subtitle={hint ?? (state.goals.some(goal => goal.origin === 'suggested') ? 'Há sugestões iniciais: confira as metas e salve seu plano.' : 'Confira o efeito de todas as metas deste espaço.')}
      onPress={() => editor.open()} />
  </Section></View>;
}

export function GoalPlanSheet({ editor, onViewChange }: {
  editor: ReturnType<typeof useGoalPlanEditor>; onViewChange?: (view: 'civil' | 'cycle') => void;
}) {
  const { session, current, busy } = editor;
  const ordered = session ? [...session.snapshot.goals].sort((a, b) => Number(b.goal_id === session.focus) - Number(a.goal_id === session.focus)) : [];
  const mustReopen = editor.outdated || (editor.query.error && typeof editor.query.error === 'object'
    && 'code' in editor.query.error && editor.query.error.code === 'PT409');
  const issue = editor.error || (session && editor.query.isError ? goalPlanWriteError(editor.query.error)
    : editor.outdated ? 'O plano mudou em outro lugar. Reabra para conferir a revisão atual.' : '');
  return <Sheet visible={editor.visible} onClose={editor.close}>
    <TaskHeader title="Plano de metas" subtitle={editor.save.unconfirmedInput ? 'Resposta ainda não confirmada' : 'Ajuste intenções futuras de um mesmo espaço'} onClose={editor.close}
      action={<Button label={editor.save.unconfirmedInput ? 'Conferir' : 'Salvar'} size="sm" loading={editor.save.isPending}
        disabled={editor.opening || (!editor.valid && !editor.save.unconfirmedInput)} onPress={() => editor.submit()} />} />
    {editor.save.unconfirmedInput ? <View style={styles.attempt}>
      <ThemedText type="small">Confira ou encerre a tentativa antes de ajustar.</ThemedText>
      <Button label="Encerrar tentativa" variant="secondary" loading={editor.save.isResolving} onPress={() => editor.submit(true)} />
    </View> : null}
    {issue ? <View style={styles.attempt}>
      <ThemedText type="small" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{issue}</ThemedText>
      {session && !busy ? <Button label={mustReopen ? 'Reabrir plano' : 'Tentar de novo'} variant="secondary"
        onPress={mustReopen ? editor.reload : () => { void editor.query.refetch(); }} /> : null}
    </View> : null}
    <SheetScroll contentContainerStyle={styles.body}>
      {editor.opening ? <Skeleton height={180} /> : null}
      {!session && !editor.opening ? <Button label="Tentar de novo" variant="secondary" onPress={editor.reload} /> : null}
      {session ? <>
        <Field label="Período da simulação"><SelectField options={HORIZONS} value={String(session.days)} disabled={busy}
          onChange={value => editor.setPeriod({ days: Number(value), view: session.view })} /></Field>
        <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'}>
          <MonthRuler value={session.view} onChange={value => { if (editor.setPeriod({ days: session.days, view: value })) onViewChange?.(value); }} visible={session.snapshot.cycle_close_day !== null && session.mode === 'month'} />
        </View>
        <PlanningResult state={current} pending={!mustReopen && (editor.query.isLoading || editor.query.isFetching)}
          periodKey={`${session.days}:${session.view}:${session.mode}`} />
        {!ordered.length ? <EmptyState compacto icon="target" title="Nenhuma meta em andamento neste espaço" hint="Metas concluídas conservam seus aportes e ficam fora do plano." /> : null}
        {ordered.map(goal => {
          const item = session.items.find(item => item.goal_id === goal.goal_id)!;
          return <View key={goal.goal_id} style={styles.goal}>
            <SwitchRow label={goal.name} value={item.included} disabled={busy} onValueChange={included => editor.update(goal.goal_id, { included })} />
            <ThemedText type="footnote" themeColor="textSecondary">
              {goal.deadline ? `${goal.deadline_status === 'past' ? 'Prazo vencido' : 'Prazo'}: ${isoToBR(goal.deadline)}` : 'Sem prazo definido'}
            </ThemedText>
            <Presenca visivel={item.included} imediata style={styles.block}>
              <GoalContributionFields goal={goal} item={item} asOf={session.snapshot.as_of} busy={busy}
                legacy={session.snapshot.horizons.find(entry => entry.item.goal_id === goal.goal_id)?.item.mode === 'legacy'}
                onChange={patch => editor.update(goal.goal_id, patch)} />
            </Presenca>
          </View>;
        })}
        <ThemedText type="footnote" themeColor="textSecondary">Salvar guarda o plano. Os aportes realizados continuam sendo registrados em cada meta.</ThemedText>
      </> : null}
    </SheetScroll>
  </Sheet>;
}

const styles = StyleSheet.create({
  block: { gap: Space.md }, body: { paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.lg },
  reading: { gap: Space.sm }, qualifications: { gap: Space.half }, goal: { gap: Space.md },
  attempt: { paddingHorizontal: Space.lg, paddingBottom: Space.md, gap: Space.sm },
});
