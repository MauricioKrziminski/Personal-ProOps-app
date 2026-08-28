import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { Chip } from '@/components/finance/chip';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { Fonts, MaxContentWidth } from '@/constants/theme';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import {
  useDeleteReminder,
  useReminder,
  useSaveReminder,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import {
  isValidBRDate,
  isValidTime,
  isoToBR,
  localDateTime,
  localISODate,
  timeBR,
} from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';

/**
 * Lembrete (criar/editar) — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * Data e hora por texto + chips, sem `datetimepicker`: evita dependência nativa (que exigiria
 * rebuild) e mantém as duas telas de formulário com a mesma cara.
 */

// ── RRULE: leitura e escrita ────────────────────────────────────────────────
//
// `describeRRule` (src/lib/rrule-text.ts) já traduz RRULE → português. Falta a volta, e é ela que
// conserta o bug real: a IA grava `FREQ=MONTHLY;BYMONTHDAY=5` a partir de "todo dia 5", os cinco
// chips antigos não casavam com isso, e o primeiro toque DESTRUÍA a regra que a IA acertou.

type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

interface RecurrenceState {
  /** `null` = não repete. */
  freq: Freq | null;
  interval: number;
  byday: string[];
  bymonthday: number[];
  count: number | null;
  /** Token cru da RRULE (`20261231` ou `20261231T000000Z`) — preservado como veio. */
  until: string | null;
}

const NO_RECURRENCE: RecurrenceState = {
  freq: null,
  interval: 1,
  byday: [],
  bymonthday: [],
  count: null,
  until: null,
};

const WEEKDAYS = [
  { value: 'MO', label: 'seg' },
  { value: 'TU', label: 'ter' },
  { value: 'WE', label: 'qua' },
  { value: 'TH', label: 'qui' },
  { value: 'FR', label: 'sex' },
  { value: 'SA', label: 'sáb' },
  { value: 'SU', label: 'dom' },
] as const;

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const FREQ_OPTIONS = [
  { value: 'NONE', label: 'Não repete' },
  { value: 'DAILY', label: 'Dia' },
  { value: 'WEEKLY', label: 'Semana' },
  { value: 'MONTHLY', label: 'Mês' },
  { value: 'YEARLY', label: 'Ano' },
] as const;

const FREQ_UNIT: Record<Freq, [string, string]> = {
  DAILY: ['dia', 'dias'],
  WEEKLY: ['semana', 'semanas'],
  MONTHLY: ['mês', 'meses'],
  YEARLY: ['ano', 'anos'],
};

function parseRRule(rrule: string | null): RecurrenceState {
  if (!rrule?.trim()) return NO_RECURRENCE;

  const parts: Record<string, string> = {};
  for (const chunk of rrule.trim().replace(/^RRULE:/i, '').split(';')) {
    const [key, value] = chunk.split('=');
    if (key && value) parts[key.trim().toUpperCase()] = value.trim().toUpperCase();
  }

  const freq = parts.FREQ as Freq | undefined;
  if (!freq || !FREQ_UNIT[freq]) return NO_RECURRENCE;

  const interval = Number(parts.INTERVAL ?? '1');
  return {
    freq,
    interval: Number.isInteger(interval) && interval >= 1 ? interval : 1,
    byday:
      freq === 'WEEKLY' && parts.BYDAY
        ? parts.BYDAY.split(',').filter((d) => WEEKDAYS.some((w) => w.value === d))
        : [],
    bymonthday:
      freq === 'MONTHLY' && parts.BYMONTHDAY
        ? parts.BYMONTHDAY.split(',')
            .map(Number)
            .filter((n) => n >= 1 && n <= 31)
        : [],
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until: parts.UNTIL ?? null,
  };
}

/**
 * Ordem das chaves igual à que a IA produz e `INTERVAL=1` OMITIDO: `FREQ=WEEKLY` e
 * `FREQ=WEEKLY;INTERVAL=1` são a mesma regra, e escrever a longa faria a mesma coisa parecer
 * diferente dependendo de quem criou. É isso que faz o round-trip fechar byte a byte.
 */
function buildRRule(state: RecurrenceState): string | null {
  if (!state.freq) return null;

  const parts = [`FREQ=${state.freq}`];
  if (state.interval > 1) parts.push(`INTERVAL=${state.interval}`);
  if (state.freq === 'WEEKLY' && state.byday.length) {
    const ordered = WEEKDAYS.filter((w) => state.byday.includes(w.value)).map((w) => w.value);
    parts.push(`BYDAY=${ordered.join(',')}`);
  }
  if (state.freq === 'MONTHLY' && state.bymonthday.length) {
    parts.push(`BYMONTHDAY=${[...state.bymonthday].sort((a, b) => a - b).join(',')}`);
  }
  // COUNT e UNTIL são mutuamente exclusivos na RRULE; COUNT ganha.
  if (state.count) parts.push(`COUNT=${state.count}`);
  else if (state.until) parts.push(`UNTIL=${state.until}`);

  return parts.join(';');
}

/**
 * Regra que não sobrevive a `build(parse(x)) === x` NÃO vira controle editável: abrir e fechar
 * sem tocar em nada tem que devolver a regra idêntica. Editar pela metade é pior que admitir
 * o limite.
 */
function isEditableRRule(rrule: string | null): boolean {
  if (!rrule?.trim()) return true;
  return buildRRule(parseRRule(rrule)) === rrule.trim().replace(/^RRULE:/i, '').toUpperCase();
}

/** `20261231T000000Z` → `31/12/2026` (só a parte da data importa para o usuário). */
const untilToBR = (until: string) =>
  isoToBR(`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`);

// ── formulário ──────────────────────────────────────────────────────────────

const CHANNELS = [
  { value: 'push', label: 'Push' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Os dois' },
] as const;

const HOURS = ['08:00', '09:00', '12:00', '18:00', '21:00'];

const schema = z.object({
  title: z.string().refine((v) => v.trim().length > 0, 'Escreve o que você quer lembrar'),
  date: z.string().refine(isValidBRDate, 'Data em dd/mm/aaaa'),
  time: z.string().refine(isValidTime, 'Hora em HH:MM'),
  recurrence: z.string().nullable(),
  channel: z.enum(['push', 'whatsapp', 'both']),
});

type FormValues = z.infer<typeof schema>;

const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
};

export default function ReminderFormScreen() {
  // `title` chega do menu "Criar lembrete" do detalhe de nota — pré-preenche e nada mais.
  const params = useLocalSearchParams<{ id?: string; title?: string }>();
  const query = useReminder(params.id);

  if (params.id && query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Editar lembrete' }} />
        <View style={styles.loading}>
          <Skeleton height={48} />
          <Skeleton height={120} />
          <Skeleton height={120} />
          <Skeleton height={96} />
        </View>
      </Screen>
    );
  }

  // Enquanto a query não responde, a tela não decide se é criação ou edição — e um id que não
  // resolve NUNCA cai em modo criação (era assim que uma edição virava lembrete duplicado).
  if (params.id && (query.isError || !query.data)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Lembrete' }} />
        <Card>
          <View style={styles.errorCard}>
            <Icon name="bell.slash" size="xl" color="danger" />
            <ThemedText type="smallBold">Esse lembrete não existe mais</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Ele pode ter sido apagado em outro aparelho.
            </ThemedText>
            <View style={styles.errorActions}>
              <Button
                label="Tentar de novo"
                variant="secondary"
                size="sm"
                onPress={() => query.refetch()}
              />
              <Button label="Voltar" size="sm" onPress={() => router.back()} />
            </View>
          </View>
        </Card>
      </Screen>
    );
  }

  return <ReminderForm editing={query.data} fallbackTitle={params.title} />;
}

function ReminderForm({
  editing,
  fallbackTitle,
}: {
  editing?: Reminder;
  fallbackTitle?: string;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const save = useSaveReminder();
  const toggle = useToggleReminder();
  const remove = useDeleteReminder();

  // Ler o relógio a cada render é impuro (React Compiler) e o modal é efêmero.
  const [now] = useState(() => {
    const base = editing ? new Date(editing.next_run_at) : new Date(Date.now() + 60 * 60 * 1000);
    return {
      date: isoToBR(localISODate(base)),
      time: timeBR(base),
      today: isoToBR(localISODate()),
      tomorrow: isoToBR(localISODate(new Date(Date.now() + 86_400_000))),
      openedAt: Date.now(),
    };
  });

  const { control, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: editing?.title ?? fallbackTitle ?? '',
      date: now.date,
      time: now.time,
      recurrence: editing?.recurrence ?? null,
      channel: editing?.channel ?? 'both',
    },
  });

  const date = useWatch({ control, name: 'date' });
  const time = useWatch({ control, name: 'time' });
  const recurrence = useWatch({ control, name: 'recurrence' });
  const channel = useWatch({ control, name: 'channel' });
  const errors = formState.errors;

  const when = localDateTime(date, time);
  const isPast = when !== null && when.getTime() < now.openedAt;
  const failed = !!editing?.last_error;
  const attempts = editing?.send_attempts ?? 0;

  const onSubmit = handleSubmit((values) => {
    const at = localDateTime(values.date, values.time);
    if (!at) return;
    save.mutate(
      {
        id: editing?.id,
        title: values.title.trim(),
        recurrence: values.recurrence,
        next_run_at: at.toISOString(),
        channel: values.channel,
        timezone: deviceTimezone(),
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        // Erro NUNCA fecha o modal nem limpa os campos.
        onError: () => toast({ message: 'Não deu para salvar. Tenta de novo.', tone: 'error' }),
      },
    );
  });

  const onToggleActive = (active: boolean) => {
    if (!editing) return;
    toggle.mutate(
      { id: editing.id, active },
      {
        onSuccess: () =>
          toast({
            message: active ? 'Lembrete reativado.' : 'Lembrete pausado.',
            tone: 'success',
          }),
        onError: () => toast({ message: 'Não deu para mudar. Tenta de novo.', tone: 'error' }),
      },
    );
  };

  const onDelete = () => {
    if (!editing) return;
    confirmDestructive(
      'Apagar este lembrete?',
      'Apagar',
      () =>
        remove.mutate(editing.id, {
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei “${editing.title}”.`, tone: 'success' });
          },
          onError: () => toast({ message: 'Não deu para apagar. Tenta de novo.', tone: 'error' }),
        }),
      `“${editing.title}”. Isso não volta.`,
    );
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          title: editing ? 'Editar lembrete' : 'Novo lembrete',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Salvar"
              accessibilityState={{ disabled: save.isPending, busy: save.isPending }}
              hitSlop={12}
              disabled={save.isPending}
              onPress={onSubmit}>
              <ThemedText type="default" themeColor={save.isPending ? 'textSecondary' : 'tint'}>
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </ThemedText>
            </Pressable>
          ),
        }}
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Space.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/* Vem antes do título: é a única informação da tela que explica por que o produto não
            fez o que prometeu. Salvar já reativa a série (`useSaveReminder` zera o contador). */}
        {failed || attempts > 0 ? (
          <Card>
            <View accessibilityRole="alert" style={styles.alert}>
              <View style={styles.alertHead}>
                <Icon name="exclamationmark.triangle.fill" size="md" color="danger" />
                <ThemedText type="smallBold" themeColor="danger">
                  {editing?.active
                    ? `Tentamos avisar ${attempts} ${attempts === 1 ? 'vez' : 'vezes'} e não deu`
                    : 'Este lembrete falhou e foi desativado'}
                </ThemedText>
              </View>
              {editing?.last_error ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Último erro: {editing.last_error}
                </ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {editing?.active
                  ? 'Vamos tentar de novo no próximo horário.'
                  : 'Salvar ou reativar zera o contador e a série volta a valer.'}
              </ThemedText>
              {editing?.active ? null : (
                <Button
                  label="Reativar"
                  variant="secondary"
                  size="sm"
                  loading={toggle.isPending}
                  onPress={() => onToggleActive(true)}
                />
              )}
            </View>
          </Card>
        ) : null}

        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <Field label="O que lembrar" error={errors.title?.message}>
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                placeholder="Ex.: pagar o aluguel"
                autoFocus={!editing}
                accessibilityLabel="O que lembrar"
                invalid={!!errors.title}
              />
            </Field>
          )}
        />

        <Card>
          <View style={styles.block}>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <Field label="Quando" error={errors.date?.message}>
                  <View style={styles.chipRow}>
                    <Chip
                      label="Hoje"
                      selected={field.value === now.today}
                      onPress={() => setValue('date', now.today, { shouldValidate: true })}
                    />
                    <Chip
                      label="Amanhã"
                      selected={field.value === now.tomorrow}
                      onPress={() => setValue('date', now.tomorrow, { shouldValidate: true })}
                    />
                    <TextField
                      value={field.value}
                      onChangeText={field.onChange}
                      placeholder="dd/mm/aaaa"
                      keyboardType="number-pad"
                      maxLength={10}
                      accessibilityLabel="Data do lembrete"
                      invalid={!!errors.date}
                      style={styles.dateField}
                    />
                  </View>
                </Field>
              )}
            />

            <Controller
              control={control}
              name="time"
              render={({ field }) => (
                <Field label="Que horas" error={errors.time?.message}>
                  <View style={styles.chipRow}>
                    {HOURS.map((h) => (
                      <Chip
                        key={h}
                        label={h}
                        selected={field.value === h}
                        onPress={() => setValue('time', h, { shouldValidate: true })}
                      />
                    ))}
                    <TextField
                      value={field.value}
                      onChangeText={field.onChange}
                      placeholder="HH:MM"
                      keyboardType="number-pad"
                      maxLength={5}
                      accessibilityLabel="Hora do lembrete"
                      invalid={!!errors.time}
                      style={styles.timeField}
                    />
                  </View>
                </Field>
              )}
            />

            {isPast && !errors.date && !errors.time ? (
              <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
                <ThemedText type="small" themeColor="warning">
                  Esse horário já passou — o lembrete dispara no próximo minuto.
                </ThemedText>
              </Animated.View>
            ) : null}
          </View>
        </Card>

        <Controller
          control={control}
          name="recurrence"
          render={({ field }) => (
            <RecurrenceEditor value={field.value} onChange={field.onChange} />
          )}
        />

        <Card>
          <View style={styles.block}>
            <Controller
              control={control}
              name="channel"
              render={({ field }) => (
                <Field
                  label="Onde avisar"
                  hint={
                    field.value === 'push'
                      ? 'Push é grátis. Se a notificação estiver desligada no aparelho, esse lembrete não chega.'
                      : 'Push é grátis; WhatsApp usa um template pago.'
                  }>
                  <Segmented
                    options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
          </View>
        </Card>

        {/* O único GlassCard da tela: é o resultado do formulário inteiro numa frase. */}
        <GlassCard style={styles.summary}>
          <ThemedText type="small" themeColor="textSecondary">
            Próximo disparo
          </ThemedText>
          <ThemedText
            accessibilityLiveRegion="polite"
            style={[Type.title2, tabular, styles.summaryValue]}>
            {when
              ? `${when.toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}, ${timeBR(when)}`
              : 'Escolha uma data e uma hora válidas'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {describeRRule(recurrence)} ·{' '}
            {channel === 'both' ? 'push e WhatsApp' : channel === 'push' ? 'push' : 'WhatsApp'}
          </ThemedText>
        </GlassCard>

        {editing ? (
          <View style={styles.footerActions}>
            <Button
              label={editing.active ? 'Pausar' : 'Retomar'}
              variant="secondary"
              loading={toggle.isPending}
              onPress={() => onToggleActive(!editing.active)}
            />
            <Button
              label="Apagar"
              variant="ghost"
              loading={remove.isPending}
              onPress={onDelete}
            />
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

/**
 * Editor de recorrência. O valor do form É a string RRULE — os controles só leem com
 * `parseRRule` e escrevem com `buildRRule`, então não existe estado paralelo para dessincronizar.
 */
function RecurrenceEditor({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const editable = isEditableRRule(value);
  const state = parseRRule(value);
  const patch = (changes: Partial<RecurrenceState>) => onChange(buildRRule({ ...state, ...changes }));

  const endMode = state.count ? 'count' : state.until ? 'until' : 'never';

  if (!editable) {
    // Regra que veio do WhatsApp e que não sabemos reescrever: mostrar crua e exigir um toque
    // consciente para substituir. Mentir editando pela metade é pior.
    return (
      <Card>
        <View style={styles.block}>
          <ThemedText type="smallBold">Repetir</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Regra avançada, criada pelo WhatsApp: {describeRRule(value)}
          </ThemedText>
          {/* Um toque não pode apagar uma regra que a IA acertou — daí a confirmação. */}
          <Button
            label="Substituir"
            variant="secondary"
            size="sm"
            onPress={() =>
              confirmDestructive(
                'Substituir esta repetição?',
                'Substituir',
                () => onChange(null),
                `A regra “${describeRRule(value)}” veio do WhatsApp e não volta.`,
              )
            }
          />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.block}>
        <Field label="Repetir" hint={describeRRule(value)}>
          <Segmented
            options={FREQ_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
            value={state.freq ?? 'NONE'}
            onChange={(next) =>
              // Trocar de frequência PRESERVA o INTERVAL; BYDAY e BYMONTHDAY são descartados
              // junto com a frequência a que pertencem.
              onChange(
                buildRRule({
                  ...state,
                  freq: next === 'NONE' ? null : (next as Freq),
                  byday: [],
                  bymonthday: [],
                }),
              )
            }
          />
        </Field>

        {state.freq ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field
              label={`A cada ${state.interval} ${FREQ_UNIT[state.freq][state.interval === 1 ? 0 : 1]}`}>
              <View style={styles.chipRow}>
                {[1, 2, 3, 4, 6, 12].map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    selected={state.interval === n}
                    onPress={() => patch({ interval: n })}
                  />
                ))}
              </View>
            </Field>
          </Animated.View>
        ) : null}

        {state.freq === 'WEEKLY' ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field
              label="Em quais dias"
              hint={state.byday.length === 0 ? 'Sem nenhum dia marcado, repete no dia da semana escolhido acima.' : undefined}>
              <View style={styles.chipRow}>
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day.value}
                    label={day.label}
                    selected={state.byday.includes(day.value)}
                    onPress={() =>
                      patch({
                        byday: state.byday.includes(day.value)
                          ? state.byday.filter((d) => d !== day.value)
                          : [...state.byday, day.value],
                      })
                    }
                  />
                ))}
              </View>
            </Field>
          </Animated.View>
        ) : null}

        {state.freq === 'MONTHLY' ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field
              label="Em quais dias do mês"
              hint={
                state.bymonthday.includes(31)
                  ? 'Em mês que não tem dia 31, cai no último dia.'
                  : state.bymonthday.length > 4
                    ? `Isso vai disparar ${state.bymonthday.length} vezes por mês.`
                    : state.bymonthday.length === 0
                      ? 'Sem nenhum dia marcado, repete no dia escolhido acima.'
                      : undefined
              }>
              <View style={styles.chipRow}>
                {MONTH_DAYS.map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    selected={state.bymonthday.includes(n)}
                    onPress={() =>
                      patch({
                        bymonthday: state.bymonthday.includes(n)
                          ? state.bymonthday.filter((d) => d !== n)
                          : [...state.bymonthday, n],
                      })
                    }
                  />
                ))}
              </View>
            </Field>
          </Animated.View>
        ) : null}

        {state.freq ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field label="Termina">
              {/* UNTIL e COUNT são mutuamente exclusivos na RRULE — aqui são um segmented de
                  três, então o estado impossível não existe na UI. */}
              <Segmented
                options={[
                  { value: 'never', label: 'Nunca' },
                  { value: 'until', label: 'Numa data' },
                  { value: 'count', label: 'Depois de N' },
                ]}
                value={endMode}
                onChange={(next) =>
                  patch({
                    count: next === 'count' ? 12 : null,
                    until: next === 'until' ? localISODate().replace(/-/g, '') : null,
                  })
                }
              />
            </Field>
          </Animated.View>
        ) : null}

        {state.until ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field label="Até">
              <TextField
                defaultValue={untilToBR(state.until)}
                onChangeText={(text) =>
                  isValidBRDate(text) ? patch({ until: text.split('/').reverse().join('') }) : undefined
                }
                placeholder="dd/mm/aaaa"
                keyboardType="number-pad"
                maxLength={10}
                accessibilityLabel="Repetir até a data"
                style={styles.dateField}
              />
            </Field>
          </Animated.View>
        ) : null}

        {state.count ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field label="Quantas vezes">
              <View style={styles.chipRow}>
                {[3, 6, 12, 24, 36].map((n) => (
                  <Chip
                    key={n}
                    label={`${n}x`}
                    selected={state.count === n}
                    onPress={() => patch({ count: n })}
                  />
                ))}
              </View>
            </Field>
          </Animated.View>
        ) : null}
      </View>
    </Card>
  );
}

/** Uma instância só: `LinearTransition` recriado a cada render remonta a animação. */
const linear = LinearTransition.duration(Motion.duration.base);

const styles = StyleSheet.create({
  // Replica o padding do `Screen`, que está com `scroll={false}` para o teclado ser
  // responsabilidade do `KeyboardAwareScrollView`.
  body: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  block: {
    gap: Space.lg,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    alignItems: 'center',
  },
  dateField: {
    minWidth: 140,
    textAlign: 'center',
  },
  timeField: {
    minWidth: 96,
    textAlign: 'center',
  },
  alert: {
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  summary: {
    gap: Space.sm,
  },
  summaryValue: {
    fontFamily: Fonts?.rounded,
  },
  footerActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  loading: {
    gap: Space.lg,
  },
  errorCard: {
    alignItems: 'center',
    gap: Space.md,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Space.md,
  },
  centered: {
    textAlign: 'center',
  },
});
