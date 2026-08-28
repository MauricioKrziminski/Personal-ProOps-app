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
  ASSET_CLASSES,
  useArchiveAsset,
  useAssets,
  useFinancialHealth,
  useNetWorth,
  useNetWorthSeries,
  useSaveAsset,
  type Asset,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

function mesLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
}

export default function NetWorthScreen() {
  const theme = useTheme();
  const { data: patrimonio, isLoading, isError, refetch } = useNetWorth();
  const { data: serie } = useNetWorthSeries(12);
  const { data: saude } = useFinancialHealth();
  const { data: ativos } = useAssets();
  const save = useSaveAsset();
  const archive = useArchiveAsset();

  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Asset | null>(null);
  const [name, setName] = useState('');
  const [classe, setClasse] = useState<Asset['class']>('investment');
  const [valor, setValor] = useState(0);
  const [ehPassivo, setEhPassivo] = useState(false);

  const showForm = criando || editando !== null;
  const podeSalvar = name.trim().length >= 2 && valor >= 0;
  const maxSerie = Math.max(...(serie ?? []).map((p) => Math.abs(Number(p.net_cents))), 1);

  const fechar = () => {
    setCriando(false);
    setEditando(null);
    setName('');
    setClasse('investment');
    setValor(0);
    setEhPassivo(false);
  };

  const onSubmit = () => {
    if (!podeSalvar) return;
    save.mutate(
      {
        id: editando?.id,
        name: name.trim(),
        class: classe,
        is_liability: ehPassivo,
        current_value_cents: valor,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fechar();
        },
      },
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Patrimônio" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {patrimonio && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard style={styles.resumo}>
                <ThemedText type="small" themeColor="textSecondary">
                  Patrimônio líquido
                </ThemedText>
                <ThemedText
                  type="title"
                  style={{ color: Number(patrimonio.net_cents) < 0 ? theme.danger : theme.text }}>
                  {formatBRL(Number(patrimonio.net_cents))}
                </ThemedText>

                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    💵 Em conta
                  </ThemedText>
                  <ThemedText type="small">{formatBRL(Number(patrimonio.cash_cents))}</ThemedText>
                </View>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    📈 Investimentos
                  </ThemedText>
                  <ThemedText type="small">
                    {formatBRL(Number(patrimonio.investments_cents))}
                  </ThemedText>
                </View>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    🏠 Outros bens
                  </ThemedText>
                  <ThemedText type="small">
                    {formatBRL(Number(patrimonio.other_assets_cents))}
                  </ThemedText>
                </View>
                <View style={styles.linha}>
                  <ThemedText type="small" themeColor="textSecondary">
                    🧾 Dívidas e faturas
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    −{formatBRL(Number(patrimonio.liabilities_cents))}
                  </ThemedText>
                </View>
              </GlassCard>
            </Animated.View>
          )}

          {(serie ?? []).length > 1 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="smallBold">Evolução</ThemedText>
              <View style={styles.chart}>
                {(serie ?? []).map((ponto) => {
                  const valorPonto = Number(ponto.net_cents);
                  const altura = (Math.abs(valorPonto) / maxSerie) * 100;
                  return (
                    <View key={ponto.month} style={styles.chartCol}>
                      <View
                        style={[
                          styles.chartBar,
                          {
                            height: `${Math.max(altura, 2)}%`,
                            backgroundColor: valorPonto < 0 ? theme.danger : theme.tint,
                          },
                        ]}
                      />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.chartLabel}>
                        {mesLabel(ponto.month)}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                O histórico começa no dia em que você começou a usar — não dá para reconstruir o
                valor de um bem no passado sem inventar número.
              </ThemedText>
            </GlassCard>
          )}

          {saude && (
            <GlassCard style={styles.resumo}>
              <View style={styles.linha}>
                <ThemedText type="smallBold">Saúde financeira</ThemedText>
                <ThemedText
                  type="subtitle"
                  style={{
                    color:
                      saude.score >= 70
                        ? theme.success
                        : saude.score >= 40
                          ? theme.warning
                          : theme.danger,
                  }}>
                  {saude.score}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Poupa {saude.savings_rate}% do que ganha · reserva de {saude.months_of_reserve}{' '}
                meses · {saude.budget_adherence}% dos orçamentos respeitados · dívida em{' '}
                {saude.debt_ratio}% da renda.
              </ThemedText>
            </GlassCard>
          )}

          {(ativos ?? []).map((ativo, index) => (
            <Animated.View
              key={ativo.id}
              entering={FadeInDown.duration(400).delay(Math.min(index * 50, 400))}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setCriando(false);
                  setEditando(ativo);
                  setName(ativo.name);
                  setClasse(ativo.class);
                  setValor(ativo.current_value_cents);
                  setEhPassivo(ativo.is_liability);
                }}
                onLongPress={() =>
                  Alert.alert('Arquivar', `Arquivar "${ativo.name}"?`, [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Arquivar',
                      style: 'destructive',
                      onPress: () => archive.mutate(ativo.id),
                    },
                  ])
                }>
                <GlassCard style={styles.item}>
                  <View style={styles.itemTexto}>
                    <ThemedText type="smallBold">{ativo.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {ASSET_CLASSES.find((c) => c.value === ativo.class)?.label}
                      {ativo.is_liability ? ' · passivo' : ''}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="smallBold"
                    style={{ color: ativo.is_liability ? theme.danger : theme.text }}>
                    {ativo.is_liability ? '−' : ''}
                    {formatBRL(ativo.current_value_cents)}
                  </ThemedText>
                </GlassCard>
              </Pressable>
            </Animated.View>
          ))}

          {!isLoading && (ativos ?? []).length === 0 && !showForm && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🏦</ThemedText>
              <ThemedText type="smallBold">Nenhum bem cadastrado</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Cadastre investimentos, imóveis e veículos{'\n'}para ver seu patrimônio completo.
              </ThemedText>
            </GlassCard>
          )}

          {showForm ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">
                {editando ? `Atualizar “${editando.name}”` : 'Novo bem'}
              </ThemedText>
              {editando ? (
                <ThemedText type="small" themeColor="textSecondary">
                  O valor novo entra como marcação de hoje no histórico.
                </ThemedText>
              ) : (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Nome (ex.: Tesouro Selic)"
                  placeholderTextColor={theme.textSecondary}
                  autoFocus
                  style={[
                    styles.input,
                    { backgroundColor: theme.backgroundElement, color: theme.text },
                  ]}
                />
              )}
              {!editando && (
                <>
                  <View style={styles.chipRow}>
                    {ASSET_CLASSES.map((c) => (
                      <Chip
                        key={c.value}
                        label={c.label}
                        selected={classe === c.value}
                        onPress={() => setClasse(c.value)}
                      />
                    ))}
                  </View>
                  <Chip
                    label="É um passivo (dívida)"
                    selected={ehPassivo}
                    onPress={() => setEhPassivo((v) => !v)}
                  />
                </>
              )}
              <ThemedText type="smallBold">Valor atual</ThemedText>
              <MoneyInput valueCents={valor} onChangeCents={setValor} />
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
                  {save.isPending ? 'Salvando…' : editando ? 'Atualizar valor' : 'Cadastrar'}
                </ThemedText>
              </Pressable>
              <Pressable onPress={fechar} hitSlop={8} style={styles.cancel}>
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
                setCriando(true);
              }}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: theme.tint, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                ＋ Novo bem
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
  resumo: {
    gap: Spacing.one,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 110,
    gap: Spacing.one,
    marginVertical: Spacing.two,
  },
  chartCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.half,
  },
  chartBar: {
    width: '70%',
    borderRadius: Spacing.half,
  },
  chartLabel: {
    fontSize: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  itemTexto: {
    flex: 1,
    gap: Spacing.half,
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
