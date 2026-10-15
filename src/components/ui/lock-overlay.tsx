/**
 * A cortina de bloqueio — abaixo da cortina de sessão (900 < 1000), acima de todo o resto.
 *
 * ⚠️ **Ela fica DEPOIS do `Stack.Protected` do `useSession`**: sem sessão não há o que trancar, e
 * a porta de entrada continua sendo o login. Esta trava protege quem já entrou.
 *
 * ⚠️ **Não há teclado aqui, e isso é o ponto.** Quem pede a senha é o SISTEMA, no prompt dele —
 * esta tela é a cortina que esconde o conteúdo enquanto isso, o objeto que conta em que ponto a
 * autenticação está, e o caminho de volta se a pessoa cancelar.
 *
 * ## O desenho
 *
 * Tinta nos dois temas — a mesma da abertura — e a MARCA parada no centro, no mesmo lugar em
 * que a abertura termina (15/10/2026, *"não tá demorando muito isso?"*: eram "App bloqueado",
 * "Confirmando…", a logo se construindo de novo e só então a onda — ~3 s depois da senha). Enquanto
 * o prompt do sistema está aberto a tela é só a marca; aceita a senha, a tinta sobe NA HORA levando
 * a marca, sem reconstruí-la. O painel com "App bloqueado" (a marca num círculo, alvo do toque)
 * só aparece quando há o que fazer: a tentativa falhou ou foi cancelada. Na falha o círculo dá um
 * tranco e ganha um anel vermelho.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';

import { MarcaSeConstruindo } from '@/components/motion/marca-se-construindo';
import { useCortinaAberta, useCortinaSaindo } from '@/components/motion/session-curtain';
import { WaveCurtain } from '@/components/motion/wave-curtain';
import { ThemedText } from '@/components/themed-text';
import { Mark } from '@/components/ui/mark';
import { Motion, Radius, Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import { useTheme } from '@/hooks/use-theme';
import { marcarTravaNaTela } from '@/lib/trava-na-tela';

type EstadoDaTrava = ReturnType<typeof useLock>['estado'];

/** Diâmetro do círculo da marca: três vezes o alvo mínimo, sem virar herói. */
const DISCO = 112;
const MARCA = 48;

/**
 * Casca de montagem. A trava fica montada enquanto está trancada E enquanto sai — a onda de
 * saída precisa da cortina viva. Montar é ajuste de estado no render (padrão do React), não
 * efeito: o lint barra `setState` síncrono em `useEffect`, e com razão.
 */
export function LockOverlay() {
  const { locked, velado } = useLock();
  const [montada, setMontada] = useState(locked);
  if (locked && !montada) setMontada(true);
  const aoSair = useCallback(() => setMontada(false), []);
  const conteudo = montada ? <Cortina saindo={!locked} onSaiu={aoSair} /> : velado ? <Veu /> : null;
  const cobre = conteudo !== null;
  useEffect(() => {
    marcarTravaNaTela(cobre);
    return () => marcarTravaNaTela(false);
  }, [cobre]);
  // Véu e cortina dividem UMA casca: trocar um pelo outro não fecha e reabre a janela.
  return conteudo ? <JanelaDaTrava>{conteudo}</JanelaDaTrava> : null;
}

const TODAS_AS_ORIENTACOES = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'] as const;

/**
 * Formulário modal e folha são janelas nativas ACIMA da raiz: desenhada só na raiz, a trava
 * ficava por baixo do lançamento aberto para editar (05/10/2026, *"o modal fica por cima da tela
 * de bloqueio do app"*). Com o app já revelado ela mesma vira janela (`Modal`; no iOS a camada da
 * `UIWindow`), que o sistema
 * empilha por cima de tudo que estiver aberto. Na abertura a cortina da marca cobre a tela e não
 * há modal: ali a trava segue na raiz, por baixo da cortina (900 < 1000), como sempre foi.
 * A escolha é feita ao montar e não muda enquanto a trava existe — trocar de casca remontaria.
 */
function JanelaDaTrava({ children }: { children: ReactNode }) {
  const appRevelado = useCortinaAberta();
  const [emJanela] = useState(appRevelado);
  // O teclado é outra janela, acima de qualquer uma: aberto, ele digitaria no formulário escondido.
  useEffect(() => {
    if (emJanela) Keyboard.dismiss();
  }, [emJanela]);
  if (!emJanela) return <>{children}</>;
  // No iOS o `Modal` é apresentado pelo controlador da raiz, que já está apresentando o formulário:
  // a apresentação falha em silêncio e a trava não aparece (visto no iPhone, 05/10/2026). A
  // `FullWindowOverlay` entra direto na `UIWindow`, acima de tudo que já foi apresentado.
  if (Platform.OS === 'ios') {
    return <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{children}</FullWindowOverlay>;
  }
  return (
    <Modal
      visible
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      supportedOrientations={[...TODAS_AS_ORIENTACOES]}
      // Voltar do Android não destrava: a saída é autenticar.
      onRequestClose={() => {}}>
      {children}
    </Modal>
  );
}

/**
 * A tinta lisa de quando o app saiu da frente (`velado`). Trancando na volta, a cortina monta no
 * mesmo render e nasce coberta, então o véu some por baixo dela; dentro da espera, ele esmaece.
 */
function Veu() {
  const theme = useTheme();
  return (
    <Animated.View
      exiting={FadeOut.duration(Motion.duration.base)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.veu, { backgroundColor: theme.curtain }]}
    />
  );
}

/**
 * A frase conta o ESTADO e diz o que fazer; o título fica parado (design §7: identificador é
 * estável). Ela é a única coisa que ensina o gesto — por isso o verbo "Toque".
 */
const FRASES = {
  trancado: (como: string) => `Toque para usar ${como}.`,
  autenticando: () => 'Confirmando…',
  falhou: (como: string) => `Não reconheci. Toque para tentar de novo com ${como}.`,
} as const;

function Cortina({ saindo, onSaiu }: { saindo: boolean; onSaiu: () => void }) {
  const { autenticar, comoAutentica, estado } = useLock();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduzido = useReducedMotion();
  const progresso = useSharedValue(0);
  /** A marca já desenhada (o fim da construção da abertura): ela não se constrói de novo aqui. */
  const inteira = useSharedValue(1);
  /** O disco e a frase saem (0 → 1) quando a senha é aceita depois de uma falha. */
  const painelSai = useSharedValue(0);
  const cortinaSaindo = useCortinaSaindo();

  /*
    Painel só depois de uma tentativa que não abriu: antes dela (e durante o prompt) a tela é a
    marca. Ajuste de estado no render, como a casca acima. Saindo, o painel fica como estava — é
    ele (ou a marca) que sai com a tinta —, e uma nova trava começa sem painel.
  */
  const [jaTentou, setJaTentou] = useState(false);
  const [painel, setPainel] = useState(false);
  const [saindoAntes, setSaindoAntes] = useState(saindo);
  if (saindoAntes !== saindo) {
    setSaindoAntes(saindo);
    if (!saindo) {
      setJaTentou(false);
      setPainel(false);
    }
  }
  if (!saindo && estado === 'autenticando' && !jaTentou) setJaTentou(true);
  // Uma vez na tela, o painel fica até destravar: tentar de novo pelo disco é ele que conta.
  const pedePainel = !saindo && (estado === 'falhou' || (jaTentou && estado === 'trancado'));
  if (pedePainel && !painel) setPainel(true);

  /*
    O prompt é pedido assim que a cortina aparece. A guarda de reentrância mora no HOOK
    (`autenticar` recusa a segunda chamada em voo) — é o que torna isto seguro sob o StrictMode.
  */
  useEffect(() => {
    void autenticar();
  }, [autenticar]);

  useEffect(() => {
    if (!saindo) {
      cancelAnimation(progresso);
      cancelAnimation(painelSai);
      progresso.set(0);
      painelSai.set(0);
      return;
    }
    /*
      Destravou com a abertura ainda cobrindo (a senha pedida sobre a marca): a trava sai na hora,
      por baixo da tinta, e quem conta a passagem é a abertura subindo direto no app.
    */
    if (!cortinaSaindo) {
      onSaiu();
      return;
    }
    /*
      Senha aceita: a tinta sobe na hora, levando a marca (15/10/2026 — a marca se reconstruindo
      depois da senha, pedida em 06/10/2026, somava ~1,8 s a toda volta ao app). Se o painel
      estava na tela (uma falha antes), ele sai primeiro, para disco e onda não se sobreporem.
    */
    const duracao = reduzido ? Motion.duration.base : Motion.curtain.duration;
    const espera = painel ? Motion.duration.exit : 0;
    let vigente = true;
    const concluir = () => { if (vigente) onSaiu(); };
    if (painel) painelSai.set(withTiming(1, { duration: espera }));
    progresso.set(
      withDelay(
        espera,
        withTiming(1, { duration: duracao, easing: Easing.linear }, (fim) => {
          'worklet';
          if (fim) scheduleOnRN(concluir);
        })
      )
    );
    // Se o callback da animação não vier, a trava sai do mesmo jeito: modal preso é pior que corte.
    const teto = setTimeout(concluir, espera + duracao + 400);
    return () => {
      vigente = false;
      clearTimeout(teto);
      cancelAnimation(progresso);
      cancelAnimation(painelSai);
    };
    // `painel` de propósito fora: saindo ele não muda, e a cadeia é decidida no começo da saída.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saindo, cortinaSaindo, reduzido, progresso, painelSai, onSaiu]);

  const conteudo = useAnimatedStyle(() => ({ opacity: 1 - painelSai.get() }));
  // Senha aceita: disco e frase ficam em "Confirmando…" enquanto saem — o estado já voltou a
  // `trancado`, e o painel escrevia "Toque para usar…" de novo durante a saída.
  const visivel: EstadoDaTrava = saindo ? 'autenticando' : estado;
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      accessibilityViewIsModal={!saindo}
      pointerEvents={saindo ? 'none' : 'auto'}
      style={[
        styles.tudo,
        {
          paddingTop: insets.top + Space.xl,
          // `Math.max`, não soma: com navegação por gestos o inset do Android volta 0.
          paddingBottom: Math.max(insets.bottom, Space.xxl),
          // Proteção imediata no render de relock, antes de o efeito cancelar a onda antiga.
          backgroundColor: saindo ? 'transparent' : theme.curtain,
        },
      ]}>
      {reduzido ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.curtain }, veu]}
        />
      ) : (
        <WaveCurtain
          progress={progresso}
          fase="revelar"
          mode="up"
          color={theme.curtain}
          style={StyleSheet.absoluteFill}
        />
      )}

      {painel ? (
        <>
          <View style={styles.folga} />

          {/* Terço ótico: 2 em cima, 3 embaixo — o centro geométrico lê baixo demais. */}
          {/* Entrada por fora, opacidade da saída por dentro: as duas na mesma view brigam. */}
          <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
            <Animated.View style={[styles.centro, conteudo]}>
              <DiscoDaTrava estado={visivel} onPress={() => void autenticar()} />
              <View style={styles.dizeres}>
                <ThemedText type="title" themeColor="onCurtain" style={styles.titulo}>
                  App bloqueado
                </ThemedText>
                {/* `key={estado}`: a troca de frase é um corte com fade, não texto mudando sob o olho. */}
                <Animated.View key={visivel} entering={FadeIn.duration(Motion.duration.base)}>
                  <ThemedText type="small" themeColor="onCurtainMuted" style={styles.centrado}>
                    {FRASES[visivel](comoAutentica)}
                  </ThemedText>
                </Animated.View>
              </View>
            </Animated.View>
          </Animated.View>

          <View style={styles.folgaBaixa} />
        </>
      ) : (
        /*
          Só a marca, parada — a mesma da abertura, no mesmo lugar. A tela inteira é o alvo: se o
          prompt não abriu (o app ainda não estava ativo), um toque pede de novo.
        */
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ROTULO[visivel]}
          accessibilityState={{ busy: visivel === 'autenticando' }}
          disabled={saindo || visivel === 'autenticando'}
          onPress={() => void autenticar()}
          style={styles.marcaCentral}>
          <Animated.View exiting={FadeOut.duration(Motion.duration.exit)}>
            <MarcaSeConstruindo saida={progresso} t={inteira} reduzido={reduzido} />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
}

/** O que o leitor de tela anuncia. A tela escreve a instrução; aqui fica o VERBO. */
const ROTULO: Record<EstadoDaTrava, string> = {
  trancado: 'Desbloquear',
  autenticando: 'Confirmando',
  falhou: 'Tentar de novo',
};

function DiscoDaTrava({ estado, onPress }: { estado: EstadoDaTrava; onPress: () => void }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const halo = useSharedValue(0);
  const tranco = useSharedValue(0);
  const alerta = useSharedValue(0);
  const toque = useSharedValue(1);

  useEffect(() => {
    if (estado !== 'autenticando' || reduzido) {
      halo.set(withTiming(0, { duration: Motion.duration.exit }));
      return;
    }
    halo.set(withRepeat(withTiming(1, { duration: 1400, easing: Motion.easing.out }), -1, false));
  }, [estado, reduzido, halo]);

  useEffect(() => {
    alerta.set(
      withTiming(estado === 'falhou' ? 1 : 0, {
        duration: estado === 'falhou' ? Motion.duration.fast : Motion.duration.base,
      })
    );
    if (estado !== 'falhou' || reduzido) return;
    // Amplitude decrescente: lê como "bateu e voltou", a física de uma porta que não abriu.
    tranco.set(
      withSequence(
        withTiming(-9, { duration: 48 }),
        withTiming(6, { duration: 60 }),
        withTiming(-3, { duration: 56 }),
        withTiming(0, { duration: 72, easing: Motion.easing.out })
      )
    );
  }, [estado, reduzido, alerta, tranco]);

  const disco = useAnimatedStyle(() => ({
    transform: [{ translateX: tranco.get() }, { scale: toque.get() }],
  }));
  // O halo nasce do tamanho do disco e cresce: é onda, não brilho.
  const onda = useAnimatedStyle(() => ({
    opacity: (1 - halo.get()) * 0.45,
    transform: [{ scale: 1 + halo.get() * 0.5 }],
  }));
  const anel = useAnimatedStyle(() => ({ opacity: alerta.get() }));

  return (
    <View style={styles.palco}>
      <Animated.View
        pointerEvents="none"
        style={[styles.circulo, { borderColor: theme.onCurtainMuted }, onda]}
      />
      <Animated.View style={disco}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ROTULO[estado]}
          accessibilityState={{ busy: estado === 'autenticando' }}
          disabled={estado === 'autenticando'}
          onPressIn={() => toque.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
          onPressOut={() => toque.set(withTiming(1, { duration: Motion.duration.fast }))}
          onPress={onPress}
          style={[styles.disco, { backgroundColor: theme.heroChip }]}>
          <Mark size={MARCA} color="onCurtain" />
        </Pressable>
        {/* O anel de falha fica PARADO enquanto o disco treme: o estado não depende do movimento. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.circulo, { borderColor: theme.danger, borderWidth: 2 }, anel]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  marcaCentral: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  tudo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    /*
      ⚠️ `zIndex` sozinho NÃO cobre a pilha nativa no Android (medido em 14/09/2026: o app
      continuava clicável por baixo). `elevation` ordena de verdade; 900 fica abaixo da cortina
      de sessão (1000), que precisa cobrir a abertura.
    */
    zIndex: 900,
    elevation: 900,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  veu: { ...StyleSheet.absoluteFill, zIndex: 900, elevation: 900 },
  folga: { flex: 2 },
  folgaBaixa: { flex: 3 },
  centro: { alignItems: 'center', gap: Space.xl },
  dizeres: { alignItems: 'center', gap: Space.xs, maxWidth: 320 },
  centrado: { textAlign: 'center' },
  /*
    ⚠️ `flexShrink: 0`, MEDIDO no APK de release (15/09/2026): dentro de contêiner com
    `entering`, o título saía "App" — o texto medido enquanto o bloco chega encolhe e não se
    remede. Título é identificador: quem cede é o layout.
  */
  titulo: { textAlign: 'center', flexShrink: 0 },
  palco: { width: DISCO, height: DISCO, alignItems: 'center', justifyContent: 'center' },
  disco: {
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circulo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
