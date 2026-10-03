import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ErrorCard } from '@/components/error-card';
import { Presenca } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { concealText, useBRL, useConceal } from '@/components/ui/conceal';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, MoneyField } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { QuantityField } from '@/components/ui/quantity-field';
import { Row, Section } from '@/components/ui/row';
import { SelectField } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { ProgressBar } from '@/components/ui/sparkline';
import { SwitchRow } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { useToast } from '@/components/ui/toast';
import { Space, tabular } from '@/design/tokens';
import { type useEmergencyReserve, useSaveEmergencyReserve } from '@/hooks/use-emergency-reserve';
import {
  buildEmergencyReserveInput,
  emergencyReserveWriteError,
  EmergencyReserveAttemptCancelledError,
  formatEmergencyReserveCoverage,
  getEmergencyReserveSummary,
  type EmergencyReserveDraft,
  type EmergencyReserveInput,
  type EmergencyReserveSource,
  type EmergencyReserveState,
} from '@/lib/emergency-reserve';

const BASE_OPTIONS = [
  { id: 'manual', label: 'Informar um valor', icon: 'pencil' as const },
  { id: 'observed', label: 'Usar meu histórico', icon: 'clock.arrow.circlepath' as const },
];
const sourceKey = (source: Pick<EmergencyReserveSource, 'kind' | 'id'>) => `${source.kind}:${source.id}`;
const monthName = (month: string) => new Date(`${month}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const baseHint = {
  not_configured: 'Escolha o que está separado e quanto precisa por mês.',
  manual: 'Essenciais mensais informados por você.',
  observed: 'Média dos três meses completos que você revisou.',
  unreviewed: 'Revise os três meses completos para calcular sua base.',
  incomplete_classification: 'Há gastos sem necessidade classificada no período.',
  zero_base: 'O período revisado não tem uma base essencial positiva.',
};

type EditingSession = { snapshot: EmergencyReserveState; draft: EmergencyReserveDraft };

/** Owned by the screen, so resize/rotation cannot discard a draft or an unknown commit. */
export function useEmergencyReserveEditor(query: ReturnType<typeof useEmergencyReserve>) {
  const save = useSaveEmergencyReserve();
  const toast = useToast();
  const [session, setSession] = useState<EditingSession | null>(null);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const inFlight = useRef(false);
  const state = query.isError ? undefined : query.data;
  const busy = save.isPending || Boolean(save.unconfirmedInput);

  const open = () => {
    if (!state || !query.isSuccess || session) return;
    // An editor owns the revision it opened; realtime never replaces its draft/baseline.
    const snapshot: EmergencyReserveState = JSON.parse(JSON.stringify(state));
    setError('');
    setSession({ snapshot, draft: {
      baseMode: snapshot.config?.base_mode ?? 'manual',
      manualMonthlyCents: snapshot.config?.manual_monthly_cents ?? 0,
      targetMonths: snapshot.config?.target_months ?? 6,
      allocations: snapshot.sources.filter(source => source.allocated_cents > 0).map(source => ({
        kind: source.kind, id: source.id, amountCents: source.allocated_cents, liquidityConfirmed: source.liquidity_confirmed,
      })),
      reviewedMonths: snapshot.months.filter(month => month.reviewed).map(month => month.month),
      acknowledgeUnassignedGoals: false,
    } });
  };
  const close = () => {
    if (inFlight.current || busy) return;
    setSession(null); setError('');
  };
  const change = (draft: EmergencyReserveDraft) => {
    if (busy || !session) return;
    setSession({ ...session, draft }); setError('');
  };
  let valid = false;
  if (session) {
    try { buildEmergencyReserveInput(session.snapshot, session.draft); valid = true; } catch { /* Incomplete input stays local. */ }
  }
  const submit = (resolveAttempt = false) => {
    if (!session || inFlight.current) return;
    if (resolveAttempt && !save.unconfirmedInput) return;
    let input: EmergencyReserveInput | null = null;
    if (!resolveAttempt) {
      try { input = save.unconfirmedInput ?? buildEmergencyReserveInput(session.snapshot, session.draft); }
      catch (failure) { setError(emergencyReserveWriteError(failure)); return; }
    }
    inFlight.current = true;
    setError('');
    let request: ReturnType<typeof save.mutateAsync>;
    try {
      request = resolveAttempt ? save.resolveAsync() : save.mutateAsync(input!);
    } catch (failure) { request = Promise.reject(failure); }
    return request.then(() => {
      setSession(null);
      toast({ message: 'Reserva atualizada.', tone: 'success' });
    }).catch((failure: unknown) => {
      if (failure instanceof EmergencyReserveAttemptCancelledError) {
        setSession(null); setError('');
        toast({ message: 'Tentativa encerrada sem salvar. Abra a reserva para ajustar.', tone: 'info' });
      } else setError(emergencyReserveWriteError(failure));
    }).finally(() => { inFlight.current = false; });
  };

  return { session, error, details, setDetails, open, close, change, submit,
    resolvePending: () => submit(true), valid, busy, save };
}

type ReserveEditor = ReturnType<typeof useEmergencyReserveEditor>;

/** A reserve partitions existing money. Its read never adds another asset or ledger entry. */
export function EmergencyReserveSection({ query, editor }: {
  query: ReturnType<typeof useEmergencyReserve>; editor: ReserveEditor;
}) {
  const brl = useBRL();
  const { concealed } = useConceal();
  const state = query.isError ? undefined : query.data;
  const summary = state ? getEmergencyReserveSummary(state) : null;
  const { details, setDetails, open } = editor;

  return (
    <>
      {query.isError || !state ? <ErrorCard onRetry={() => { void query.refetch(); }} /> : summary ? (
        <View style={styles.block}>
          {state.config ? (
            <Section title="Reserva de emergência">
              <Row title="Separado para imprevistos" subtitle={state.workspace_name}
                accessibilityLabel={`Reserva de emergência, ${brl(summary.reservedCents)}.`}
                trailing={<Money cents={summary.reservedCents} variant="ticker" />} />
              <View style={styles.progress}>
                {summary.targetCents !== null && !concealed ? (
                  <ProgressBar value={summary.reservedCents} max={summary.targetCents} />
                ) : null}
              </View>
              <Row title="Cobertura" subtitle={baseHint[summary.baseStatus]}
                trailing={<ThemedText type="small" style={tabular}>{concealed ? concealText() : formatEmergencyReserveCoverage(summary)}</ThemedText>} />
              {summary.targetCents !== null ? <Row title={`Alvo de ${state.config.target_months} meses`}
                trailing={<Money cents={summary.targetCents} variant="ticker" />} /> : null}
              {summary.missingCents !== null ? <Row title={summary.missingCents > 0 ? 'Falta para o alvo' : 'Alvo coberto'}
                trailing={<Money cents={summary.missingCents} variant="ticker" />} /> : null}
              {summary.unbackedCents > 0 ? <Row title="Valor separado sem lastro atual"
                subtitle="O saldo ou a disponibilidade de uma fonte mudou. Confira seus vínculos."
                trailing={<Money cents={summary.unbackedCents} variant="ticker" tone="warning" />} /> : null}
              <Row title="Base e fontes" accessibilityState={{ expanded: details }} onPress={() => setDetails(current => !current)} />
            </Section>
          ) : <EmptyState compacto icon="shield" title="Sua reserva ainda não foi definida"
            hint="Separe parte do dinheiro que você já tem para imprevistos." />}
          <Presenca visivel={details && Boolean(state.config)} imediata style={styles.block}>
            <Section title="O que sustenta a reserva">
              {summary.monthlyCents !== null ? <Row title="Essenciais por mês"
                trailing={<Money cents={summary.monthlyCents} variant="ticker" />} /> : null}
              {state.sources.filter(source => source.allocated_cents > 0).map(source => (
                <Row key={sourceKey(source)} title={source.name}
                  subtitle={!source.eligible || source.archived ? 'Fonte indisponível. Retire ou ajuste o vínculo.'
                    : source.effective_cents < source.allocated_cents ? `Você separou ${brl(source.allocated_cents)}; o lastro atual é menor.`
                      : source.kind === 'asset' ? `Liquidez confirmada por você${source.valuation_date ? ` · marcação ${source.valuation_date.split('-').reverse().join('/')}` : ''}` : 'Parte do saldo confirmado desta conta'}
                  accessibilityLabel={`${source.name}, ${brl(source.effective_cents)} com lastro, ${brl(source.allocated_cents)} separado.`}
                  trailing={<Money cents={source.effective_cents} variant="ticker" />} />
              ))}
              {state.sources.every(source => source.allocated_cents === 0) ? <Row title="Nenhuma fonte separada" subtitle="Configure os valores de contas ou investimentos disponíveis." /> : null}
              {state.config?.base_mode === 'observed' ? state.months.map(month => (
                <Row key={month.month} title={monthName(month.month)}
                  subtitle={`${month.reviewed ? 'Revisado' : 'Revisão pendente'} · ${month.expense_count} gastos${month.unclassified_count ? ` · ${month.unclassified_count} sem classificação` : ''}`}
                  trailing={<Money cents={month.essential_cents} variant="ticker" />} />
              )) : null}
            </Section>
          </Presenca>
          <Button label={state.config ? 'Editar reserva' : 'Configurar reserva'} variant="secondary" size="sm" onPress={open} />
        </View>
      ) : null}
    </>
  );
}

/** The modal is a stable sibling of the adaptive panels, with feedback above its scroll. */
export function EmergencyReserveSheet({ editor }: { editor: ReserveEditor }) {
  const { session, error, close, change, submit, resolvePending, valid, busy, save } = editor;
  return (
      <Sheet visible={session !== null} onClose={close}>
        <TaskHeader title="Reserva de emergência" onClose={close} action={
          <Button label={save.unconfirmedInput ? 'Confirmar tentativa' : 'Salvar reserva'} size="sm"
            loading={save.isPending && !save.isResolving} disabled={save.isResolving || (!valid && !save.unconfirmedInput)} onPress={() => { void submit(); }} />
        } />
        {session ? (
          <>
          {error || save.unconfirmedInput ? <View style={styles.feedback}>
            {error ? <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{error}</ThemedText> : null}
            {save.unconfirmedInput ? <ThemedText type="small" themeColor="textSecondary">Confirme a tentativa com os mesmos dados antes de editar ou fechar.</ThemedText> : null}
            {save.unconfirmedInput && (error || save.isResolving) ? <Button label="Conferir e encerrar tentativa" variant="secondary" size="sm"
              disabled={save.isPending} loading={save.isResolving} onPress={() => { void resolvePending(); }} /> : null}
          </View> : null}
          <SheetScroll contentContainerStyle={styles.sheetBody}>
            <View pointerEvents={busy ? 'none' : 'auto'} style={styles.editor}>
              <EmergencyReserveEditor snapshot={session.snapshot} draft={session.draft} onChange={change} />
            </View>
          </SheetScroll>
          </>
        ) : null}
      </Sheet>
  );
}

/** Shared fields preserve choices while base/source controls reveal their dependent inputs. */
export function EmergencyReserveEditor({ snapshot, draft, onChange }: {
  snapshot: EmergencyReserveState; draft: EmergencyReserveDraft; onChange: (draft: EmergencyReserveDraft) => void;
}) {
  const brl = useBRL();
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const used = new Set(draft.allocations.map(sourceKey));
  const options = snapshot.sources.filter(source => source.eligible && !source.archived && !used.has(sourceKey(source))
    && source.available_cents > source.other_allocated_cents).map(source => ({
      id: sourceKey(source), label: source.name, icon: source.kind === 'account' ? 'wallet.bifold' as const : 'chart.line.uptrend.xyaxis' as const,
      detail: `${brl(Math.max(source.available_cents - source.other_allocated_cents, 0))} sem alocação identificada`,
      detailHidden: `${concealText()} sem alocação identificada`,
    }));
  const chosen = snapshot.sources.find(source => sourceKey(source) === selectedSource);
  const updateAllocation = (index: number, patch: Partial<EmergencyReserveDraft['allocations'][number]>) =>
    onChange({ ...draft, allocations: draft.allocations.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return (
    <>
      <Field label="Base mensal">
        <SelectField options={BASE_OPTIONS} value={draft.baseMode}
          onChange={value => { if (value === 'manual' || value === 'observed') onChange({ ...draft, baseMode: value }); }} />
      </Field>
      <Presenca visivel={draft.baseMode === 'manual'} imediata>
        <Field label="Essenciais por mês" hint="Quanto precisa para suas necessidades essenciais. Você pode ajustar depois."
          error={draft.manualMonthlyCents <= 0 ? 'Informe um valor maior que zero.' : undefined}>
          <MoneyField valueCents={draft.manualMonthlyCents} onChangeCents={manualMonthlyCents => onChange({ ...draft, manualMonthlyCents })}
            accessibilityLabel="Essenciais por mês" />
        </Field>
      </Presenca>
      <Presenca visivel={draft.baseMode === 'observed'} imediata style={styles.editor}>
        <ThemedText type="small" themeColor="textSecondary">Confira os três meses completos. Mês revisado sem gasto vale zero; mês sem revisão não comprova a base.</ThemedText>
        {snapshot.months.map(month => (
          <Card key={month.month} style={styles.block}>
            <ThemedText type="smallBold">{monthName(month.month)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{month.expense_count} gastos · essenciais {brl(month.essential_cents)}</ThemedText>
            {month.unclassified_count > 0 ? (
              <ThemedText type="small" themeColor="warning">{month.unclassified_count} gastos sem necessidade classificada. Classifique-os ou informe uma base mensal.</ThemedText>
            ) : <SwitchRow label={`Revisei ${monthName(month.month)}`} value={draft.reviewedMonths.includes(month.month)}
              onValueChange={checked => onChange({ ...draft, reviewedMonths: checked ? [...draft.reviewedMonths, month.month] : draft.reviewedMonths.filter(value => value !== month.month) })} />}
          </Card>
        ))}
      </Presenca>
      <Field label="Meses de proteção" hint="Escolha o horizonte que faz sentido para você.">
        <QuantityField value={draft.targetMonths} min={1} max={60}
          onChange={targetMonths => onChange({ ...draft, targetMonths })} accessibilityLabel="Meses de proteção" />
      </Field>
      {draft.allocations.map((allocation, index) => {
        const source = snapshot.sources.find(item => sourceKey(item) === sourceKey(allocation));
        const available = source ? Math.max(source.available_cents - source.other_allocated_cents, 0) : 0;
        return (
          <Card key={sourceKey(allocation)} style={styles.editor}>
            <ThemedText type="smallBold">{source?.name ?? 'Fonte indisponível'}</ThemedText>
            <Field label={`Separar em ${source?.name ?? 'fonte indisponível'}`} hint={`Disponível sem outra alocação identificada: ${brl(available)}`}
              error={!source?.eligible || source.archived ? 'Esta fonte está indisponível. Retire o vínculo.'
                : allocation.amountCents <= 0 ? 'Informe um valor maior que zero.' : allocation.amountCents > available ? 'O valor ultrapassa o saldo disponível.' : undefined}>
              <MoneyField valueCents={allocation.amountCents} onChangeCents={amountCents => updateAllocation(index, { amountCents })}
                accessibilityLabel={`Separar em ${source?.name ?? 'fonte indisponível'}`} />
            </Field>
            <SwitchRow label={`Disponível para imprevistos em ${source?.name ?? 'esta fonte'}`} value={allocation.liquidityConfirmed}
              onValueChange={liquidityConfirmed => updateAllocation(index, { liquidityConfirmed })} />
            <Button label={`Retirar vínculo de ${source?.name ?? 'fonte indisponível'}`} variant="secondary" size="sm"
              onPress={() => onChange({ ...draft, allocations: draft.allocations.filter((_, i) => i !== index) })} />
          </Card>
        );
      })}
      <Field label="Adicionar fonte" hint="Se o investimento também aparece como conta, escolha uma única origem.">
        <SelectField options={options} value={selectedSource} placeholder={options.length ? 'Escolher fonte' : 'Nenhuma fonte disponível'} onChange={setSelectedSource} />
      </Field>
      {chosen && !used.has(sourceKey(chosen)) ? <Button label="Adicionar à reserva" variant="secondary" size="sm" onPress={() => {
        onChange({ ...draft, allocations: [...draft.allocations, { kind: chosen.kind, id: chosen.id, amountCents: 0, liquidityConfirmed: false }] });
        setSelectedSource(null);
      }} /> : null}
      {snapshot.unassigned_goals_cents > 0 ? (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">Suas metas têm {brl(snapshot.unassigned_goals_cents)} sem origem identificada. Confira para não separar o mesmo dinheiro duas vezes.</ThemedText>
          <SwitchRow label="Estes valores não estão também nas metas sem origem" value={draft.acknowledgeUnassignedGoals}
            onValueChange={acknowledgeUnassignedGoals => onChange({ ...draft, acknowledgeUnassignedGoals })} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  feedback: { paddingHorizontal: Space.lg, paddingTop: Space.sm, gap: Space.sm },
  block: { gap: Space.md },
  editor: { gap: Space.xl },
  sheetBody: { gap: Space.xl, padding: Space.lg, paddingBottom: Space.xxxl },
  progress: { paddingHorizontal: Space.lg },
});
