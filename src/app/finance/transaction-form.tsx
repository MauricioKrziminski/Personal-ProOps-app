import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { ScreenHeader } from '@/components/finance/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  SUGGESTED_CATEGORIES,
  useAccounts,
  useDeleteTransaction,
  useSaveTransaction,
  useTransactions,
  type TransactionKind,
} from '@/hooks/use-finance';
import { localISODate } from '@/hooks/use-items';
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
    occurred_at: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Data em dd/mm/aaaa')
      .refine((value) => {
        const [d, m, y] = value.split('/').map(Number);
        const date = new Date(y, m - 1, d);
        return date.getDate() === d && date.getMonth() === m - 1;
      }, 'Data inválida'),
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
  // Edição: a transação vem da lista do mês já em cache (mesma queryKey).
  const { data: monthTx } = useTransactions({
    month: params.month ?? localISODate().slice(0, 7),
  });
  const editing = params.id ? monthTx?.find((t) => t.id === params.id) : undefined;

  const save = useSaveTransaction();
  const remove = useDeleteTransaction();

  const { control, handleSubmit, watch, setValue, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'expense',
      amount_cents: 0,
      category: null,
      description: null,
      account_id: null,
      counterparty_account_id: null,
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
        occurred_at: toBR(editing.occurred_at),
      });
    }
  }, [editing, reset]);

  const kind = watch('kind');
  const errors = formState.errors;

  const onSubmit = handleSubmit((values) => {
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
            <ScreenHeader title={editing ? 'Editar lançamento' : 'Novo lançamento'} />

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
                selected={watch('occurred_at') === toBR(localISODate())}
                onPress={() => setValue('occurred_at', toBR(localISODate()))}
              />
              <Chip
                label="Ontem"
                selected={
                  watch('occurred_at') === toBR(localISODate(new Date(Date.now() - 86_400_000)))
                }
                onPress={() =>
                  setValue('occurred_at', toBR(localISODate(new Date(Date.now() - 86_400_000))))
                }
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
              disabled={save.isPending}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed || save.isPending ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.submitLabel}>
                {save.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar'}
              </ThemedText>
            </Pressable>
            {save.isError && (
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
