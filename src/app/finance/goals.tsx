import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { MoneyInput } from '@/components/finance/money-input';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import { useArchiveGoal, useGoalDeposit, useGoals, useSaveGoal, type Goal } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

function GoalCard({ goal, index }: { goal: Goal; index: number }) {
  const theme = useTheme();
  const deposit = useGoalDeposit();
  const archive = useArchiveGoal();
  const [depositCents, setDepositCents] = useState(0);
  const [depositing, setDepositing] = useState(false);
  const pct = Math.min(100, Math.round((goal.saved_cents / goal.target_cents) * 100));
  const done = goal.saved_cents >= goal.target_cents;

  const confirmArchive = () => {
    Alert.alert('Arquivar meta', `Arquivar a meta "${goal.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Arquivar',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          archive.mutate(goal.id);
        },
      },
    ]);
  };

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
      <GlassCard style={styles.goalCard}>
        <Pressable onLongPress={confirmArchive}>
          <View style={styles.goalHeader}>
            <ThemedText type="smallBold">
              {done ? '🎉 ' : '🎯 '}
              {goal.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {pct}%
            </ThemedText>
          </View>
          <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: done ? theme.success : theme.tint, width: `${Math.max(pct, 3)}%` },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {formatBRL(goal.saved_cents)} de {formatBRL(goal.target_cents)}
            {goal.deadline ? ` · até ${formatDateBR(goal.deadline)}` : ''}
          </ThemedText>
        </Pressable>

        {depositing ? (
          <View style={styles.depositRow}>
            <View style={styles.depositInput}>
              <MoneyInput valueCents={depositCents} onChangeCents={setDepositCents} autoFocus />
            </View>
            <Pressable
              disabled={deposit.isPending || depositCents <= 0}
              hitSlop={8}
              onPress={() =>
                deposit.mutate(
                  { goal, amountCents: depositCents },
                  {
                    onSuccess: () => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setDepositing(false);
                      setDepositCents(0);
                    },
                  },
                )
              }
              style={[styles.smallButton, { backgroundColor: theme.tint, opacity: depositCents > 0 ? 1 : 0.5 }]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                OK
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              setDepositing(true);
            }}
            style={[styles.smallButton, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">＋ Aportar</ThemedText>
          </Pressable>
        )}
      </GlassCard>
    </Animated.View>
  );
}

export default function GoalsScreen() {
  const theme = useTheme();
  const { data: goals, isLoading, isError, refetch } = useGoals();
  const save = useSaveGoal();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [targetCents, setTargetCents] = useState(0);

  const onCreate = () => {
    if (!name.trim() || targetCents <= 0) return;
    save.mutate(
      { name: name.trim(), target_cents: targetCents, deadline: null },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setCreating(false);
          setName('');
          setTargetCents(0);
        },
      },
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Metas" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(goals ?? []).map((goal, index) => (
            <GoalCard key={goal.id} goal={goal} index={index} />
          ))}

          {!isLoading && !isError && (goals ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🎯</ThemedText>
              <ThemedText type="smallBold">Nenhuma meta ainda</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Crie aqui ou manda no WhatsApp:{'\n'}“quero juntar 3000 pra viagem até dezembro”
              </ThemedText>
            </GlassCard>
          )}

          {creating ? (
            <GlassCard style={styles.form}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome da meta (ex.: viagem)"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
              <MoneyInput valueCents={targetCents} onChangeCents={setTargetCents} />
              <Pressable
                onPress={onCreate}
                disabled={save.isPending || !name.trim() || targetCents <= 0}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: theme.tint,
                    opacity: pressed || save.isPending || !name.trim() || targetCents <= 0 ? 0.6 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {save.isPending ? 'Criando…' : 'Criar meta'}
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
                ＋ Nova meta
              </ThemedText>
            </Pressable>
          )}
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
  goalCard: {
    gap: Spacing.two,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  track: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: Spacing.one,
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
  depositRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  depositInput: {
    flex: 1,
  },
  smallButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
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
