import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { z } from 'zod';

import { Chip } from '@/components/finance/chip';
import { MoneyInput } from '@/components/finance/money-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useCreateInstallmentPlan,
  useDeleteTransaction,
  useSaveTransaction,
  useTransaction,
  type TransactionKind,
} from '@/hooks/use-finance';
import { formatBRL, localISODate } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'expense', label: '💸 Gasto' },
  { value: 'income', label: '💰 Receita' },
  { value: 'transfer', label: '🔄 Transferência' },
];

const schema = z
  .object({
    kind: z.enum(['expense', 'income', 'transfer']),
    amount_cents: z.number().int().positive('Informe o valor'),
    category: z.string().nullable(),
    description: z.string().nullable(),
    account_id: z.string().nullable(),
    counterparty_account_id: z.string().nullable(),
    // 1 = à vista; >= 2 vira plano de parcelas (RPC create_installment_plan)
    installments: z.number().int().min(1).max(72),
    occurred_at: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Data em dd/mm/aaaa')
      .refine((value) => {
        const [d, m, y] = value.split('/').map(Number);
        const date = new Date(y, m - 1, d);
        return date.getDate() === d && date.getMonth() === m - 1;
      }, 'Data inválida'),
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
  );

type FormValues = z.infer<typeof schema>;

/** Opções de parcelamento mais comuns no varejo brasileiro. */
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 10, 12, 18, 24] as const;

const toBR = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const toISO = (br: string) => {
  const [d, m, y] = br.split('/');
  return `${y}-${m}-${d}`;
};

export default function TransactionFormScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string; month?: string }>();
  const { data: accounts } = useAccounts();
  // Busca por id, não garimpo no cache da lista: com cache frio o modal de edição virava um
  // modal de criação em silêncio e duplicava o lançamento.
  const editingQuery = useTransaction(params.id);
  const editing = editingQuery.data;

  const save = useSaveTransaction();
  const createPlan = useCreateInstallmentPlan();
  const remove = useDeleteTransaction();

  const { control, handleSubmit, setValue, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'expense',
      amount_cents: 0,
      category: null,
      description: null,
      account_id: null,
      counterparty_account_id: null,
      installments: 1,
      occurred_at: toBR(localISODate()),
    },
  });

  useEffect(() => {
    if (editing) {
      reset({
        kind: editing.kind,
        amount_cents: editing.amount_cents,
        category: editing.category,
        description: editing.description,
        account_id: editing.account_id,
        counterparty_account_id: editing.counterparty_account_id,
        installments: 1,
        occurred_at: toBR(editing.occurred_at),
      });
    }
  }, [editing, reset]);

  // useWatch (e não watch()): watch() não é memoizável e o React Compiler pula a tela inteira
  const kind = useWatch({ control, name: 'kind' });
  const occurredAt = useWatch({ control, name: 'occurred_at' });
  // "hoje"/"ontem" congelados na abertura do modal: ler o relógio durante o
  // render é impuro (React Compiler) e o modal é efêmero.
  const [{ today, yesterday }] = useState(() => ({
    today: toBR(localISODate()),
    yesterday: toBR(localISODate(new Date(Date.now() - 86_400_000))),
  }));
  const accountId = useWatch({ control, name: 'account_id' });
  const amountCents = useWatch({ control, name: 'amount_cents' });
  const errors = formState.errors;
  // parcelar só faz sentido em gasto com conta escolhida (normalmente cartão)
  const podeParcelar = kind === 'expense' && !!accountId && !editing;

  const onSubmit = handleSubmit((values) => {
    // parcelado: quem cria as N transações (e resolve a fatura de cada uma) é o
    // banco, não o app — mesma regra usada pelo WhatsApp.
    if (!editing && values.installments > 1 && values.account_id) {
      createPlan.mutate(
        {
          accountId: values.account_id,
          totalCents: values.amount_cents,
          installments: values.installments,
          occurredAt: toISO(values.occurred_at),
          description: values.description?.trim() || null,
          category: values.category,
        },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.back();
          },
        },
      );
      return;
    }
    save.mutate(
      {
        id: editing?.id,
        kind: values.kind,
        amount_cents: values.amount_cents,
        category: values.kind === 'transfer' ? null : values.category,
        description: values.description?.trim() || null,
        account_id: values.account_id,
        counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null,
        occurred_at: toISO(values.occurred_at),
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.back();
        },
      },
    );
  });

  const onDelete = () => {
    if (!editing) return;
    remove.mutate(editing.id, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        router.back();
      },
    });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Stack.Screen options={{ title: editing ? 'Editar lançamento' : 'Novo lançamento' }} />

            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <View style={styles.chipRow}>
                  {KINDS.map((k) => (
                    <Chip
                      key={k.value}
                      label={k.label}
                      selected={field.value === k.value}
                      onPress={() => field.onChange(k.value)}
                    />
                  ))}
                </View>
              )}
            />

            <Controller
              control={control}
              name="amount_cents"
              render={({ field }) => (
                <MoneyInput valueCents={field.value} onChangeCents={field.onChange} autoFocus={!editing} />
              )}
            />
            {errors.amount_cents && (
              <ThemedText type="small" themeColor="danger">
                {errors.amount_cents.message}
              </ThemedText>
            )}

            {kind !== 'transfer' && (
              <>
                <ThemedText type="smallBold">Categoria</ThemedText>
                <Controller
                  control={control}
                  name="category"
                  render={({ field }) => (
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
                  )}
                />
              </>
            )}

            <ThemedText type="smallBold">{kind === 'transfer' ? 'Da conta' : 'Conta'}</ThemedText>
            <Controller
              control={control}
              name="account_id"
              render={({ field }) => (
                <View style={styles.chipRow}>
                  {(accounts ?? []).map((account) => (
                    <Chip
                      key={account.id}
                      label={account.name}
                      selected={field.value === account.id}
                      onPress={() => field.onChange(field.value === account.id ? null : account.id)}
                    />
                  ))}
                  {(accounts ?? []).length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Sem contas — cadastre em Financeiro › Contas.
                    </ThemedText>
                  )}
                </View>
              )}
            />

            {podeParcelar && (
              <>
                <ThemedText type="smallBold">Parcelas</ThemedText>
                <Controller
                  control={control}
                  name="installments"
                  render={({ field }) => (
                    <>
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
                      {field.value > 1 && amountCents > 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {field.value}x de {formatBRL(Math.floor(amountCents / field.value))} —
                          o valor acima é o TOTAL da compra. As parcelas futuras já entram nas
                          próximas faturas.
                        </ThemedText>
                      )}
                    </>
                  )}
                />
                {errors.installments && (
                  <ThemedText type="small" themeColor="danger">
                    {errors.installments.message}
                  </ThemedText>
                )}
              </>
            )}

            {kind === 'transfer' && (
              <>
                <ThemedText type="smallBold">Para a conta</ThemedText>
                <Controller
                  control={control}
                  name="counterparty_account_id"
                  render={({ field }) => (
                    <View style={styles.chipRow}>
                      {(accounts ?? []).map((account) => (
                        <Chip
                          key={account.id}
                          label={account.name}
                          selected={field.value === account.id}
                          onPress={() => field.onChange(account.id)}
                        />
                      ))}
                    </View>
                  )}
                />
                {errors.counterparty_account_id && (
                  <ThemedText type="small" themeColor="danger">
                    {errors.counterparty_account_id.message}
                  </ThemedText>
                )}
              </>
            )}

            <ThemedText type="smallBold">Descrição</ThemedText>
            <Controller
              control={control}
              name="description"
              render={({ field }) => (
                <TextInput
                  value={field.value ?? ''}
                  onChangeText={(text) => field.onChange(text || null)}
                  placeholder="Ex.: compras da semana"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                />
              )}
            />

            <ThemedText type="smallBold">Data</ThemedText>
            <View style={styles.chipRow}>
              <Chip
                label="Hoje"
                selected={occurredAt === today}
                onPress={() => setValue('occurred_at', today)}
              />
              <Chip
                label="Ontem"
                selected={occurredAt === yesterday}
                onPress={() => setValue('occurred_at', yesterday)}
              />
              <Controller
                control={control}
                name="occurred_at"
                render={({ field }) => (
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    placeholder="dd/mm/aaaa"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    maxLength={10}
                    style={[styles.dateInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                  />
                )}
              />
            </View>
            {errors.occurred_at && (
              <ThemedText type="small" themeColor="danger">
                {errors.occurred_at.message}
              </ThemedText>
            )}

            <Pressable
              onPress={onSubmit}
              disabled={save.isPending || createPlan.isPending}
              style={({ pressed }) => [
                styles.submit,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed || save.isPending || createPlan.isPending ? 0.7 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={styles.submitLabel}>
                {save.isPending || createPlan.isPending
                  ? 'Salvando…'
                  : editing
                    ? 'Salvar alterações'
                    : 'Adicionar'}
              </ThemedText>
            </Pressable>
            {(save.isError || createPlan.isError) && (
              <ThemedText type="small" themeColor="danger" style={styles.centered}>
                Não foi possível salvar. Tenta de novo.
              </ThemedText>
            )}

            {editing && (
              <Pressable onPress={onDelete} disabled={remove.isPending} style={styles.delete}>
                <ThemedText type="smallBold" themeColor="danger">
                  {remove.isPending ? 'Apagando…' : 'Apagar lançamento'}
                </ThemedText>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    width: '100%',
  },
  flex: {
    flex: 1,
  },
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  dateInput: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    minWidth: 110,
    textAlign: 'center',
  },
  submit: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  submitLabel: {
    color: '#fff',
    fontSize: 16,
  },
  delete: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
});
