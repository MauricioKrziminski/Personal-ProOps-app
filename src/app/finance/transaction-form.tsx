import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { Chip } from '@/components/finance/chip';
import { ThemedText } from '@/components/themed-text';
import { HeaderActions } from '@/components/ui/header-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth } from '@/constants/theme';
import { Motion, Space, Type } from '@/design/tokens';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useCreateInstallmentPlan,
  useDeleteTransaction,
  useSaveTransaction,
  useTransaction,
  type Transaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { brToISO, formatBRL, isValidBRDate, isoToBR, localISODate } from '@/lib/dates';
import { confirmDestructive } from '@/lib/item-actions';

/**
 * Novo/editar lançamento — modal do Stack raiz (Cancelar nativo vem do `_layout.tsx`).
 *
 * O item em edição vem de `useTransaction(id)`, nunca do cache da lista: com cache frio o modal
 * de EDIÇÃO virava modal de CRIAÇÃO em silêncio e duplicava o lançamento. Por isso a decisão
 * "é edição ou criação?" acontece ANTES de montar o form (o gate abaixo) — enquanto a query não
 * responde, não existe formulário para submeter.
 */

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Receita' },
  { value: 'transfer', label: 'Transferência' },
];

/** Opções de parcelamento mais comuns no varejo brasileiro. */
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 10, 12, 18, 24] as const;

const schema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount_cents: z.number().int().positive('Informe o valor'),
    category: z.string().nullable(),
    description: z.string().nullable(),
    merchant: z.string().nullable(),
    account_id: z.string().nullable(),
    counterparty_account_id: z.string().nullable(),
    // 1 = à vista; >= 2 vira plano de parcelas (RPC create_installment_plan)
    installments: z.number().int().min(1).max(72),
    occurred_at: z.string().refine(isValidBRDate, 'Data em dd/mm/aaaa'),
    /** "Isso ainda vai acontecer" — vira `status='pending'`, a base da projeção de caixa. */
    pending: z.boolean(),
    due_at: z.string().nullable(),
  })
  .refine((data) => data.installments === 1 || (data.kind === 'expense' && !!data.account_id), {
    message: 'Parcelamento precisa de uma conta/cartão e só vale para gastos',
    path: ['installments'],
  })
  .refine((data) => data.kind !== 'transfer' || !!data.counterparty_account_id, {
    message: 'Escolha a conta de destino',
    path: ['counterparty_account_id'],
  })
  .refine(
    (data) =>
      data.kind !== 'transfer' ||
      !data.counterparty_account_id ||
      data.account_id !== data.counterparty_account_id,
    { message: 'Origem e destino precisam ser diferentes', path: ['counterparty_account_id'] },
  )
  .refine((data) => !data.pending || (!!data.due_at && isValidBRDate(data.due_at)), {
    message: 'Informe o vencimento em dd/mm/aaaa',
    path: ['due_at'],
  })
  // ISO compara lexicograficamente, então `>=` já é comparação de data.
  .refine(
    (data) =>
      !data.pending ||
      !data.due_at ||
      !isValidBRDate(data.due_at) ||
      !isValidBRDate(data.occurred_at) ||
      brToISO(data.due_at) >= brToISO(data.occurred_at),
    { message: 'O vencimento não pode ser antes da data do lançamento', path: ['due_at'] },
  );

type FormValues = z.infer<typeof schema>;

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const query = useTransaction(params.id);

  if (params.id && query.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Editar lançamento' }} />
        <View style={styles.loading}>
          <Skeleton height={56} />
          <Skeleton height={36} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
          <Skeleton width="45%" height={Type.footnote.lineHeight} />
          <Skeleton height={48} />
        </View>
      </Screen>
    );
  }

  // Nunca cair em modo criação por omissão: um id que não resolve é erro, não formulário vazio.
  if (params.id && (query.isError || !query.data)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Lançamento' }} />
        <Card>
          <View style={styles.errorCard}>
            <Icon name="exclamationmark.triangle" size="xl" color="danger" />
            <ThemedText type="smallBold">Não encontrei esse lançamento</ThemedText>
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

  // `?? undefined`: `useTransaction` devolve null quando a linha não existe mais
  // (maybeSingle), e "não achei" e "não estou editando" são o mesmo caso aqui —
  // o form abre em branco, que é o comportamento de criar.
  return <TransactionForm editing={query.data ?? undefined} />;
}

function TransactionForm({ editing }: { editing?: Transaction }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { data: accounts } = useAccounts();

  const save = useSaveTransaction();
  const createPlan = useCreateInstallmentPlan();
  const remove = useDeleteTransaction();

  const { control, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // `editing` já chegou resolvido pelo gate — sem `useEffect`+`reset`, sem corrida.
    defaultValues: {
      kind: editing?.kind ?? 'expense',
      amount_cents: editing?.amount_cents ?? 0,
      category: editing?.category ?? null,
      description: editing?.description ?? null,
      merchant: editing?.merchant ?? null,
      account_id: editing?.account_id ?? null,
      counterparty_account_id: editing?.counterparty_account_id ?? null,
      installments: 1,
      occurred_at: isoToBR(editing?.occurred_at ?? localISODate()),
      pending: editing?.status === 'pending',
      due_at: editing?.due_at ? isoToBR(editing.due_at) : null,
    },
  });

  // useWatch (e não watch()): watch() não é memoizável e o React Compiler pula a tela inteira
  const kind = useWatch({ control, name: 'kind' });
  const occurredAt = useWatch({ control, name: 'occurred_at' });
  const accountId = useWatch({ control, name: 'account_id' });
  const amountCents = useWatch({ control, name: 'amount_cents' });
  const pending = useWatch({ control, name: 'pending' });
  const errors = formState.errors;

  // "hoje"/"ontem" congelados na abertura do modal: ler o relógio durante o render é impuro
  // (React Compiler) e o modal é efêmero.
  const [{ today, yesterday }] = useState(() => ({
    today: isoToBR(localISODate()),
    yesterday: isoToBR(localISODate(new Date(Date.now() - 86_400_000))),
  }));

  const account = (accounts ?? []).find((a) => a.id === accountId);
  const isCard = account?.type === 'credit_card';
  /**
   * Conta a pagar não existe em cartão: a compra já entra na fatura e o caixa sai quando a
   * fatura vence. Marcar `pending` aqui contaria o MESMO gasto duas vezes na projeção.
   */
  const podeAdiar = kind !== 'transfer' && !isCard;
  // parcelar só faz sentido em gasto com conta escolhida (normalmente cartão)
  const podeParcelar = kind === 'expense' && !!accountId && !editing;

  const saving = save.isPending || createPlan.isPending;

  const onSubmit = handleSubmit((values) => {
    // parcelado: quem cria as N transações (e resolve a fatura de cada uma) é o
    // banco, não o app — mesma regra usada pelo WhatsApp.
    if (!editing && values.installments > 1 && values.account_id) {
      createPlan.mutate(
        {
          accountId: values.account_id,
          totalCents: values.amount_cents,
          installments: values.installments,
          occurredAt: brToISO(values.occurred_at),
          description: values.description?.trim() || null,
          category: values.category,
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
          onError: () =>
            toast({ message: 'Não deu para parcelar. Tenta de novo.', tone: 'error' }),
        },
      );
      return;
    }

    // Reforço do `podeAdiar`: trocar para cartão depois de marcar "vou pagar depois" não
    // pode vazar um `pending` que a UI já escondeu.
    const adiado = podeAdiar && values.pending;

    save.mutate(
      {
        id: editing?.id,
        kind: values.kind,
        amount_cents: values.amount_cents,
        category: values.kind === 'transfer' ? null : values.category,
        description: values.description?.trim() || null,
        merchant: values.merchant?.trim() || null,
        account_id: values.account_id,
        counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null,
        occurred_at: brToISO(values.occurred_at),
        status: adiado ? 'pending' : 'cleared',
        due_at: adiado && values.due_at ? brToISO(values.due_at) : null,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
        // Erro NUNCA fecha o modal: o que foi digitado continua na tela.
        onError: () => toast({ message: 'Não deu para salvar. Tenta de novo.', tone: 'error' }),
      },
    );
  });

  const onDelete = () => {
    if (!editing) return;
    const what = `${formatBRL(editing.amount_cents)}${editing.category ? ` em ${editing.category}` : ''}`;
    confirmDestructive(
      'Apagar este lançamento?',
      'Apagar',
      () =>
        remove.mutate(editing.id, {
          onSuccess: () => {
            router.back();
            toast({ message: `Apaguei ${what}.`, tone: 'success' });
          },
          onError: () => toast({ message: 'Não deu para apagar. Tenta de novo.', tone: 'error' }),
        }),
      `${what}. Isso não volta.`,
    );
  };

  return (
    <Screen scroll={false}>
      <Stack.Screen
        options={{
          title: editing ? 'Editar lançamento' : 'Novo lançamento',
        }}
      />

      <HeaderActions
        actions={[{ label: saving ? 'Salvando…' : 'Salvar', disabled: saving, primary: true, onPress: onSubmit }]}
      />

      <KeyboardAwareScrollView
        bottomOffset={Space.xxl}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Space.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic">
        {/* Valor primeiro: é o único campo obrigatório e já abre o teclado numérico. */}
        <Controller
          control={control}
          name="amount_cents"
          render={({ field }) => (
            <Field label="Valor" error={errors.amount_cents?.message}>
              <MoneyField
                valueCents={field.value}
                onChangeCents={field.onChange}
                autoFocus={!editing}
                invalid={!!errors.amount_cents}
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <Segmented options={KINDS} value={field.value} onChange={field.onChange} />
          )}
        />

        {kind !== 'transfer' && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field label="Categoria">
                  <View style={styles.chipRow}>
                    {SUGGESTED_CATEGORIES.map((cat) => (
                      <Chip
                        key={cat}
                        label={cat}
                        selected={field.value === cat}
                        onPress={() => field.onChange(field.value === cat ? null : cat)}
                      />
                    ))}
                  </View>
                </Field>
              )}
            />
          </Animated.View>
        )}

        <Controller
          control={control}
          name="account_id"
          render={({ field }) => (
            <Field
              label={kind === 'transfer' ? 'Da conta' : 'Conta'}
              hint={
                (accounts ?? []).length === 0
                  ? 'Lançamento sem conta também vale — ele entra no caixa.'
                  : undefined
              }>
              <View style={styles.chipRow}>
                {(accounts ?? []).map((acc) => (
                  <Chip
                    key={acc.id}
                    label={acc.name}
                    selected={field.value === acc.id}
                    onPress={() => {
                      const next = field.value === acc.id ? null : acc.id;
                      field.onChange(next);
                      // Trocar para cartão desliga "vou pagar depois" em vez de só escondê-lo.
                      if (acc.type === 'credit_card' && next) {
                        setValue('pending', false);
                        setValue('due_at', null);
                      }
                    }}
                  />
                ))}
                {(accounts ?? []).length === 0 && (
                  <Button
                    label="Cadastrar uma conta"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.push('/finance/accounts')}
                  />
                )}
              </View>
            </Field>
          )}
        />

        {kind === 'transfer' && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="counterparty_account_id"
              render={({ field }) => (
                <Field label="Para a conta" error={errors.counterparty_account_id?.message}>
                  <View style={styles.chipRow}>
                    {(accounts ?? []).map((acc) => (
                      <Chip
                        key={acc.id}
                        label={acc.name}
                        selected={field.value === acc.id}
                        onPress={() => field.onChange(acc.id)}
                      />
                    ))}
                  </View>
                </Field>
              )}
            />
          </Animated.View>
        )}

        {podeParcelar && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Controller
              control={control}
              name="installments"
              render={({ field }) => (
                <Field
                  label="Parcelas"
                  error={errors.installments?.message}
                  hint={
                    field.value > 1 && amountCents > 0
                      ? `${field.value}x de ${formatBRL(Math.floor(amountCents / field.value))} — o valor acima é o TOTAL da compra. As parcelas futuras já entram nas próximas faturas.`
                      : undefined
                  }>
                  <View style={styles.chipRow}>
                    {INSTALLMENT_OPTIONS.map((n) => (
                      <Chip
                        key={n}
                        label={n === 1 ? 'À vista' : `${n}x`}
                        selected={field.value === n}
                        onPress={() => field.onChange(n)}
                      />
                    ))}
                  </View>
                </Field>
              )}
            />
          </Animated.View>
        )}

        <Controller
          control={control}
          name="occurred_at"
          render={({ field }) => (
            <Field label="Data" error={errors.occurred_at?.message}>
              <View style={styles.chipRow}>
                <Chip
                  label="Hoje"
                  selected={occurredAt === today}
                  onPress={() => setValue('occurred_at', today, { shouldValidate: true })}
                />
                <Chip
                  label="Ontem"
                  selected={occurredAt === yesterday}
                  onPress={() => setValue('occurred_at', yesterday, { shouldValidate: true })}
                />
                <TextField
                  value={field.value}
                  onChangeText={field.onChange}
                  placeholder="dd/mm/aaaa"
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityLabel="Data do lançamento"
                  invalid={!!errors.occurred_at}
                  style={styles.dateField}
                />
              </View>
            </Field>
          )}
        />

        {/* Conta a pagar: o gasto entra na projeção pelo vencimento, não pela data de hoje. */}
        {podeAdiar && (
          <Animated.View entering={FadeIn.duration(Motion.duration.base)} layout={linear}>
            <Card>
              <View style={styles.pendingCard}>
                <Controller
                  control={control}
                  name="pending"
                  render={({ field }) => (
                    <Segmented
                      options={[
                        { value: 'no', label: 'Já aconteceu' },
                        { value: 'yes', label: 'Ainda vai acontecer' },
                      ]}
                      value={field.value ? 'yes' : 'no'}
                      onChange={(v) => field.onChange(v === 'yes')}
                    />
                  )}
                />
                {pending ? (
                  <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
                    <Controller
                      control={control}
                      name="due_at"
                      render={({ field }) => (
                        <Field
                          label="Vence em"
                          error={errors.due_at?.message}
                          hint={
                            errors.due_at
                              ? undefined
                              : 'Fica como conta a pagar até você confirmar que pagou.'
                          }>
                          <TextField
                            value={field.value ?? ''}
                            onChangeText={(text) => field.onChange(text || null)}
                            placeholder="dd/mm/aaaa"
                            keyboardType="number-pad"
                            maxLength={10}
                            accessibilityLabel="Data de vencimento"
                            invalid={!!errors.due_at}
                            style={styles.dateField}
                          />
                        </Field>
                      )}
                    />
                  </Animated.View>
                ) : null}
              </View>
            </Card>
          </Animated.View>
        )}

        {isCard ? (
          <ThemedText type="small" themeColor="textSecondary">
            Compra no cartão já entra na fatura — o dinheiro sai do caixa quando a fatura vence.
          </ThemedText>
        ) : null}

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Field label="Descrição">
              <TextField
                value={field.value ?? ''}
                onChangeText={(text) => field.onChange(text || null)}
                placeholder="Ex.: compras da semana"
                accessibilityLabel="Descrição"
                multiline
                style={styles.multiline}
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="merchant"
          render={({ field }) => (
            <Field label="Estabelecimento">
              <TextField
                value={field.value ?? ''}
                onChangeText={(text) => field.onChange(text || null)}
                placeholder="Ex.: Padaria do Zé"
                accessibilityLabel="Estabelecimento"
              />
            </Field>
          )}
        />

        {editing ? (
          <Button
            label="Apagar lançamento"
            variant="ghost"
            onPress={onDelete}
            loading={remove.isPending}
            block
          />
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
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
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  pendingCard: {
    gap: Space.lg,
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
