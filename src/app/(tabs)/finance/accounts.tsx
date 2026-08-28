import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { MoneyInput } from '@/components/finance/money-input';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL } from '@/hooks/use-items';
import {
  ACCOUNT_TYPES,
  useAccountBalances,
  useAccounts,
  useArchiveAccount,
  useSaveAccount,
  type Account,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

const TYPE_EMOJI: Record<string, string> = {
  checking: '🏦',
  savings: '🐷',
  credit_card: '💳',
  cash: '💵',
  investment: '📈',
  none: '❔',
};

export default function AccountsScreen() {
  const theme = useTheme();
  const { data: balances, isLoading, isError, refetch } = useAccountBalances();
  const { data: accounts } = useAccounts();
  const save = useSaveAccount();
  const archive = useArchiveAccount();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [initialCents, setInitialCents] = useState(0);
  // só valem para credit_card — o check do banco exige null nos outros tipos
  const [closingDay, setClosingDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [limitCents, setLimitCents] = useState(0);

  const isCard = type === 'credit_card';
  const diaValido = (v: string) => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31;
  const cartaoCompleto = !isCard || (diaValido(closingDay) && diaValido(dueDay));

  const total = (balances ?? []).reduce((sum, b) => sum + Number(b.balance_cents), 0);
  const showForm = creating || editing !== null;

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setName('');
    setType('checking');
    setInitialCents(0);
    setClosingDay('');
    setDueDay('');
    setLimitCents(0);
  };

  /** A linha sintética "Sem conta" (account_id null) não é editável. */
  const startEdit = (accountId: string | null) => {
    const account = (accounts ?? []).find((a) => a.id === accountId);
    if (!account) return;
    Haptics.selectionAsync();
    setCreating(false);
    setEditing(account);
    setName(account.name);
    setType(account.type);
    setInitialCents(account.initial_balance_cents);
    setClosingDay(account.closing_day ? String(account.closing_day) : '');
    setDueDay(account.due_day ? String(account.due_day) : '');
    setLimitCents(account.credit_limit_cents ?? 0);
  };

  const onSubmit = () => {
    if (!name.trim()) return;
    save.mutate(
      {
        id: editing?.id,
        name: name.trim(),
        type,
        initial_balance_cents: initialCents,
        closing_day: isCard ? Number(closingDay) : null,
        due_day: isCard ? Number(dueDay) : null,
        credit_limit_cents: isCard ? limitCents : null,
        payment_account_id: null,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          closeForm();
        },
      },
    );
  };

  const confirmArchive = (accountId: string | null) => {
    const account = (accounts ?? []).find((a) => a.id === accountId);
    if (!account) return;
    Alert.alert('Arquivar conta', `Arquivar "${account.name}"? Os lançamentos são mantidos.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Arquivar',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          archive.mutate(account.id);
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Contas" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(balances ?? []).length > 0 && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard style={styles.totalCard}>
                <ThemedText type="small" themeColor="textSecondary">
                  Saldo total
                </ThemedText>
                <ThemedText type="subtitle">{formatBRL(total)}</ThemedText>
              </GlassCard>
            </Animated.View>
          )}

          {(balances ?? []).map((balance, index) => (
            <Animated.View
              key={balance.account_id ?? 'none'}
              entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
              <Pressable
                onLongPress={() => confirmArchive(balance.account_id)}
                onPress={() => startEdit(balance.account_id)}>
                <GlassCard style={styles.accountRow}>
                  <ThemedText style={styles.accountEmoji}>
                    {TYPE_EMOJI[balance.type] ?? '❔'}
                  </ThemedText>
                  <View style={styles.accountBody}>
                    <ThemedText>{balance.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {ACCOUNT_TYPES.find((t) => t.value === balance.type)?.label ?? 'Sem conta'}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="smallBold"
                    style={{ color: Number(balance.balance_cents) < 0 ? theme.danger : theme.text }}>
                    {formatBRL(Number(balance.balance_cents))}
                  </ThemedText>
                </GlassCard>
              </Pressable>
            </Animated.View>
          ))}

          {!isLoading && !isError && (balances ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>💼</ThemedText>
              <ThemedText type="smallBold">Nenhuma conta cadastrada</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Cadastre suas contas e carteiras para{'\n'}acompanhar o saldo de cada uma.
              </ThemedText>
            </GlassCard>
          )}

          {showForm ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">
                {editing ? `Editando “${editing.name}”` : 'Nova conta'}
              </ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome (ex.: Nubank)"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
              <View style={styles.chipRow}>
                {ACCOUNT_TYPES.map((t) => (
                  <Chip
                    key={t.value}
                    label={t.label}
                    selected={type === t.value}
                    onPress={() => setType(t.value)}
                  />
                ))}
              </View>
              {isCard ? (
                <>
                  <ThemedText type="smallBold">Ciclo da fatura</ThemedText>
                  <View style={styles.diaRow}>
                    <View style={styles.diaCampo}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Fecha dia
                      </ThemedText>
                      <TextInput
                        value={closingDay}
                        onChangeText={(v) => setClosingDay(v.replace(/\D/g, '').slice(0, 2))}
                        placeholder="28"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        style={[
                          styles.input,
                          { backgroundColor: theme.backgroundElement, color: theme.text },
                        ]}
                      />
                    </View>
                    <View style={styles.diaCampo}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Vence dia
                      </ThemedText>
                      <TextInput
                        value={dueDay}
                        onChangeText={(v) => setDueDay(v.replace(/\D/g, '').slice(0, 2))}
                        placeholder="5"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="number-pad"
                        style={[
                          styles.input,
                          { backgroundColor: theme.backgroundElement, color: theme.text },
                        ]}
                      />
                    </View>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    Compra depois do fechamento cai na fatura do mês seguinte.
                  </ThemedText>
                  <ThemedText type="smallBold">Limite do cartão</ThemedText>
                  <MoneyInput valueCents={limitCents} onChangeCents={setLimitCents} />
                </>
              ) : (
                <>
                  <ThemedText type="smallBold">Saldo inicial</ThemedText>
                  <MoneyInput valueCents={initialCents} onChangeCents={setInitialCents} />
                </>
              )}
              <Pressable
                onPress={onSubmit}
                disabled={save.isPending || !name.trim() || !cartaoCompleto}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: theme.tint,
                    opacity:
                      pressed || save.isPending || !name.trim() || !cartaoCompleto ? 0.6 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {save.isPending ? 'Salvando…' : editing ? 'Salvar' : 'Criar conta'}
                </ThemedText>
              </Pressable>
              <Pressable onPress={closeForm} hitSlop={8} style={styles.cancel}>
                <ThemedText type="small" themeColor="textSecondary">
                  Cancelar
                </ThemedText>
              </Pressable>
              {save.isError && (
                <ThemedText type="small" themeColor="danger" style={styles.centered}>
                  Não deu para salvar (nome repetido?).
                </ThemedText>
              )}
            </GlassCard>
          ) : (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCreating(true);
              }}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                ＋ Nova conta
              </ThemedText>
            </Pressable>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
            Toque numa conta para editar. Segure para arquivar.
          </ThemedText>
        </ScrollView>
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
  scroll: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  totalCard: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  accountEmoji: {
    fontSize: 22,
  },
  accountBody: {
    flex: 1,
    gap: Spacing.half,
  },
  diaRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  diaCampo: {
    flex: 1,
    gap: Spacing.one,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyHint: {
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
});
