import { useState } from 'react';
import { Stack, router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { Motion, Space, Type, tabular } from '@/design/tokens';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { notifications } from '@/lib/push-module';

/**
 * Onboarding em três passos — nenhum deles é uma tela de features.
 *
 * O objetivo é levar a pessoa até a PRIMEIRA mensagem no WhatsApp, porque é lá que o produto
 * acontece; o app é a segunda superfície.
 *
 * **Sempre pulável.** E se gravar a conclusão falhar, a pessoa entra assim mesmo: reexibir o
 * onboarding uma vez é melhor do que prender alguém fora do app.
 */

/** Número do produto no WhatsApp. Sem ele, os atalhos viram texto morto. */
const WA_NUMBER = process.env.EXPO_PUBLIC_WA_NUMBER ?? '';

const SUGGESTIONS = [
  { icon: 'cart' as const, text: 'gastei 45 no mercado', hint: 'vira lançamento' },
  { icon: 'bell' as const, text: 'me lembra de pagar o aluguel dia 5', hint: 'vira lembrete' },
  { icon: 'note.text' as const, text: 'anotar: ligar pro dentista', hint: 'vira nota' },
];

export default function OnboardingScreen() {
  const { session } = useSession();
  const theme = useTheme();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [asking, setAsking] = useState(false);

  const phone = session?.user?.phone ? `+${session.user.phone}` : 'seu número';

  const finish = () => router.replace('/');

  const askPush = async () => {
    setAsking(true);
    try {
      // A pergunta de permissão vem DEPOIS da razão. O prompt do sistema aparece uma vez na vida
      // do app: gastá-lo sem contexto é gastar a única chance.
      // No Expo Go do Android não há a quem perguntar (ver `push-module.ts`): seguir sem prompt é
      // melhor que um erro que o usuário não pode resolver dali.
      const status = notifications ? (await notifications.requestPermissionsAsync()).status : null;
      if (status && status !== 'granted') {
        toast({
          message: 'Sem problema — dá para ativar depois no Perfil.',
          tone: 'info',
        });
      }
    } catch {
      toast({ message: 'Não deu para pedir a permissão agora.', tone: 'error' });
    } finally {
      setAsking(false);
      setStep(2);
    }
  };

  const openWhatsApp = (text: string) => {
    if (!WA_NUMBER) {
      toast({ message: 'O número do WhatsApp ainda não está configurado no app.', tone: 'error' });
      return;
    }
    Linking.openURL(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`).catch(() =>
      toast({ message: 'Não consegui abrir o WhatsApp.', tone: 'error' })
    );
  };

  return (
    <Screen contentStyle={styles.content}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.progress} accessibilityLabel={`Passo ${step + 1} de 3`}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: theme.text }, i === step && styles.dotActive]}
          />
        ))}
      </View>

      {step === 0 ? (
        <Animated.View entering={FadeIn.duration(Motion.duration.slow)} style={styles.step}>
          <Icon name="checkmark.seal.fill" size="xl" color="success" />
          <ThemedText type="title" style={styles.title}>
            Pronto, {phone} está vinculado.
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.body}>
            Tudo que você mandar nesse número vira nota, lembrete ou lançamento aqui.
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.phone, tabular]} selectable>
            {phone}
          </ThemedText>
          <Button label="Continuar" onPress={() => setStep(1)} block />
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.replace('/login')}>
            <ThemedText type="small" themeColor="textSecondary">
              Não é esse número?
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}

      {step === 1 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)} style={styles.step}>
          <Icon name="bell.badge" size="xl" color="tint" />
          <ThemedText type="title" style={styles.title}>
            Lembrete só serve se chegar.
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.body}>
            “Pagar aluguel” na hora certa. “Sua fatura fecha amanhã.”{'\n'}
            Sem isso, o app só existe quando você abre ele.
          </ThemedText>
          <Button
            label="Ativar notificações"
            onPress={askPush}
            loading={asking}
            icon="bell.fill"
            block
          />
          <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setStep(2)}>
            <ThemedText type="small" themeColor="textSecondary">
              Agora não
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}

      {step === 2 ? (
        <Animated.View entering={FadeInDown.duration(Motion.duration.slow)} style={styles.step}>
          <Icon name="paperplane.fill" size="xl" color="tint" />
          <ThemedText type="title" style={styles.title}>
            Manda a primeira mensagem.
          </ThemedText>
          <ThemedText type="default" themeColor="textSecondary" style={styles.body}>
            Toque numa sugestão — o WhatsApp abre com o texto pronto.
          </ThemedText>
          <Section>
            {SUGGESTIONS.map((s) => (
              <Row
                key={s.text}
                title={s.text}
                subtitle={s.hint}
                icon={s.icon}
                onPress={() => openWhatsApp(s.text)}
              />
            ))}
          </Section>
          <Button label="Já mandei, entrar no app" onPress={finish} block />
        </Animated.View>
      ) : null}

      <Pressable accessibilityRole="button" hitSlop={12} onPress={finish} style={styles.skip}>
        <ThemedText type="small" themeColor="textSecondary">
          Pular
        </ThemedText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /**
   * `flexGrow` para o passo ocupar a tela.
   *
   * Sem isso todo o onboarding se amontoava no terço de cima e sobravam ~60% de branco morto
   * embaixo — com o "Pular" flutuando no meio do nada, e não no rodapé onde a pessoa procura.
   */
  content: {
    gap: Space.xxl,
    paddingTop: Space.xxxl,
    flexGrow: 1,
  },
  progress: {
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.25,
  },
  dotActive: {
    opacity: 1,
    width: 18,
  },
  step: {
    gap: Space.lg,
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  body: {
    ...Type.callout,
    textAlign: 'center',
  },
  phone: {
    ...Type.title,
  },
  skip: {
    alignSelf: 'center',
    paddingVertical: Space.lg,
  },
});
