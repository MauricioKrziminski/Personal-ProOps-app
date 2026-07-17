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
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [initialCents, setInitialCents] = useState(0);

  const total = (balances ?? []).reduce((sum, b) => sum + Number(b.balance_cents), 0);

  const onCreate = () => {
    if (!name.trim()) return;
    save.mutate(
      { name: name.trim(), type, initial_balance_cents: initialCents },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setCreating(false);
          setName('');
          setInitialCents(0);
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
              <Pressable onLongPress={() => confirmArchive(balance.account_id)}>
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

          {creating ? (
            <GlassCard style={styles.form}>
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
              <ThemedText type="smallBold">Saldo inicial</ThemedText>
              <MoneyInput valueCents={initialCents} onChangeCents={setInitialCents} />
              <Pressable
                onPress={onCreate}
                disabled={save.isPending || !name.trim()}
                style={({ pressed }) => [
                  styles.submit,
                  { backgroundColor: theme.tint, opacity: pressed || save.isPending || !name.trim() ? 0.6 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {save.isPending ? 'Criando…' : 'Criar conta'}
                </ThemedText>
              </Pressable>
              {save.isError && (
                <ThemedText type="small" themeColor="danger" style={styles.centered}>
                  Não deu para criar (nome repetido?).
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
            Toque e segure uma conta para arquivá-la.
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
});
