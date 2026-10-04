import { StyleSheet, View } from 'react-native';

import { DatePickerField } from '@/components/finance/date-picker-field';
import { Presenca } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { concealText, useBRL, useConceal } from '@/components/ui/conceal';
import { Field, MoneyField } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import { Row, Section } from '@/components/ui/row';
import { Segmented } from '@/components/ui/segmented';
import { Space } from '@/design/tokens';
import { brToISO, isoToBR, mesCurto } from '@/lib/dates';
import { calculateGoalContribution, goalContributionAt, type GoalContributionInput, type GoalContributionResult } from '@/lib/goal-contribution';
import { goalContributionInput, type GoalHorizonEntry, type GoalHorizonItem } from '@/lib/goal-horizon';
import type { GoalPlanningGoal } from '@/lib/goal-planning';

type Props = {
  goal: GoalPlanningGoal; item: GoalHorizonItem; asOf: string; busy: boolean; legacy: boolean;
  onChange: (patch: Partial<Omit<GoalHorizonItem, 'goal_id'>>) => void;
};
const MODES = [{ value: 'deadline', label: 'Por prazo' }, { value: 'monthly', label: 'Por mês' }] as const;
const LEGACY_MODES = [{ value: 'legacy', label: 'Atual' }, ...MODES] as const;
const REASONS = {
  monthly_amount: 'Informe quanto consegue guardar por mês.', first_date: 'Escolha a data do primeiro aporte mensal.',
  initial_date: 'Escolha a data do aporte inicial.', initial_after_first: 'O aporte inicial precisa vir antes ou junto do primeiro mensal.',
  initial_after_deadline: 'O aporte inicial precisa caber no prazo do plano.', deadline: 'Escolha um prazo com pelo menos uma contribuição.',
  calendar_range: 'Este valor leva a um prazo além do calendário disponível. Aumente o aporte mensal.',
};

/** A card describes the saved source, independently of the goal's reference deadline. */
export function GoalContributionCaption({ entry }: { entry: GoalHorizonEntry }) {
  const { concealed } = useConceal();
  if (concealed) return <ThemedText type="footnote" themeColor="textSecondary">Plano oculto</ThemedText>;
  const { item, result } = entry;
  if (result.status !== 'ready') return <ThemedText type="footnote" themeColor="textSecondary">Confira o plano</ThemedText>;
  const conclusion = item.mode === 'legacy' ? ' no plano atual'
    : ` · previsão ${mesCurto(result.estimated_on!)}/${result.estimated_on!.slice(0, 4)}`;
  return <ThemedText type="footnote" themeColor="textSecondary">
    {result.monthly_count > 0 ? <><Money cents={result.monthly_cents!} variant="footnote" tone="textSecondary" />/mês{conclusion}</>
      : `Aporte inicial${conclusion}`}
  </ThemedText>;
}

/** This block owns presentation only; the editor above responsive panels owns every input. */
export function GoalContributionFields({ goal, item, asOf, busy, legacy, onChange }: Props) {
  return <View style={styles.block}>
    <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'}>
      <Field label="Como planejar"><Segmented options={legacy ? LEGACY_MODES : MODES} value={item.mode}
        onChange={mode => onChange({ mode })} /></Field>
    </View>
    <Presenca visivel={item.mode !== 'deadline'} imediata>
      <Field label="Aporte por mês" hint={<GoalContributionHint goal={goal} item={item} asOf={asOf} />}><MoneyField valueCents={item.monthly_cents ?? 0} readOnly={busy}
        accessibilityLabel={`Aporte mensal para ${goal.name}`} onChangeCents={monthly_cents => onChange({ monthly_cents })} /></Field>
    </Presenca>
    <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'} style={styles.block}>
      <Presenca visivel={item.mode === 'deadline'} imediata>
        <Field label="Prazo do plano" hint={<GoalContributionHint goal={goal} item={item} asOf={asOf} />}>
          <DatePickerField value={item.deadline_on ? isoToBR(item.deadline_on) : null} accessibilityLabel={`Prazo do plano para ${goal.name}`}
            onChange={value => onChange({ deadline_on: brToISO(value) })} />
        </Field>
      </Presenca>
      <Field label="Primeiro aporte mensal"><DatePickerField value={item.first_on ? isoToBR(item.first_on) : null}
        accessibilityLabel={`Primeiro aporte para ${goal.name}`} onChange={value => onChange({ first_on: brToISO(value) })} /></Field>
    </View>
    <Field label="Aporte inicial" hint="Opcional, antes dos mensais. Este valor faz parte do plano.">
      <MoneyField valueCents={item.initial_cents} readOnly={busy} accessibilityLabel={`Aporte inicial para ${goal.name}`}
        onChangeCents={initial_cents => onChange({ initial_cents, initial_on: item.initial_on ?? (initial_cents > 0 ? asOf : null) })} />
    </Field>
    <Presenca visivel={item.initial_cents > 0} imediata>
      <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy} importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'}>
        <Field label="Data do aporte inicial"><DatePickerField value={item.initial_on ? isoToBR(item.initial_on) : null}
          accessibilityLabel={`Data do aporte inicial para ${goal.name}`} onChange={value => onChange({ initial_on: brToISO(value) })} /></Field>
      </View>
    </Presenca>
    <GoalContributionSummary goal={goal} item={item} asOf={asOf} />
  </View>;
}

function GoalContributionHint({ goal, item, asOf }: Pick<Props, 'goal' | 'item' | 'asOf'>) {
  const { concealed } = useConceal();const brl = useBRL();
  if (concealed) return <ThemedText type="footnote" themeColor="textSecondary">Previsão oculta</ThemedText>;
  const result = calculateGoalContribution(goalContributionInput(goal, asOf, item));
  if (result.status !== 'ready') return null;
  const count = result.contribution_count;
  const prediction = `${isoToBR(result.estimated_on!)} · ${count} ${count === 1 ? 'contribuição' : 'contribuições'}`;
  return <ThemedText type="footnote" themeColor="textSecondary" accessibilityLiveRegion="polite">
    {result.monthly_count === 0 ? `Aporte inicial cobre o restante · ${isoToBR(result.estimated_on!)}`
      : item.mode === 'deadline' ? `${brl(result.monthly_cents!)} por mês · ${prediction}` : `Conclusão em ${prediction}`}
  </ThemedText>;
}

export function GoalContributionSummary({ goal, item, asOf }: Pick<Props, 'goal' | 'item' | 'asOf'>) {
  const { concealed } = useConceal();
  if (concealed) return <Row title="Previsão oculta" trailing={<ThemedText>{concealText()}</ThemedText>} accessibilityLabel="Previsão da meta oculta" />;
  const input = goalContributionInput(goal, asOf, item);const result = calculateGoalContribution(input);
  if (result.status === 'reached') return <Row title="Meta atingida" subtitle="O valor guardado já cobre esta meta." />;
  if (result.status !== 'ready') return <View style={styles.block}>
    <ThemedText type="footnote" themeColor="textSecondary" accessibilityLiveRegion="polite">
      {result.reason ? REASONS[result.reason] : 'Confira os dados do plano.'}
    </ThemedText>
    {result.flags.includes('initial_past') ? <ThemedText type="footnote" themeColor="warning">O aporte inicial ficou no passado. Só o dinheiro realmente guardado reduz a meta.</ThemedText> : null}
  </View>;
  return <GoalContributionReady goal={goal} item={item} input={input} result={result} />;
}

function GoalContributionReady({ goal, item, input, result }: Pick<Props, 'goal' | 'item'> & {
  input: GoalContributionInput; result: GoalContributionResult;
}) {
  const beyondDeadline = goal.deadline !== null && result.estimated_on! > goal.deadline;
  const count = result.contribution_count;
  const indexes = [...new Set([0, ...(count > 1 ? [1] : []), ...(count > 2 ? [count - 1] : [])])];
  return <View style={styles.block} testID={`goal-contribution-result-${goal.goal_id}`}>
    <Section title="Previsão">
      <Row title={item.mode === 'legacy' && beyondDeadline ? 'Prazo com este aporte' : 'Conclusão prevista'} trailing={<ThemedText>{isoToBR(result.estimated_on!)}</ThemedText>} inlineValue />
      <Row title="Falta guardar" trailing={<Money cents={result.remaining_cents} />} inlineValue />
      {item.mode === 'deadline' && result.monthly_count > 0 ? <Row title="Por mês" trailing={<Money cents={result.monthly_cents!} />} inlineValue /> : null}
    </Section>
    <ThemedText type="footnote" themeColor="textSecondary">{`${count} ${count === 1 ? 'contribuição' : 'contribuições'} · sem rendimento estimado`}</ThemedText>
    {result.flags.includes('initial_past') ? <ThemedText type="footnote" themeColor="warning">O aporte inicial ficou no passado. Só o dinheiro realmente guardado reduz a meta.</ThemedText> : null}
    {beyondDeadline ? <ThemedText type="footnote" themeColor="warning">
      {item.mode === 'legacy' ? 'O plano atual para no prazo da meta. Escolha Por mês para continuar.' : `A previsão passa do prazo da meta: ${isoToBR(goal.deadline!)}.`}
    </ThemedText> : null}
    <Section title="Calendário">
      {indexes.map(index => {
        const contribution = goalContributionAt(input, index)!;
        return <Row key={index} title={contribution.kind === 'initial' ? 'Aporte inicial' : index === count - 1 && count > 1 ? 'Última contribuição' : `${index + 1}ª contribuição`}
          subtitle={isoToBR(contribution.on)} trailing={<Money cents={contribution.cents} />} inlineValue />;
      })}
    </Section>
  </View>;
}
const styles = StyleSheet.create({ block: { gap: Space.md } });
