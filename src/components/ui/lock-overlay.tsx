/**
 * A cortina de bloqueio — irmã do `AnimatedSplashOverlay`, acima de tudo e dentro dos providers.
 *
 * ⚠️ **Ela fica DEPOIS do `Stack.Protected` do `useSession`**: sem sessão não há o que trancar, e
 * a porta de entrada continua sendo o login. Esta trava protege quem já entrou.
 *
 * ⚠️ **Não há teclado aqui, e isso é o ponto.** Quem pede a senha é o SISTEMA, no prompt dele —
 * esta tela é a cortina que esconde o conteúdo enquanto isso, o objeto que conta em que ponto a
 * autenticação está, e o caminho de volta se a pessoa cancelar. A versão anterior desenhava um
 * teclado numérico de PIN próprio; ele saiu junto com a senha própria.
 *
 * ## A composição
 *
 * `Aurora` (o fundo vivo) → `Keyhole` (o disco de vidro com a marca) → a frase → a ação. Um
 * objeto, um verbo, e o resto é luz. A cortina inteira é **um** momento autoral: as massas de luz
 * abrem de dentro para fora enquanto o disco assenta na mola, e o texto entra depois, escalonado.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Aurora } from '@/components/lock/aurora';
import { Keyhole } from '@/components/lock/keyhole';
import { Motion, Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import { useTheme } from '@/hooks/use-theme';

/**
 * A saída: a cortina CRESCE e dissolve, e o app aparece por dentro dela.
 *
 * ⚠️ **É continuidade espacial, não enfeite** (design §5). Sem isto, destravar é um corte seco de
 * uma tela cheia para outra e o olho não liga as duas. 200 ms: `Motion.duration.exit` (140) é a
 * régua de um ELEMENTO saindo; uma tela inteira precisa de um fio a mais para o crescimento ser
 * lido como crescimento, e ainda fica abaixo do teto de saída do app.
 *
 * ⚠️ **Mora no escopo do módulo.** Um worklet recriado a cada render faz o Reanimated registrar
 * uma animação de saída diferente da que ele vai procurar no desmonte — e ela simplesmente não
 * roda, sem erro nenhum.
 */
function dissolver() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 200, easing: Motion.easing.out }),
      transform: [{ scale: withTiming(1.08, { duration: 220, easing: Motion.easing.out }) }],
    },
  };
}

/**
 * Casca de montagem: enquanto o app está aberto, `Cortina` nem existe.
 *
 * ⚠️ **É montagem, não `if` dentro do componente.** Com `if (!locked) return null` lá dentro, o
 * componente fica montado guardando estado velho, e limpar isso exigiria um `useEffect` com
 * `setState` síncrono — que o lint barra, e com razão: desmontar já faz esse trabalho. É também o
 * gancho da animação de saída: quem some é a `Cortina`, e o Reanimated a segura viva até
 * `dissolver` terminar.
 */
export function LockOverlay() {
  const { locked } = useLock();
  if (!locked) return null;
  return <Cortina />;
}

/**
 * A linha de apoio conta o ESTADO e diz o que fazer; o título fica parado (design §7:
 * identificador é estável, estado mora na linha de apoio).
 *
 * ⚠️ **Ela é a única coisa que ensina o gesto.** Com o botão fora, um disco com a marca dentro
 * não anuncia sozinho que é tocável — a frase é a affordance, e por isso ela usa o verbo
 * ("Toque") em vez de descrever o estado da trava.
 */
const FRASES = {
  trancado: (como: string) => `Toque para usar ${como}.`,
  autenticando: () => 'Confirmando…',
  falhou: (como: string) => `Não reconheci. Toque para tentar de novo com ${como}.`,
} as const;

function Cortina() {
  const { autenticar, comoAutentica, estado } = useLock();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  /*
    O prompt é chamado assim que a cortina aparece: pedir um toque a mais antes do Face ID é
    exatamente o atrito que faz a pessoa desligar a trava.

    ⚠️ **A guarda de reentrância mora no HOOK, não aqui** — `autenticar` recusa a segunda chamada
    enquanto a primeira está em voo. É o que torna este efeito seguro sob o StrictMode (que monta,
    desmonta e monta de novo) e sob um toque em "Desbloquear" com o prompt já aberto: dois
    `authenticateAsync` empilhados devolvem `system_cancel` no primeiro.
  */
  useEffect(() => {
    void autenticar();
  }, [autenticar]);

  return (
    <Animated.View
      exiting={dissolver}
      style={[
        styles.tudo,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + Space.xl,
          /*
            ⚠️ `Math.max`, não `insets.bottom +`: medido no emulador, o inset volta **0** com
            navegação por gestos e o botão encostava na barra do sistema.
          */
          paddingBottom: Math.max(insets.bottom, Space.xxl),
        },
      ]}
      accessibilityViewIsModal
    >
      <Aurora />

      <View style={styles.folga} />

      {/*
        O bloco é o único peso da tela, e fica no terço ÓTICO — as duas folgas não são iguais
        (2 em cima, 3 embaixo). Centro geométrico exato lê como baixo demais quando o objeto é
        redondo e o texto pende para baixo dele.
      */}
      <View style={styles.centro}>
        <Keyhole estado={estado} onPress={() => void autenticar()} />
        {/*
          O texto entra DEPOIS do disco: a cortina monta como uma cascata curta, não como quatro
          coisas aparecendo juntas.
        */}
        <Animated.View
          entering={FadeInDown.delay(140).duration(Motion.duration.slow)}
          style={styles.dizeres}>
          <ThemedText type="title" style={styles.centrado}>
            App bloqueado
          </ThemedText>
          {/*
            `key={estado}`: a troca de frase é um corte com fade, não um texto mudando debaixo do
            olho. Sem a chave, "Confirmando…" vira "Não reconheci" no meio de uma palavra.
          */}
          <Animated.View key={estado} entering={FadeIn.duration(Motion.duration.base)}>
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.centrado}>
              {FRASES[estado](comoAutentica)}
            </ThemedText>
          </Animated.View>
        </Animated.View>
      </View>

      <View style={styles.folgaBaixa} />
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
      chegavam na tela de trás. Uma trava que desenha mas não tranca é pior que nenhuma: ela
      promete o que não entrega.

      `elevation` é o que ordena de verdade no Android (o `react-native-screens` desenha em
      ViewGroup nativo); `zIndex` resolve o iOS. 900 fica ABAIXO do splash (1000), que precisa
      cobrir a abertura.
    */
    zIndex: 900,
    elevation: 900,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  folga: { flex: 2 },
  folgaBaixa: { flex: 3 },
  centro: { alignItems: 'center', gap: Space.xl },
  dizeres: { alignItems: 'center', gap: Space.xs, maxWidth: 320 },
  centrado: { textAlign: 'center' },
});
