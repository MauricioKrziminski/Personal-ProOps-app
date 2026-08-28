import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { PLANS, usePlanStatus } from '@/hooks/use-finance';
import { TRIAL_DAYS } from '@/lib/billing';
import { useTheme } from '@/hooks/use-theme';

/**
 * Assinar — "o que eu ganho pagando, e o que acontece se eu desistir?".
 *
 * **Nenhum preço mora nesta tela.** Preço varia por país, por promoção e por imposto, e o que
 * vale é o que a loja devolve no aparelho (`getOfferings()`). Enquanto `react-native-purchases`
 * não estiver instalado, o botão de compra fica desabilitado **com o motivo escrito** — botão que
 * não pode funcionar é pior que botão ausente, e preço escrito à mão é pior que os dois.
 *
 * Sem contagem regressiva, sem "oferta acaba hoje", sem preço riscado. O produto se posiciona
 * contra dark pattern de cobrança; a tela de cobrança é onde isso é verdade ou mentira.
 */

interface Motivo {
  titulo: string;
  linha: string;
}

const MOTIVOS: Record<string, Motivo> = {
  import: {
    titulo: 'Importar extrato é do Pro',
    linha: 'Traga o extrato do banco em OFX ou CSV e revise tudo de uma vez.',
  },
  ai_quota: {
    titulo: 'Sua cota de mensagens acabou',
    linha: 'Planos pagos ampliam quantas mensagens a IA entende por mês.',
  },
  members: {
    titulo: 'Convidar mais gente é do plano pago',
    linha: 'Mais pessoas no mesmo financeiro, cada lançamento guardando quem lançou.',
  },
  trial_ending: {
    titulo: 'Seu teste grátis está acabando',
    linha: 'Continue com o plano ou volte para o Free — nada é apagado nos dois casos.',
  },
  plan: {
    titulo: 'Escolha seu plano',
    linha: 'O Free continua funcionando. Os pagos abrem pessoas, IA e importação.',
  },
};

export default function PaywallScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ from?: string }>();
  const plano = usePlanStatus();
  const [escolhido, setEscolhido] = useState<'pro' | 'family'>('pro');

  const motivo = MOTIVOS[params.from ?? 'plan'] ?? MOTIVOS.plan;
  const pagos = PLANS.filter((p) => p.value !== 'free');
  const usadas = plano.data?.ai_messages_month ?? 0;
  const teto = plano.data?.max_ai_messages_month ?? 0;
  const nomeAtual = PLANS.find((p) => p.value === plano.data?.plan)?.label ?? plano.data?.plan ?? '';
  const naWeb = Platform.OS === 'web';

  return (
    <Screen grouped>
      <Stack.Screen options={{ title: 'Assinar' }} />

      <View style={styles.bloco}>
        <ThemedText type="subtitle">{motivo.titulo}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {motivo.linha}
        </ThemedText>
      </View>

      {plano.isLoading ? (
        <>
          <Skeleton height={148} radius={Radius.lg} />
          <Skeleton height={110} radius={Radius.md} />
          <Skeleton height={110} radius={Radius.md} />
        </>
      ) : null}

      {/* Falhar aqui não pode virar "você é Free". */}
      {plano.isError ? (
        <Section title="Seu plano">
          <Row
            title="Não deu para ler seu plano agora"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => plano.refetch()}
          />
        </Section>
      ) : null}

      {/* O único GlassCard da tela: os limites de verdade, do banco, não da propaganda. */}
      {plano.data ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <GlassCard style={styles.hero}>
            <ThemedText type="small" themeColor="textSecondary">
              Seu plano hoje
            </ThemedText>
            <ThemedText type="smallBold">{nomeAtual}</ThemedText>
            <ThemedText style={[Type.title2, tabular]}>
              {usadas} de {teto}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              mensagens da IA usadas este mês
            </ThemedText>
            <ProgressBar
              value={usadas}
              max={teto}
              tone={teto > 0 && usadas >= teto ? 'danger' : 'tint'}
            />
            <ThemedText type="small" themeColor="textSecondary" style={tabular}>
              {plano.data.members} de {plano.data.max_members}{' '}
              {plano.data.max_members === 1 ? 'pessoa' : 'pessoas'} ·{' '}
              {plano.data.can_import ? 'importação liberada' : 'importação bloqueada'}
            </ThemedText>
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* Dois planos, não três: o Free não é produto à venda, é o estado padrão. */}
      {pagos.map((opcao, index) => {
        const selecionado = escolhido === opcao.value;
        return (
          <Animated.View
            key={opcao.value}
            entering={FadeInDown.duration(Motion.duration.base).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap),
            )}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selecionado }}
              accessibilityLabel={`Plano ${opcao.label}: ${opcao.pitch}`}
              onPress={() => {
                Haptics.selectionAsync();
                setEscolhido(opcao.value as 'pro' | 'family');
              }}>
              <Card
                style={[
                  styles.opcao,
                  { borderColor: selecionado ? theme.tint : 'transparent' },
                ]}>
                <ThemedText type="smallBold">{opcao.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {opcao.pitch}
                </ThemedText>
                <ThemedText type="small" themeColor={selecionado ? 'tint' : 'textSecondary'}>
                  {selecionado ? 'Selecionado' : 'Toque para escolher'}
                </ThemedText>
              </Card>
            </Pressable>
          </Animated.View>
        );
      })}

      <View style={styles.bloco}>
        {naWeb ? (
          <ThemedText type="smallBold">Assinatura só pelo aplicativo</ThemedText>
        ) : (
          <Button
            label={`Começar ${TRIAL_DAYS} dias grátis`}
            icon="lock"
            disabled
            onPress={() => {}}
            block
          />
        )}
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          {naWeb
            ? 'A compra acontece dentro do app, na App Store ou na Google Play. Por aqui dá só para comparar.'
            : 'A compra pelas lojas ainda não está ligada neste app. Quando estiver, o preço aparece aqui vindo direto da App Store e da Google Play — é ele que vale, e ele muda por país e por promoção.'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          Cancelar é um toque, na própria loja, sem formulário e sem ligação. Cancelou, o plano
          volta para o Free no fim do período e nada é apagado.
        </ThemedText>
      </View>

      {plano.data ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rodape}>
          {plano.data.plan === 'free'
            ? `O Free continua funcionando: ${plano.data.max_members} ${plano.data.max_members === 1 ? 'pessoa' : 'pessoas'} e ${plano.data.max_ai_messages_month} mensagens por mês.`
            : 'O Free continua existindo como estado padrão — cancelar não apaga nada do que você já registrou.'}
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bloco: {
    gap: Space.md,
  },
  hero: {
    gap: Space.sm,
  },
  opcao: {
    gap: Space.xs,
    borderWidth: 2,
    borderCurve: 'continuous',
  },
  rodape: {
    ...Type.footnote,
  },
});
