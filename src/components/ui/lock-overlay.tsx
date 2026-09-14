/**
 * A tela de bloqueio — irmã do `AnimatedSplashOverlay`, acima de tudo e dentro dos providers.
 *
 * ⚠️ **Ela fica DEPOIS do `Stack.Protected` do `useSession`**: sem sessão não há o que trancar, e
 * a porta de entrada continua sendo o login. Esta trava protege quem já entrou.
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { useLock } from '@/hooks/use-lock';
import { esperaAgora, registrarErro, TAMANHO_PIN, zerarErros } from '@/lib/lock-secret';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'apagar'] as const;

/**
 * Casca de montagem: enquanto o app está aberto, `Tela` nem existe.
 *
 * ⚠️ **É montagem, não `if` dentro do componente.** Com `if (!locked) return null` o componente
 * fica montado guardando o PIN meio digitado e a contagem de erros, e limpar isso exigia um
 * `useEffect` com `setState` síncrono — que o lint barra, e com razão: desmontar já faz esse
 * trabalho, de graça e sem render em cascata.
 */
export function LockOverlay() {
  const { locked } = useLock();
  if (!locked) return null;
  return <Tela />;
}

function Tela() {
  const { mode, destravarComPin, tentarBiometria, biometriaDisponivel } = useLock();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [pin, setPin] = useState('');
  const [espera, setEspera] = useState(0);
  const [errou, setErrou] = useState(false);

  // A biometria é tentada assim que a tela aparece: pedir um toque a mais antes da digital é
  // exatamente o atrito que faz a pessoa desligar a trava.
  useEffect(() => {
    if (mode === 'biometric' && biometriaDisponivel) void tentarBiometria();
  }, [mode, biometriaDisponivel, tentarBiometria]);

  /*
    O contador precisa ANDAR na tela; sem o tique ele só mudaria ao tocar numa tecla. E ele roda
    sempre, não só depois de errar: a espera é PERSISTIDA, então reabrir o app durante a punição
    tem que continuar mostrando quanto falta — se ela sumisse da tela, um force-quit pareceria
    ter funcionado.

    ⚠️ `Date.now()` mora dentro de `esperaAgora()`, no módulo. No corpo do componente o React
    Compiler recusa ("impure function during render"), e com razão.
  */
  useEffect(() => {
    let vivo = true;
    const ler = () => void esperaAgora().then((s) => vivo && setEspera(s));
    ler();
    const t = setInterval(ler, 500);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  const bloqueado = espera > 0;

  /*
    ⚠️ **O valor digitado mora num `ref`, não no state — e isto é bug medido, não precaução.**
    Cada chamada de `digitar` fecha sobre o `pin` DAQUELE render. Digitando rápido (que é como se
    digita uma senha de 6 dígitos), vários toques caem no mesmo ciclo, todos leem a string velha e
    **os dígitos se perdem**: no emulador, seis toques seguidos deixaram os seis pontos vazios e
    `conferirPin` nunca chegou a ser chamado. Um toque por vez funcionava, que é exatamente o
    disfarce que faz esse defeito passar num teste manual devagar.
  */
  const digitado = useRef('');

  const digitar = async (t: string) => {
    if (bloqueado) return;
    if (t === 'apagar') {
      digitado.current = digitado.current.slice(0, -1);
      setPin(digitado.current);
      return;
    }
    setErrou(false);
    const novo = (digitado.current + t).slice(0, TAMANHO_PIN);
    digitado.current = novo;
    setPin(novo);
    if (novo.length < TAMANHO_PIN) return;
    digitado.current = '';

    if (await destravarComPin(novo)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await zerarErros();
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setErrou(true);
    setPin('');
    setEspera(await registrarErro());
  };

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={[
        styles.tudo,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + Space.xl,
          /*
            ⚠️ `Math.max`, não `insets.bottom +`: medido no emulador, o inset volta **0** com
            navegação por gestos e a fileira do "0" encostava na barra — o nó da tecla terminava
            em 2992 numa tela de 2992 px. A tecla mais usada do teclado não pode disputar espaço
            com o gesto de voltar.
          */
          paddingBottom: Math.max(insets.bottom, Space.xxl),
        },
      ]}
      accessibilityViewIsModal
    >
      <View style={styles.topo}>
        <Mark size={44} />
        <ThemedText type="title">App bloqueado</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {bloqueado
            ? `Muitas tentativas. Tente em ${espera}s.`
            : errou
              ? 'Senha incorreta.'
              : 'Digite sua senha de 6 dígitos'}
        </ThemedText>
      </View>

      <View style={styles.bolinhas}>
        {Array.from({ length: TAMANHO_PIN }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.bolinha,
              {
                borderColor: errou ? theme.danger : theme.separator,
                backgroundColor: i < pin.length ? (errou ? theme.danger : theme.text) : 'transparent',
              },
            ]}
          />
        ))}
      </View>

      {/*
        O vazio fica ENTRE o cabeçalho e o teclado, não embaixo dele: teclado no meio da tela,
        com metade da altura sobrando abaixo, obriga a esticar o polegar num gesto que a pessoa
        faz várias vezes por dia. Toda tela de bloqueio de sistema põe as teclas na parte baixa.
      */}
      <View style={styles.folga} />

      <View style={styles.teclado}>
        {TECLAS.map((t, i) =>
          t === '' ? (
            <View key={i} style={styles.tecla} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={t === 'apagar' ? 'Apagar' : t}
              disabled={bloqueado}
              style={({ pressed }) => [
                styles.tecla,
                {
                  backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                  opacity: bloqueado ? 0.4 : 1,
                },
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                void digitar(t);
              }}
            >
              {t === 'apagar' ? (
                <Icon name="delete.left" size="md" color="text" />
              ) : (
                <ThemedText type="title">{t}</ThemedText>
              )}
            </Pressable>
          )
        )}
      </View>

      {mode === 'biometric' && biometriaDisponivel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Usar biometria"
          style={styles.bio}
          onPress={() => void tentarBiometria()}
        >
          <Icon name={Platform.OS === 'ios' ? 'faceid' : 'touchid'} size="md" color="tint" />
          <ThemedText type="small" themeColor="tint">
            Usar biometria
          </ThemedText>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tudo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    /*
      ⚠️ **`zIndex` sozinho NÃO cobre a pilha nativa no Android, e a falha é a pior possível:
      o overlay aparece e o app continua CLICÁVEL por baixo.** Medido em 14/09/2026 — a árvore
      de acessibilidade trazia "App bloqueado" E "Bom dia, Gabriel" ao mesmo tempo, e os toques
      no teclado chegavam na tela de trás. Uma trava que desenha mas não tranca é pior que
      nenhuma: ela promete o que não entrega.

      `elevation` é o que ordena de verdade no Android (o `react-native-screens` desenha em
      ViewGroup nativo); `zIndex` resolve o iOS. 900 fica ABAIXO do splash (1000), que precisa
      cobrir a abertura.
    */
    zIndex: 900,
    elevation: 900,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Space.xl,
    paddingHorizontal: Space.lg,
  },
  folga: { flex: 1 },
  topo: { alignItems: 'center', gap: Space.sm },
  bolinhas: { flexDirection: 'row', gap: Space.md },
  bolinha: { width: 14, height: 14, borderRadius: Radius.pill, borderWidth: 1.5 },
  teclado: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 320,
    rowGap: Space.sm,
  },
  // 33% de 320 com folga: três colunas que não dependem de medir a tela.
  tecla: {
    width: '33%',
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  bio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    padding: Space.sm,
    marginBottom: Space.xl,
  },
});
