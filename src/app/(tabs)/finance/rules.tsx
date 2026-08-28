import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { Chip } from '@/components/finance/chip';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { SUGGESTED_CATEGORIES } from '@/lib/categories';
import { useDeleteRule, useRules, useSaveRule } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

export default function RulesScreen() {
  const theme = useTheme();
  const { data: rules, isLoading, isError, refetch } = useRules();
  const save = useSaveRule();
  const remove = useDeleteRule();

  const [editando, setEditando] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const showForm = criando || editando !== null;
  const podeSalvar = pattern.trim().length >= 2 && Boolean(category);

  const fechar = () => {
    setCriando(false);
    setEditando(null);
    setPattern('');
    setCategory(null);
  };

  const onSubmit = () => {
    if (!podeSalvar) return;
    save.mutate(
      { id: editando ?? undefined, pattern: pattern.trim(), category: category! },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fechar();
        },
      },
    );
  };

  const confirmarRemocao = (id: string, texto: string) => {
    Alert.alert('Remover regra', `Parar de categorizar "${texto}" automaticamente?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          remove.mutate(id);
        },
      },
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Regras" />

          <GlassCard style={styles.explicacao}>
            <ThemedText type="small" themeColor="textSecondary">
              Regra sua sempre ganha da IA. Quando o texto do lançamento contém o gatilho, a
              categoria é aplicada — no WhatsApp e na importação de extrato.
              {'\n\n'}
              Você também pode criar por mensagem: “sempre que eu falar ifood, põe em restaurante”.
            </ThemedText>
          </GlassCard>

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(rules ?? []).map((rule, index) => (
            <Animated.View
              key={rule.id}
              entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setCriando(false);
                  setEditando(rule.id);
                  setPattern(rule.pattern);
                  setCategory(rule.category);
                }}
                onLongPress={() => confirmarRemocao(rule.id, rule.pattern)}>
                <GlassCard style={styles.rule}>
                  <View style={styles.ruleLinha}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.rulePattern}>
                      {rule.pattern}
                    </ThemedText>
                    <ThemedText type="small">→ {rule.category ?? 'sem categoria'}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {rule.hits > 0 ? `aplicada ${rule.hits}x` : 'ainda não pegou nenhum lançamento'}
                    {rule.source === 'learned' ? ' · aprendida' : ''}
                  </ThemedText>
                </GlassCard>
              </Pressable>
            </Animated.View>
          ))}

          {!isLoading && !isError && (rules ?? []).length === 0 && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>📌</ThemedText>
              <ThemedText type="smallBold">Nenhuma regra ainda</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Crie uma para o que a IA sempre erra.{'\n'}
                Ex.: “posto” → transporte.
              </ThemedText>
            </GlassCard>
          )}

          {showForm ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">
                {editando ? 'Editando regra' : 'Nova regra'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Quando o lançamento contiver
              </ThemedText>
              <TextInput
                value={pattern}
                onChangeText={setPattern}
                placeholder="ex.: ifood"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoFocus
                style={[
                  styles.input,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
              <ThemedText type="small" themeColor="textSecondary">
                categorizar como
              </ThemedText>
              <View style={styles.chipRow}>
                {SUGGESTED_CATEGORIES.map((cat) => (
                  <Chip
                    key={cat}
                    label={cat}
                    selected={category === cat}
                    onPress={() => setCategory(category === cat ? null : cat)}
                  />
                ))}
              </View>
              <Pressable
                onPress={onSubmit}
                disabled={!podeSalvar || save.isPending}
                style={({ pressed }) => [
                  styles.submit,
                  {
                    backgroundColor: theme.tint,
                    opacity: pressed || !podeSalvar || save.isPending ? 0.6 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.buttonLabel}>
                  {save.isPending ? 'Salvando…' : 'Salvar regra'}
                </ThemedText>
              </Pressable>
              <Pressable onPress={fechar} hitSlop={8} style={styles.cancel}>
                <ThemedText type="small" themeColor="textSecondary">
                  Cancelar
                </ThemedText>
              </Pressable>
              {save.isError && (
                <ThemedText type="small" themeColor="danger" style={styles.centered}>
                  Não deu para salvar (regra repetida?).
                </ThemedText>
              )}
            </GlassCard>
          ) : (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCriando(true);
              }}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                ＋ Nova regra
              </ThemedText>
            </Pressable>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
            Toque para editar. Segure para remover.
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
  explicacao: {
    gap: Spacing.two,
  },
  rule: {
    gap: Spacing.half,
  },
  ruleLinha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  rulePattern: {
    flex: 1,
  },
  form: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  submit: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#fff',
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  centered: {
    textAlign: 'center',
  },
});
