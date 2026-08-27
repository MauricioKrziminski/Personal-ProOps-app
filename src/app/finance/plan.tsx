import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ErrorCard, LoadingCard } from '@/components/error-card';
import { ScreenHeader } from '@/components/finance/screen-header';
import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  PLANS,
  useCancelSubscription,
  useInviteMember,
  useInvites,
  usePlanStatus,
  useRevokeInvite,
} from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';

/** 5551999998888 -> (51) 99999-8888 */
function telefoneBR(digitos: string): string {
  const d = digitos.replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return digitos;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const meio = resto.length === 9 ? resto.slice(0, 5) : resto.slice(0, 4);
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`;
}

export default function PlanScreen() {
  const theme = useTheme();
  const { data: plano, isLoading, isError, refetch } = usePlanStatus();
  const { data: convites } = useInvites();
  const convidar = useInviteMember();
  const revogar = useRevokeInvite();
  const cancelar = useCancelSubscription();

  const [telefone, setTelefone] = useState('');
  const podeConvidar =
    telefone.replace(/\D/g, '').length >= 10 &&
    Boolean(plano) &&
    plano!.members < plano!.max_members;

  const pendentes = (convites ?? []).filter((c) => c.status === 'pending');

  const confirmarCancelamento = () => {
    Alert.alert(
      'Cancelar assinatura',
      'Seu plano volta para o Free no fim do período. Nenhum dado é apagado — e dá para voltar quando quiser, aqui mesmo.',
      [
        { text: 'Continuar assinando', style: 'cancel' },
        {
          text: 'Cancelar assinatura',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            cancelar.mutate();
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Plano e família" />

          {isError && <ErrorCard onRetry={refetch} />}
          {isLoading && !isError && <LoadingCard />}

          {plano && (
            <Animated.View entering={FadeInDown.duration(400)}>
              <GlassCard style={styles.resumo}>
                <View style={styles.linha}>
                  <ThemedText type="smallBold">
                    Plano {PLANS.find((p) => p.value === plano.plan)?.label ?? plano.plan}
                  </ThemedText>
                  {plano.status === 'canceled' && (
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      cancelado
                    </ThemedText>
                  )}
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {plano.ai_messages_month} de {plano.max_ai_messages_month} mensagens usadas este
                  mês
                </ThemedText>
                <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
                  <View
                    style={[
                      styles.fill,
                      {
                        backgroundColor:
                          plano.ai_messages_month / plano.max_ai_messages_month >= 0.9
                            ? theme.danger
                            : theme.tint,
                        width: `${Math.min(
                          Math.max((plano.ai_messages_month / plano.max_ai_messages_month) * 100, 2),
                          100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {plano.members} de {plano.max_members}{' '}
                  {plano.max_members === 1 ? 'pessoa' : 'pessoas'} ·{' '}
                  {plano.can_import ? 'importação liberada' : 'sem importação de extrato'}
                </ThemedText>
              </GlassCard>
            </Animated.View>
          )}

          <GlassCard style={styles.resumo}>
            <ThemedText type="smallBold">Planos</ThemedText>
            {PLANS.map((p) => {
              const atual = plano?.plan === p.value;
              return (
                <View
                  key={p.value}
                  style={[
                    styles.planoRow,
                    {
                      backgroundColor: atual
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                    },
                  ]}>
                  <View style={styles.itemTexto}>
                    <ThemedText type="smallBold">
                      {p.label}
                      {atual ? ' · seu plano' : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {p.pitch}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold">{p.price}</ThemedText>
                </View>
              );
            })}
            <ThemedText type="small" themeColor="textSecondary">
              Ainda não dá para assinar por aqui — a cobrança está sendo ligada.
            </ThemedText>
          </GlassCard>

          <GlassCard style={styles.resumo}>
            <ThemedText type="smallBold">Convidar alguém</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              O convite é pelo telefone, o mesmo do WhatsApp. Quem entrar enxerga e lança no mesmo
              financeiro.
            </ThemedText>
            <TextInput
              value={telefone}
              onChangeText={setTelefone}
              placeholder="(51) 99999-8888"
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
            />
            <Pressable
              onPress={() =>
                convidar.mutate(
                  { phone: telefone, role: 'member' },
                  {
                    onSuccess: () => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      setTelefone('');
                    },
                  },
                )
              }
              disabled={!podeConvidar || convidar.isPending}
              style={({ pressed }) => [
                styles.submit,
                {
                  backgroundColor: theme.tint,
                  opacity: pressed || !podeConvidar || convidar.isPending ? 0.6 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={styles.buttonLabel}>
                {convidar.isPending ? 'Convidando…' : 'Convidar'}
              </ThemedText>
            </Pressable>
            {plano && plano.members >= plano.max_members && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                Seu plano já está no limite de pessoas. Suba para o Família para convidar mais.
              </ThemedText>
            )}
            {convidar.isError && (
              <ThemedText type="small" themeColor="danger" style={styles.centered}>
                Não deu para convidar (já convidou este número?).
              </ThemedText>
            )}
          </GlassCard>

          {pendentes.length > 0 && (
            <GlassCard style={styles.resumo}>
              <ThemedText type="smallBold">Convites pendentes</ThemedText>
              {pendentes.map((convite) => (
                <View key={convite.id} style={styles.linha}>
                  <ThemedText type="small">{telefoneBR(convite.phone)}</ThemedText>
                  <Pressable
                    hitSlop={8}
                    onPress={() => revogar.mutate(convite.id)}
                    style={({ pressed }) => [
                      styles.acao,
                      { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.6 : 1 },
                    ]}>
                    <ThemedText type="small" style={{ color: theme.danger }}>
                      revogar
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                O acesso entra sozinho quando a pessoa se cadastrar com esse número.
              </ThemedText>
            </GlassCard>
          )}

          {plano && plano.plan !== 'free' && plano.status !== 'canceled' && (
            <Pressable onPress={confirmarCancelamento} hitSlop={8} style={styles.cancel}>
              <ThemedText type="small" themeColor="textSecondary">
                Cancelar assinatura
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
    gap: Spacing.two,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  itemTexto: {
    flex: 1,
    gap: Spacing.half,
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
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  acao: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
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
    paddingVertical: Spacing.three,
  },
  centered: {
    textAlign: 'center',
  },
});
