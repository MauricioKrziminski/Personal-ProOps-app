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
import { formatBRL, formatDateBR } from '@/hooks/use-items';
import {
  DEBT_KINDS,
  useArchiveDebt,
  useDebtSchedule,
  useDebts,
  usePayDebtInstallment,
  usePayoffStrategy,
  useSaveDebt,
  type Debt,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** 0.0199 -> "1,99% a.m." */
function taxaLabel(fracao: number): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.m.`;
}

/** "1,99" -> 0.0199. Aceita vírgula, que é como o brasileiro digita. */
function parseTaxa(texto: string): number {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n / 100 : 0;
}

function DebtDetail({ debt }: { debt: Debt }) {
  const theme = useTheme();
  const { data: schedule } = useDebtSchedule(debt.id);
  const pagar = usePayDebtInstallment();

  const proxima = schedule?.[0];
  const jurosTotais = (schedule ?? []).reduce((soma, p) => soma + Number(p.interest_cents), 0);

  return (
    <View style={styles.detalhe}>
      {proxima && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Próxima parcela: {formatBRL(Number(proxima.payment_cents))} em{' '}
            {formatDateBR(proxima.due_date)} — desses,{' '}
            <ThemedText type="small" style={{ color: theme.danger }}>
              {formatBRL(Number(proxima.interest_cents))} são juros
            </ThemedText>
            .
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Faltam {schedule?.length} parcelas · {formatBRL(jurosTotais)} de juros até quitar.
          </ThemedText>
          <Pressable
            onPress={() =>
              Alert.alert(
                'Pagar parcela',
                `Registrar ${formatBRL(Number(proxima.payment_cents))} pagos?`,
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Paguei',
                    onPress: () => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      pagar.mutate({
                        debtId: debt.id,
                        amountCents: Number(proxima.payment_cents),
                      });
                    },
                  },
                ],
              )
            }
            disabled={pagar.isPending}
            style={({ pressed }) => [
              styles.acao,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
            ]}>
            <ThemedText type="small">
              {pagar.isPending ? 'Registrando…' : 'Paguei esta parcela'}
            </ThemedText>
          </Pressable>
        </>
      )}
      {!proxima && (
        <ThemedText type="small" themeColor="textSecondary">
          Sem parcelas em aberto. Informe o número de parcelas para ver a amortização.
        </ThemedText>
      )}
    </View>
  );
}

export default function DebtsScreen() {
  const theme = useTheme();
  const { data: debts, isLoading, isError, refetch } = useDebts();
  const [estrategia, setEstrategia] = useState<'avalanche' | 'snowball'>('avalanche');
  const { data: ordem } = usePayoffStrategy(estrategia);
  const save = useSaveDebt();
  const archive = useArchiveDebt();

  const [aberta, setAberta] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Debt['kind']>('loan');
  const [remaining, setRemaining] = useState(0);
  const [taxa, setTaxa] = useState('');
  const [parcelas, setParcelas] = useState('');
  const [diaVencimento, setDiaVencimento] = useState('');

  const totalDevido = (debts ?? []).reduce((soma, d) => soma + Number(d.remaining_cents), 0);
  const podeSalvar = name.trim().length >= 2 && remaining > 0;

  const fechar = () => {
    setCriando(false);
    setName('');
    setKind('loan');
    setRemaining(0);
    setTaxa('');
    setParcelas('');
    setDiaVencimento('');
  };

  const onSubmit = () => {
    if (!podeSalvar) return;
    save.mutate(
      {
        name: name.trim(),
        kind,
        principal_cents: remaining,
        remaining_cents: remaining,
        interest_rate_monthly: parseTaxa(taxa),
        installments: parcelas ? Number(parcelas) : null,
        due_day: diaVencimento ? Number(diaVencimento) : null,
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
          <ScreenHeader title="Dívidas" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {(debts ?? []).length > 0 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="small" themeColor="textSecondary">
                Total devido
              </ThemedText>
              <ThemedText type="subtitle" style={{ color: theme.danger }}>
                {formatBRL(totalDevido)}
              </ThemedText>
              <ThemedText type="smallBold">Por onde começar</ThemedText>
              <View style={styles.chipRow}>
                <Chip
                  label="Mais juros"
                  selected={estrategia === 'avalanche'}
                  onPress={() => setEstrategia('avalanche')}
                />
                <Chip
                  label="Menor saldo"
                  selected={estrategia === 'snowball'}
                  onPress={() => setEstrategia('snowball')}
                />
              </View>
              {(ordem ?? []).map((linha) => (
                <ThemedText key={linha.debt_id} type="small" themeColor="textSecondary">
                  {linha.priority}. {linha.name} — {formatBRL(Number(linha.remaining_cents))} a{' '}
                  {taxaLabel(Number(linha.interest_rate_monthly))}
                  {linha.total_interest_cents > 0
                    ? ` (${formatBRL(Number(linha.total_interest_cents))} de juros)`
                    : ''}
                </ThemedText>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                {estrategia === 'avalanche'
                  ? 'Atacar a de maior juros paga menos no total.'
                  : 'Quitar a menor primeiro dá impulso — você vê dívida sumindo antes.'}
              </ThemedText>
            </GlassCard>
          )}

          {(debts ?? []).map((debt, index) => {
            const pago = Number(debt.principal_cents) - Number(debt.remaining_cents);
            const pct =
              debt.principal_cents > 0
                ? Math.round((pago / Number(debt.principal_cents)) * 100)
                : 0;
            return (
              <Animated.View
                key={debt.id}
                entering={FadeInDown.duration(400).delay(Math.min(index * 60, 400))}>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setAberta(aberta === debt.id ? null : debt.id);
                  }}
                  onLongPress={() =>
                    Alert.alert('Arquivar dívida', `Arquivar "${debt.name}"?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Arquivar',
                        style: 'destructive',
                        onPress: () => archive.mutate(debt.id),
                      },
                    ])
                  }>
                  <GlassCard style={styles.debtCard}>
                    <View style={styles.linha}>
                      <ThemedText type="smallBold">{debt.name}</ThemedText>
                      <ThemedText type="smallBold" style={{ color: theme.danger }}>
                        {formatBRL(Number(debt.remaining_cents))}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {DEBT_KINDS.find((k) => k.value === debt.kind)?.label}
                      {Number(debt.interest_rate_monthly) > 0
                        ? ` · ${taxaLabel(Number(debt.interest_rate_monthly))}`
                        : ' · sem juros'}
                      {debt.installments
                        ? ` · ${debt.installments_paid}/${debt.installments} pagas`
                        : ''}
                    </ThemedText>
                    <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                      <View
                        style={[
                          styles.fill,
                          { backgroundColor: theme.success, width: `${Math.min(Math.max(pct, 2), 100)}%` },
                        ]}
                      />
                    </View>
                    {aberta === debt.id && <DebtDetail debt={debt} />}
                  </GlassCard>
                </Pressable>
              </Animated.View>
            );
          })}

          {!isLoading && !isError && (debts ?? []).length === 0 && !criando && (
            <GlassCard style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🧾</ThemedText>
              <ThemedText type="smallBold">Nenhuma dívida cadastrada</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Cadastre empréstimos e financiamentos{'\n'}para ver quanto é juro e por onde começar.
              </ThemedText>
            </GlassCard>
          )}

          {criando ? (
            <GlassCard style={styles.form}>
              <ThemedText type="smallBold">Nova dívida</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Nome (ex.: Empréstimo Banco X)"
                placeholderTextColor={theme.textSecondary}
                autoFocus
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
              <View style={styles.chipRow}>
                {DEBT_KINDS.map((k) => (
                  <Chip
                    key={k.value}
                    label={k.label}
                    selected={kind === k.value}
                    onPress={() => setKind(k.value)}
                  />
                ))}
              </View>
              <ThemedText type="smallBold">Saldo devedor hoje</ThemedText>
              <MoneyInput valueCents={remaining} onChangeCents={setRemaining} />
              <View style={styles.duasColunas}>
                <View style={styles.coluna}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Juros ao mês (%)
                  </ThemedText>
                  <TextInput
                    value={taxa}
                    onChangeText={setTaxa}
                    placeholder="1,99"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                  />
                </View>
                <View style={styles.coluna}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Parcelas restantes
                  </ThemedText>
                  <TextInput
                    value={parcelas}
                    onChangeText={(v) => setParcelas(v.replace(/\D/g, '').slice(0, 3))}
                    placeholder="12"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                  />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Dia do vencimento
              </ThemedText>
              <TextInput
                value={diaVencimento}
                onChangeText={(v) => setDiaVencimento(v.replace(/\D/g, '').slice(0, 2))}
                placeholder="10"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
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
                  {save.isPending ? 'Salvando…' : 'Salvar dívida'}
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
                ＋ Nova dívida
              </ThemedText>
            </Pressable>
          )}

          {(debts ?? []).length > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              Toque para ver a amortização. Segure para arquivar.
            </ThemedText>
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
  debtCard: {
    gap: Spacing.one,
  },
  detalhe: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  duasColunas: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  coluna: {
    flex: 1,
    gap: Spacing.one,
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
  acao: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
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
