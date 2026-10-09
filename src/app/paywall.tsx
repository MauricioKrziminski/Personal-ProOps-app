import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Row, Section } from '@/components/ui/row';
import { Note } from '@/components/ui/note';
import { Screen } from '@/components/ui/screen';
import { TaskHeader } from '@/components/ui/task-header';
import { HeroLabel } from '@/components/ui/section-head';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { MaxContentWidth } from '@/constants/theme';
import { PLANS, usePlanStatus } from '@/hooks/use-finance';
import { useTheme } from '@/hooks/use-theme';
import { useApagarConta } from '@/hooks/use-apagar-conta';
import { useComprar, useOfertas } from '@/hooks/use-compras';
import { ToastDoModal, useToast } from '@/components/ui/toast';
import { confirmDestructive } from '@/lib/item-actions';
import { LOJA } from '@/lib/compras';
import { abrirLegal, URL_PRIVACIDADE, URL_TERMOS } from '@/lib/links-legais';
import { opcoesDaLoja, rotuloDoBotao, textoDeRenovacao } from '@/lib/oferta';
import { supabase } from '@/lib/supabase';

/**
 * Assinar — "o que eu ganho pagando, e o que acontece se eu desistir?".
 *
 * **Nenhum preço mora nesta tela.** Preço varia por país, por promoção e por imposto, e o que
 * vale é o que a loja devolve no aparelho (`getOfferings()`). Sem oferta (sem chave, sem módulo
 * nativo ou loja fora do ar) a tela diz "Assinatura indisponível" — preço escrito à mão é pior.
 *
 * Duas formas, um componente: modal fechável (`/paywall`) e **portão** (`/assinar`, sem ✕), que a
 * raiz mostra a quem nunca assinou. O portão leva Restaurar, Sair e Apagar conta (exigências das
 * lojas: quem não assina precisa conseguir ir embora).
 *
 * Sem contagem regressiva, sem "oferta acaba hoje", sem preço riscado. O produto se posiciona
 * contra dark pattern de cobrança; a tela de cobrança é onde isso é verdade ou mentira.
 */

interface Motivo {
  titulo: string;
  linha?: string;
}

const MOTIVOS: Record<string, Motivo> = {
  import: {
    titulo: 'Importar extrato é do Pro',
  },
  ai_quota: {
    titulo: 'Sua cota de mensagens acabou',
  },
  members: {
    titulo: 'Convidar mais gente é do plano pago',
  },
  trial_ending: {
    titulo: 'Seu teste grátis está acabando',
  },
  lapsed: {
    titulo: 'Sua assinatura acabou',
    linha: 'Seus dados continuam aqui para consulta. Assine para voltar a lançar.',
  },
  portao: {
    titulo: 'Assine para começar',
    linha: 'Teste grátis pela loja; cancele quando quiser.',
  },
  plan: {
    titulo: 'Escolha seu plano',
  },
};

/** Quem nunca assinou e entrou pelo portão vê a oferta de teste; quem já teve, não. */
export function TelaDeAssinatura({ portao = false }: { portao?: boolean }) {
  const theme = useTheme();
  const params = useLocalSearchParams<{ from?: string }>();
  const plano = usePlanStatus();
  const toast = useToast();
  const ofertas = useOfertas();
  const comprar = useComprar();
  const { apagar, apagando } = useApagarConta();
  const [escolhido, setEscolhido] = useState<string | null>(null);

  const motivo = MOTIVOS[portao ? 'portao' : (params.from ?? 'plan')] ?? MOTIVOS.plan;
  const assinante = plano.data?.access === 'subscriber';
  const usadas = plano.data?.ai_messages_month ?? 0;
  const teto = plano.data?.max_ai_messages_month ?? 0;
  const nomeAtual = PLANS.find((p) => p.value === plano.data?.plan)?.label ?? plano.data?.plan ?? '';
  const insets = useSafeAreaInsets();

  // Teste grátis só para quem nunca assinou: a loja é quem decide de verdade, a tela só não promete.
  const opcoes = opcoesDaLoja(ofertas.data ?? [], plano.data?.access === 'never');
  const atual = opcoes.find((o) => o.pacote.identifier === escolhido) ?? opcoes[0];
  const nomeDoPlano = (p: 'pro' | 'family') => PLANS.find((x) => x.value === p);
  const jaTem = assinante && atual?.plano === plano.data?.plan;
  const semOferta = ofertas.indisponivel || (ofertas.isSuccess && opcoes.length === 0);

  const resultado = (r: 'ativo' | 'aguardando' | 'cancelado') => {
    if (r === 'ativo') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast({ message: 'Assinatura ativa. Obrigado!', tone: 'success' });
      if (!portao) router.back();
    } else if (r === 'aguardando') {
      toast({ message: 'Estamos confirmando sua assinatura. Pode levar alguns instantes.', tone: 'info' });
    }
  };
  const aoFalhar = () => toast({ message: 'Não deu para concluir agora. Tente de novo.', tone: 'error' });
  const assinar = () => {
    if (!atual) return;
    comprar.mutate({ tipo: 'comprar', pacote: atual.pacote as never }, { onSuccess: resultado, onError: aoFalhar });
  };
  const restaurar = () => {
    if (semOferta && ofertas.indisponivel) {
      toast({ message: 'Compras indisponíveis neste aparelho.', tone: 'error' });
      return;
    }
    comprar.mutate({ tipo: 'restaurar' }, {
      onSuccess: (r) =>
        r === 'aguardando'
          ? toast({ message: 'Não encontramos uma assinatura para restaurar.', tone: 'info' })
          : resultado(r),
      onError: aoFalhar,
    });
  };
  const sair = () => {
    confirmDestructive('Sair da conta?', 'Sair', () => {
      void supabase.auth.signOut();
    });
  };
  const ocupado = comprar.isPending || apagando;

  return (
    /*
      ⚠️ **`scroll={false}` + `ScrollView` próprio, e isso é obrigatório aqui.** Com `scroll`, o
      `Screen` devolve o scroll como RAIZ da tela (não há slot irmão), então o `TaskHeader` rolaria
      para fora junto com o conteúdo — e paywall que não fecha é reprovação na App Review.
    */
    <Screen scroll={false} grouped>
      {portao ? null : <TaskHeader title="Assinar" onClose={() => router.back()} />}
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.corpo, { paddingBottom: insets.bottom + Space.xxl }, portao && { paddingTop: insets.top + Space.xl }]}
        showsVerticalScrollIndicator={false}>

      <View style={styles.bloco}>
        <ThemedText type="title">{motivo.titulo}</ThemedText>
        {motivo.linha ? (
          <ThemedText type="small" themeColor="textSecondary">
            {motivo.linha}
          </ThemedText>
        ) : null}
      </View>

      {plano.isLoading ? <Skeleton height={110} radius={Radius.lg} /> : null}

      {/* Falhar aqui não pode virar "você não assina". */}
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

      {/* O único destaque da tela: os limites de verdade, do banco, e só de quem assina. */}
      {plano.data && assinante ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)}>
          <Card style={styles.hero}>
            <HeroLabel>Seu plano hoje</HeroLabel>
            <ThemedText type="smallBold">{nomeAtual}</ThemedText>
            <HeroLabel>mensagens da IA usadas este mês</HeroLabel>
            <ThemedText style={[Type.largeTitle, tabular]}>
              {usadas} de {teto}
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
          </Card>
        </Animated.View>
      ) : null}

      {ofertas.isLoading ? (
        <>
          <Skeleton height={86} radius={Radius.md} />
          <Skeleton height={86} radius={Radius.md} />
        </>
      ) : null}

      {ofertas.isError ? (
        <Section title="Planos">
          <Row
            title="Não deu para carregar os planos"
            subtitle="Toque para tentar de novo"
            icon="exclamationmark.triangle"
            onPress={() => ofertas.refetch()}
          />
        </Section>
      ) : null}

      {semOferta ? (
        <Card style={styles.hero}>
          <ThemedText type="smallBold">Assinatura indisponível no momento</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tente de novo mais tarde.
          </ThemedText>
        </Card>
      ) : null}

      {opcoes.map((opcao, index) => {
        const selecionado = atual?.pacote.identifier === opcao.pacote.identifier;
        const info = nomeDoPlano(opcao.plano);
        return (
          <Animated.View
            key={opcao.pacote.identifier}
            entering={FadeInDown.duration(Motion.duration.base).delay(
              Math.min(index * Motion.stagger.step, Motion.stagger.cap),
            )}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: selecionado }}
              accessibilityLabel={`Plano ${info?.label}: ${opcao.preco} ${opcao.periodo ?? ''}`}
              onPress={() => {
                Haptics.selectionAsync();
                setEscolhido(opcao.pacote.identifier);
              }}>
              <Card style={[styles.opcao, { borderColor: selecionado ? theme.tint : 'transparent' }]}>
                <ThemedText type="smallBold">{info?.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {info?.pitch}
                </ThemedText>
                <ThemedText type="smallBold" style={tabular}>
                  {opcao.preco}
                  {opcao.periodo ? ` ${opcao.periodo}` : ''}
                </ThemedText>
              </Card>
            </Pressable>
          </Animated.View>
        );
      })}

      <View style={styles.bloco}>
        {opcoes.length > 0 ? (
          <>
            <Button
              label={jaTem ? 'Seu plano atual' : rotuloDoBotao(atual)}
              icon={jaTem ? 'checkmark.circle' : undefined}
              disabled={jaTem || ocupado}
              loading={comprar.isPending}
              onPress={assinar}
              block
            />
            <Note icon="clock">{textoDeRenovacao(atual, LOJA)}</Note>
          </>
        ) : null}
        <Button label="Restaurar compras" variant="secondary" disabled={ocupado} onPress={restaurar} block />
      </View>

      <View style={styles.legais}>
        <Button label="Termos de Uso" variant="ghost" size="sm" onPress={() => abrirLegal(URL_TERMOS)} />
        <Button label="Política de Privacidade" variant="ghost" size="sm" onPress={() => abrirLegal(URL_PRIVACIDADE)} />
      </View>

      {portao ? (
        <View style={styles.bloco}>
          <Button label="Sair da conta" variant="ghost" size="sm" disabled={ocupado} onPress={sair} />
          <Button label="Apagar conta" variant="ghost" size="sm" disabled={ocupado} onPress={apagar} />
        </View>
      ) : null}
      </ScrollView>
      {portao ? null : <ToastDoModal />}
    </Screen>
  );
}

export default function PaywallScreen() {
  return <TelaDeAssinatura />;
}

const styles = StyleSheet.create({
  // Replica o padding do `Screen`, que está em `scroll={false}` para o ✕ ficar fixo.
  corpo: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  bloco: {
    gap: Space.md,
  },
  hero: {
    gap: Space.md,
  },
  legais: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Space.md,
  },
  opcao: {
    gap: Space.xs,
    borderWidth: 2,
    borderCurve: 'continuous',
  },
});
