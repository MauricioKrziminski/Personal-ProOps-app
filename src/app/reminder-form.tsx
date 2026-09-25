import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { Calendar } from '@/components/finance/calendar';
import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, TextField } from '@/components/ui/field';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Icon, type IconName } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { TaskHeader } from '@/components/ui/task-header';
import { HeroLabel } from '@/components/ui/section-head';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Elevation, Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';
import { useScheme, useTheme } from '@/hooks/use-theme';
import {
  useDeleteReminder,
  useReminder,
  useSaveReminder,
  useToggleReminder,
  type Reminder,
} from '@/hooks/use-items';
import {
  brToISO,
  fimQueSegueOInicio,
  isValidBRDate,
  isValidTime,
  isoToBR,
  localDateTime,
  localISODate,
  rotuloDoDia,
  timeBR,
} from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';
import { describeRRule } from '@/lib/rrule-text';
import { transicaoDeLayout } from '@/components/motion/transicao';

/**
 * Lembrete (criar/editar) — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * "Quando" são duas linhas com o valor à direita: a data abre o `Calendar` no lugar e a hora abre
 * o seletor do sistema (`TimePicker`). Ver o ⚠️ em `Quando` para o que isso substituiu.
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
/**
 * "Último dia do mês" na RRULE.
 *
 * ⚠️ Ele existe porque **o dia 31 não é isso**: `dateutil` (que é quem dispara o lembrete) PULA
 * os meses que não têm o dia — medido, `BYMONTHDAY=31` a partir de janeiro dá 31/01, 31/03,
 * 31/05, sem fevereiro e sem abril. O campo dizia o contrário ("cai no último dia") e a pessoa
 * ficava sem o lembrete justamente nos meses curtos, sem nada na tela avisando.
 */
const ULTIMO_DIA = -1;

const FREQ_OPTIONS = [
  { value: 'NONE', label: 'Não repete' },
  { value: 'DAILY', label: 'Dia' },
  { value: 'WEEKLY', label: 'Semana' },
  { value: 'MONTHLY', label: 'Mês' },
  { value: 'YEARLY', label: 'Ano' },
] as const;

/** Uma forma por frequência: o campo colapsado mostra o glifo antes do texto. */
const FREQ_ICONE = {
  NONE: 'minus',
  DAILY: 'sun.max',
  WEEKLY: 'calendar',
  MONTHLY: 'repeat',
  YEARLY: 'clock.arrow.circlepath',
} as const;

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
            // `-1` é "último dia do mês" na RRULE — um valor legítimo, não lixo a descartar.
            .filter((n) => n === ULTIMO_DIA || (n >= 1 && n <= 31))
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
    // `-1` ordena por último: ele É o último dia, e `a - b` cru o jogaria para a frente do dia 1.
    const dias = [...state.bymonthday].sort((a, b) =>
      a === ULTIMO_DIA ? 1 : b === ULTIMO_DIA ? -1 : a - b
    );
    parts.push(`BYMONTHDAY=${dias.join(',')}`);
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

const schema = z.object({
  title: z.string().refine((v) => v.trim().length > 0, 'Escreve o que você quer lembrar'),
  date: z.string().refine(isValidBRDate, 'Data em dd/mm/aaaa'),
  time: z.string().refine(isValidTime, 'Hora em HH:MM'),
  recurrence: z.string().nullable(),
  channel: z.enum(['push', 'whatsapp', 'both']),
}).superRefine((v, ctx) => {
  // Repetição que termina ANTES do primeiro lembrete: a série dispararia uma vez (ou nenhuma) e
  // morreria — e nada na tela dizia isso, porque o resumo da regra não mostra o UNTIL.
  const until = parseRRule(v.recurrence).until;
  if (!until || !isValidBRDate(v.date)) return;
  if (until.slice(0, 8) < v.date.split('/').reverse().join('')) {
    ctx.addIssue({
      code: 'custom',
      path: ['recurrence'],
      message: `A repetição termina antes do primeiro lembrete (${v.date}). Escolha um “Até” a partir dessa data.`,
    });
  }
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
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';
  // `title` e `noteId` chegam do menu "Criar lembrete" da nota: o título pré-preenche, e o
  // `noteId` vincula — é ele que faz a nota passar a oferecer "Editar lembrete".
  const params = useLocalSearchParams<{ id?: string; title?: string; noteId?: string }>();
  const query = useReminder(params.id);

  if (params.id && query.isLoading) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Editar lembrete" onClose={() => router.back()} />
        <View style={[styles.body, tablet && styles.tabletBody, styles.loading]}>
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
      <Screen scroll={false}>
        <TaskHeader title="Lembrete" onClose={() => router.back()} />
        <View style={[styles.body, tablet && styles.tabletBody]}>
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
        </View>
      </Screen>
    );
  }

  return (
    // Outro lembrete (ou outro ponto de partida) é outro formulário — ver o de lançamento.
    <ReminderForm
      key={`${params.id ?? 'novo'}:${params.noteId ?? ''}:${params.title ?? ''}`}
      editing={query.data}
      fallbackTitle={params.title}
      noteId={params.noteId}
      tablet={tablet}
    />
  );
}

function ReminderForm({
  editing,
  fallbackTitle,
  noteId,
  tablet,
}: {
  editing?: Reminder;
  fallbackTitle?: string;
  noteId?: string;
  tablet: boolean;
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
      today: localISODate(),
      openedAt: Date.now(),
    };
  });

  const { control, handleSubmit, setValue, getValues, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: editing?.title ?? fallbackTitle ?? '',
      date: now.date,
      time: now.time,
      recurrence: editing?.recurrence ?? null,
      /*
        **`push`, não `both`** (08/09/2026). O default da coluna no banco sempre foi `push`; era
        esta tela que sobrescrevia para `both`, e com isso todo lembrete criado no app nascia
        mandando também um template PAGO de WhatsApp — sem ninguém ter pedido esse canal. O canal
        proativo principal do produto é push (`whatsapp.md`: template Utility é complemento), e
        quem quer WhatsApp marca aqui.
      */
      channel: editing?.channel ?? 'push',
    },
  });

  const date = useWatch({ control, name: 'date' });

  /**
   * Mudar a DATA leva o "Até" da repetição junto quando ela passaria dele — o fim anda o mesmo
   * tanto (`fimQueSegueOInicio`). Era um erro ("a repetição termina antes do primeiro lembrete")
   * esperando a pessoa ajustar à mão uma consequência de outro campo (22/09/2026). O
   * `superRefine` do schema continua como rede: só regra que não é editável chega nele.
   */
  const mudarData = (br: string) => {
    const antes = getValues('date');
    setValue('date', br, { shouldValidate: true });
    const regra = getValues('recurrence');
    const st = parseRRule(regra);
    if (!st.until || !isEditableRRule(regra) || !isValidBRDate(br) || !isValidBRDate(antes)) return;
    const fimISO = `${st.until.slice(0, 4)}-${st.until.slice(4, 6)}-${st.until.slice(6, 8)}`;
    const novo = fimQueSegueOInicio(brToISO(antes), brToISO(br), fimISO);
    if (novo === fimISO) return;
    setValue('recurrence', buildRRule({ ...st, until: novo.replace(/-/g, '') + st.until.slice(8) }),
      { shouldValidate: true });
  };
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
        // só na criação: editar nunca mexe no vínculo
        ...(editing ? {} : { note_id: noteId ?? null }),
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        // Erro NUNCA fecha o modal nem limpa os campos.
        onError: (error) =>
          toast({
            // 23505 = `reminders_note_id_key`: dois toques (ou dois aparelhos) no "Criar lembrete"
            message:
              error && typeof error === 'object' && 'code' in error && error.code === '23505'
                ? 'Essa nota já tem um lembrete. Abra ele pelo menu da nota.'
                : 'Não deu para salvar. Tenta de novo.',
            tone: 'error',
          }),
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
      <TaskHeader
        title={editing ? 'Editar lembrete' : 'Novo lembrete'}
        onClose={() => router.back()}
        action={
          <Button
            label={save.isPending ? 'Salvando…' : 'Salvar'}
            size="sm"
            disabled={save.isPending}
            loading={save.isPending}
            onPress={onSubmit}
          />
        }
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, tablet && styles.tabletBody, { paddingBottom: insets.bottom + Space.xxl }]}
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
            <Field label="Título" error={errors.title?.message}>
              <TextField
                value={field.value}
                onChangeText={field.onChange}
                placeholder="Ex.: pagar o aluguel"
                autoFocus={!editing}
                accessibilityLabel="Título"
                invalid={!!errors.title}
              />
            </Field>
          )}
        />

        <Card>
          <Field label="Quando" error={errors.date?.message ?? errors.time?.message}>
            <Quando
              data={date}
              hora={time}
              hoje={now.today}
              onData={mudarData}
              onHora={(hhmm) => setValue('time', hhmm, { shouldValidate: true })}
              invalido={!!errors.date || !!errors.time}
            />
          </Field>
          {isPast && !errors.date && !errors.time ? (
            <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
              <ThemedText type="small" themeColor="warning">
                Já passou: dispara em 1 minuto
              </ThemedText>
            </Animated.View>
          ) : null}
        </Card>

        <Controller
          control={control}
          name="recurrence"
          render={({ field, fieldState }) => (
            <RecurrenceEditor
              value={field.value}
              onChange={field.onChange}
              inicio={date}
              erro={fieldState.error?.message}
            />
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
                      ? 'Precisa das notificações ligadas'
                      : 'Exige avisos de WhatsApp no Perfil'
                  }>
                  <Segmented options={CHANNELS} value={field.value} onChange={field.onChange} />
                </Field>
              )}
            />
          </View>
        </Card>

        {/* O único destaque da tela: é o resultado do formulário inteiro numa frase. */}
        <Card style={styles.summary}>
          <HeroLabel>Próximo disparo</HeroLabel>
          <ThemedText
            accessibilityLiveRegion="polite"
            style={[Type.title2, tabular]}>
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
        </Card>

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
              variant="secondary"
              tone="danger"
              loading={remove.isPending}
              onPress={onDelete}
            />
          </View>
        ) : null}
      </KeyboardAwareScrollView>
      <ToastDoModal />
    </Screen>
  );
}

/**
 * **Quando** — a data e a hora como duas linhas, o valor à direita, o seletor embaixo da linha.
 *
 * ⚠️ **Substituiu chips + campos soltos** (23/09/2026). Eram "Amanhã" + um seletor de data numa
 * fileira com `wrap` (onde o `flex: 1` do valor dava largura ZERO ao texto: a data nem aparecia,
 * só o ícone) e cinco horas fixas + um `TextField` de `HH:MM` sem máscara — apagado, não voltava a
 * ser hora nenhuma, porque o teclado numérico do iPhone não tem ":". A queixa foi *"esses chips
 * com esse campo de input do lado nada a ver"*. Agora a data é o `Calendar` (o mesmo do app
 * inteiro, no lugar) e a hora é o seletor do sistema — roda no iOS, relógio no Android —, que não
 * aceita hora inválida. Os chips saíram: o calendário já marca hoje, e um toque escolhe amanhã.
 *
 * Uma linha aberta por vez: data e hora abertas juntas empurravam o resto do formulário para
 * fora da tela.
 */
function Quando({
  data,
  hora,
  hoje,
  onData,
  onHora,
  invalido,
}: {
  /** dd/mm/aaaa */
  data: string;
  /** HH:MM */
  hora: string;
  /** ISO de hoje, congelado na abertura do formulário. */
  hoje: string;
  onData: (br: string) => void;
  onHora: (hhmm: string) => void;
  invalido: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const [aberta, setAberta] = useState<'data' | 'hora' | null>(null);
  const alternar = (qual: 'data' | 'hora') => {
    Haptics.selectionAsync();
    // O título nasce com o foco: sem isto o teclado ficava por cima do calendário e da roda.
    Keyboard.dismiss();
    setAberta((atual) => (atual === qual ? null : qual));
  };
  const iso = isValidBRDate(data) ? brToISO(data) : null;
  const rotulo = iso ? rotuloDoDia(iso, hoje) : 'Escolher';
  const painel = [styles.painel, { borderTopColor: theme.cardBorder }];
  // Vidro só fechado, como no `SelectField` logo abaixo: aberto, o calendário e a roda precisam
  // de fundo sólido para serem lidos.
  const vidro = supportsLiquidGlass() && aberta === null;
  // O leitor de tela lê por extenso ("quarta-feira, 24 de setembro"), não "Qua, 24 set".
  const dataFalada = iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        ...(iso.slice(0, 4) === hoje.slice(0, 4) ? {} : { year: 'numeric' }),
      })
    : undefined;

  return (
    <View
      style={[
        styles.quando,
        {
          backgroundColor: vidro ? 'transparent' : theme.surface,
          borderColor: invalido ? theme.danger : theme.cardBorder,
          boxShadow: vidro ? undefined : Elevation[scheme].raised,
        },
      ]}>
      {vidro ? <GlassBackdrop fallbackColor={theme.surface} radius={Radius.md} /> : null}
      <LinhaDoQuando
        icone="calendar"
        rotulo="Data"
        valor={rotulo.charAt(0).toUpperCase() + rotulo.slice(1)}
        falado={dataFalada}
        aberta={aberta === 'data'}
        onPress={() => alternar('data')}
      />
      {aberta === 'data' ? (
        <View style={painel}>
          <Calendar
            value={iso}
            min={hoje}
            onChange={(escolhido) => {
              // O dia já vibra no `Calendar`: um toque, um haptic.
              onData(isoToBR(escolhido));
              setAberta(null);
            }}
          />
        </View>
      ) : null}
      <View style={[styles.divisorQuando, { backgroundColor: theme.separator }]} />
      <LinhaDoQuando
        icone="clock"
        rotulo="Hora"
        valor={isValidTime(hora) ? hora : 'Escolher'}
        aberta={aberta === 'hora'}
        onPress={() => alternar('hora')}
      />
      {aberta === 'hora' ? (
        <TimePicker
          value={hora}
          onChange={onHora}
          onClose={() => setAberta(null)}
          inlineStyle={painel}
        />
      ) : null}
    </View>
  );
}

function LinhaDoQuando({
  icone,
  rotulo,
  valor,
  aberta,
  onPress,
  falado,
}: {
  icone: IconName;
  rotulo: string;
  valor: string;
  aberta: boolean;
  onPress: () => void;
  /** O valor como o leitor de tela deve dizer, quando o curto da tela não serve. */
  falado?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: aberta }}
      accessibilityLabel={`${rotulo}: ${falado ?? valor}`}
      accessibilityHint="Toque para mudar">
      {({ pressed }) => (
        <View
          style={[
            styles.linhaQuando,
            { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
          ]}>
          <View
            style={[
              styles.ladrilho,
              {
                backgroundColor: aberta ? theme.tintFill : theme.backgroundElement,
                borderColor: aberta ? 'transparent' : theme.cardBorder,
              },
            ]}>
            <Icon name={icone} size="sm" color={aberta ? 'onTint' : 'textSecondary'} />
          </View>
          <ThemedText style={styles.cresce}>{rotulo}</ThemedText>
          <ThemedText type="headline" style={[tabular, styles.valorQuando]}>
            {valor}
          </ThemedText>
          <Icon name={aberta ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />
        </View>
      )}
    </Pressable>
  );
}

/**
 * Editor de recorrência. O valor do form É a string RRULE — os controles só leem com
 * `parseRRule` e escrevem com `buildRRule`, então não existe estado paralelo para dessincronizar.
 */
function RecurrenceEditor({
  value,
  onChange,
  inicio,
  erro,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  /** A data do lembrete (dd/mm/aaaa): o "Até" nasce nela e não pode vir antes dela. */
  inicio: string;
  erro?: string;
}) {
  const editable = isEditableRRule(value);
  const state = parseRRule(value);
  const patch = (changes: Partial<RecurrenceState>) => onChange(buildRRule({ ...state, ...changes }));
  /*
    O "até" precisa de texto PRÓPRIO enquanto se digita: a regra só aceita a data quando ela fica
    válida, e um campo controlado pela regra devolveria o valor antigo no primeiro dígito.
    ⚠️ Mas SÓ enquanto se digita. O texto era inicializado uma vez e nunca mais seguia a regra:
    escolher "Numa data" gravava UNTIL = hoje com o campo mostrando vazio, e voltar de "Nunca"
    mostrava a data antiga gravando outra (22/09/2026). Fora da digitação, o campo mostra a regra.
  */
  const [ateDigitando, setAteDigitando] = useState<string | null>(null);
  const ateTexto = ateDigitando ?? (state.until ? untilToBR(state.until) : '');

  const endMode = state.count ? 'count' : state.until ? 'until' : 'never';

  if (!editable) {
    // Regra que veio do WhatsApp e que não sabemos reescrever: mostrar crua e exigir um toque
    // consciente para substituir. Mentir editando pela metade é pior.
    return (
      <Card>
        <View style={styles.block}>
          <ThemedText type="smallBold">Repetir</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Criada pelo WhatsApp: {describeRRule(value)}
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
        <Field label="Repetir">
          {/*
            Cinco opções não cabem num `Segmented`: a 384dp × 1,3 cada célula fica
            com ~62pt e "Não repete" precisa de ~97 — a mesma medida que tirou o
            tipo de conta de lá. `SelectField` é o campo de escolher UM item num
            formulário, e este formulário já vive dentro de um `Sheet`.
          */}
          <SelectField
            options={FREQ_OPTIONS.map((f) => ({ id: f.value, label: f.label, icon: FREQ_ICONE[f.value] }))}
            value={state.freq ?? 'NONE'}
            placeholder="Não repete"
            onChange={(next) =>
              // Trocar de frequência PRESERVA o INTERVAL; BYDAY e BYMONTHDAY são descartados
              // junto com a frequência a que pertencem.
              onChange(
                buildRRule({
                  ...state,
                  freq: next === 'NONE' || next === null ? null : (next as Freq),
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
              {/* Campo aberto (22/09/2026): "1, 2, 3, 4, 6, 12" não deixava "a cada 5 semanas". */}
              <QuantityField
                value={state.interval}
                max={99}
                onChange={(n) => patch({ interval: n })}
                accessibilityLabel="Intervalo da repetição"
              />
            </Field>
          </Animated.View>
        ) : null}

        {state.freq === 'WEEKLY' ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field
              label="Em quais dias"
              hint={state.byday.length === 0 ? 'Vazio: o dia da data acima' : undefined}>
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
                  ? 'Dia 31 não dispara em fevereiro nem em meses de 30. Use “Último dia”.'
                  : state.bymonthday.length > 4
                    ? `Isso vai disparar ${state.bymonthday.length} vezes por mês.`
                    : state.bymonthday.length === 0
                      ? 'Vazio: o dia da data acima'
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
                {/*
                  Depois do 31, porque é onde a pessoa chega procurando "o fim do mês" — e é o
                  único valor da fileira que NÃO é um número de dia.
                */}
                <Chip
                  label="Último dia"
                  selected={state.bymonthday.includes(ULTIMO_DIA)}
                  onPress={() =>
                    patch({
                      bymonthday: state.bymonthday.includes(ULTIMO_DIA)
                        ? state.bymonthday.filter((d) => d !== ULTIMO_DIA)
                        : [...state.bymonthday, ULTIMO_DIA],
                    })
                  }
                />
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
                onChange={(next) => {
                  setAteDigitando(null);
                  patch({
                    count: next === 'count' ? 12 : null,
                    // nasce na data do próprio lembrete — a primeira que vale — e APARECE no campo
                    until: next === 'until'
                      ? (isValidBRDate(inicio) ? inicio.split('/').reverse().join('') : localISODate().replace(/-/g, ''))
                      : null,
                  });
                }}
              />
            </Field>
          </Animated.View>
        ) : null}

        {state.until ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field label="Até" error={erro}>
              <DatePickerField
                value={ateTexto}
                onChange={(texto) => {
                  if (isValidBRDate(texto)) {
                    setAteDigitando(null);
                    patch({ until: texto.split('/').reverse().join('') });
                  } else {
                    setAteDigitando(texto);
                  }
                }}
                accessibilityLabel="Repetir até a data"
                // o calendário nem oferece dia antes do primeiro lembrete
                min={isValidBRDate(inicio) ? brToISO(inicio) : undefined}
              />
            </Field>
          </Animated.View>
        ) : null}

        {state.count ? (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Field label="Quantas vezes">
              {/* Campo aberto, não atalhos fixos (22/09/2026): "3, 6, 12, 24, 36" não deixava
                  escolher 10 lembretes. */}
              <QuantityField
                value={state.count}
                onChange={(n) => patch({ count: n })}
                accessibilityLabel="Quantas vezes repetir"
              />
            </Field>
          </Animated.View>
        ) : null}
      </View>
    </Card>
  );
}

const linear = transicaoDeLayout;

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
  tabletBody: { maxWidth: 560 },
  block: {
    gap: Space.lg,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    alignItems: 'center',
  },
  quando: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  linhaQuando: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
  },
  /** Caixa de GEOMETRIA: o ícone não cresce com a fonte, o texto ao lado sim (mesma do `SelectField`). */
  ladrilho: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cresce: { flex: 1 },
  /** O valor não cede: "Amanhã" e "10:26" são o dado da linha, o rótulo é que quebra. */
  valorQuando: { flexShrink: 0 },
  divisorQuando: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg + 36 + Space.md,
  },
  painel: { borderTopWidth: StyleSheet.hairlineWidth, padding: Space.sm },
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
