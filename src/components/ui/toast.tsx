import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, FadeOutDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSegments } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { TAB_BAR_CLEARANCE } from '@/components/ui/pill-tab-bar';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useTheme, useScheme } from '@/hooks/use-theme';

type Tone = 'info' | 'success' | 'error';

interface Toast {
  /** Texto, ou texto com o nome citado em `<Forte>` ("Pasta **Mercado** arquivada."). */
  message: ReactNode;
  tone: Tone;
  action?: { label: string; onPress: () => void };
}

const ToastContext = createContext<(t: Toast) => void>(() => {});

/**
 * O toast VISÍVEL, para quem precisa desenhá-lo numa superfície própria.
 *
 * ⚠️ **Toast disparado de dentro de um `Sheet` não aparecia — em nenhuma das 22 telas que usam
 * sheet** (medido no emulador em 15/09/2026, com o erro chegando no `onError` e nada na tela).
 * O `Modal` do React Native é uma JANELA separada no Android e um view controller apresentado
 * no iOS; o host do toast vive na árvore raiz, então ele era pintado ATRÁS da folha. Uma
 * mutation que falha em silêncio é reprovação pelo §6 do design, e aqui ela falhava em silêncio
 * por construção.
 *
 * A saída NÃO é pôr o toast dentro de um `Modal` próprio: no Android uma janela transparente
 * come todos os toques enquanto está no ar, e o sheet ficaria intocável por 3,2 s. O `Sheet`
 * desenha o MESMO toast dentro dele — o estado é um só, o `show` (e o haptics) roda uma vez, e
 * a cópia da raiz fica escondida atrás da folha, que é onde ela já estava.
 */
const ToastStateContext = createContext<{ toast: Toast | null; dismiss: () => void; medir: (altura: number) => void }>({
  toast: null,
  dismiss: () => {},
  medir: () => {},
});

/**
 * Quanto o toast VISÍVEL ocupa a partir do pé da tela (do pé até o topo dele), ou 0.
 *
 * ⚠️ Existe pelo FAB (24/09/2026): o "Lançar" e o toast moram no MESMO lugar — os dois a
 * `insets.bottom + Space.xxl` —, e em Lançamentos o toque no "Desfazer" caía no botão de baixo e
 * abria "Novo lançamento" (medido no simulador). Quem sai do caminho é o FAB, como no Material:
 * ele sobe acima do toast e volta quando ele sai (`useSubirAcimaDoToast`).
 */
const ToastOcupaContext = createContext(0);
export function useToastOcupa() {
  return useContext(ToastOcupaContext);
}

/**
 * O deslocamento do FAB enquanto um toast está no ar: sobe o bastante para o topo do toast
 * (`useToastOcupa`) ficar abaixo dele, e volta quando o toast sai. `base` é o `bottom` do FAB.
 */
export function useSubirAcimaDoToast(base: number) {
  const ocupa = useToastOcupa();
  const alvo = Math.max(0, ocupa - base);
  const sobe = useSharedValue(0);
  useEffect(() => {
    sobe.set(withTiming(alvo, { duration: Motion.duration.base, easing: Motion.easing.out }));
  }, [alvo, sobe]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: -sobe.get() }] }));
}

/**
 * Desenha o toast corrente. Vive na raiz e dentro de cada `Sheet`. `acimaDaBarra`: o da raiz, numa
 * raiz de aba, sobe acima da barra de abas (25/09/2026) — no pé da tela ele cobria a navegação por
 * 3 s, o que o Material não faz com o snackbar sobre a barra inferior.
 */
export function ToastOutlet({ acimaDaBarra = false }: { acimaDaBarra?: boolean }) {
  const { toast, dismiss, medir } = useContext(ToastStateContext);
  return toast ? <ToastView toast={toast} onDismiss={dismiss} onAltura={medir} acimaDaBarra={acimaDaBarra} /> : null;
}

/** Do pé da tela ao pé do toast: acima da barra de abas quando ela está na tela. */
function peDoToast(inferior: number, acimaDaBarra: boolean) {
  return inferior + (acimaDaBarra ? TAB_BAR_CLEARANCE : Space.xxl);
}

/**
 * O toast de uma tela `presentation: 'modal'`, no fim da árvore dela.
 *
 * No iOS o modal é um view controller apresentado ACIMA da raiz, e o toast da raiz ficava atrás
 * dele — medido em 17/09/2026 no formulário de lançamento: o toast disparou e a tela não pintou
 * nada. No Android o modal mora no mesmo contêiner da pilha e o da raiz já aparece por cima; uma
 * segunda cópia ali dobraria a sombra.
 */
export function ToastDoModal() {
  return Platform.OS === 'ios' ? <ToastOutlet /> : null;
}

/**
 * Mensagem transitória.
 *
 * Existe por um motivo concreto: hoje 15 mutations do app falham em **silêncio total**
 * (`useDeleteNote`, `useToggleReminder`, `useArchive*`, `useMarkPaid`,
 * `usePayDebtInstallment`…). Nenhuma delas tem tratamento de erro.
 *
 * Regra: toda mutation que pode falhar chama `toast` no `onError`. Ação destrutiva reversível
 * chama no `onSuccess` com "Desfazer".
 */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [altura, setAltura] = useState(0);
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // As raízes de aba são as únicas telas com a barra: as empurradas moram fora de `(tabs)`.
  const naRaizDeAba = useSegments()[0] === '(tabs)';

  const show = useCallback((next: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    Haptics.notificationAsync(
      next.tone === 'error'
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Success
    );
    setToast(next);
    // Com ação o usuário precisa de tempo para decidir; sem ação, sai rápido.
    timer.current = setTimeout(() => setToast(null), next.action ? 6000 : 3200);
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const value = useMemo(() => show, [show]);
  const estado = useMemo(() => ({ toast, dismiss, medir: setAltura }), [toast, dismiss]);
  // Do pé da tela até o topo do toast (a mesma conta do `bottom` do `ToastView`), mais uma folga.
  const ocupa = toast && altura > 0 ? peDoToast(insets.bottom, naRaizDeAba) + altura + Space.sm : 0;

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={estado}>
        <ToastOcupaContext.Provider value={ocupa}>
          {children}
          <ToastOutlet acimaDaBarra={naRaizDeAba} />
        </ToastOcupaContext.Provider>
      </ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  onDismiss,
  onAltura,
  acimaDaBarra,
}: {
  toast: Toast;
  onDismiss: () => void;
  onAltura: (altura: number) => void;
  acimaDaBarra: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scheme = useScheme();
  const icon = {
    info: 'info.circle.fill',
    success: 'checkmark.circle.fill',
    error: 'exclamationmark.triangle.fill',
  } as const;
  /**
   * O toast é um bloco NEGATIVO (tinta no claro, papel no escuro), então tudo dentro dele usa as
   * cores `onHero*`. A faixa de 3px na esquerda carrega o tom — é a única cor do bloco.
   */
  const tom = { info: 'onHero', success: 'onHeroSuccess', error: 'onHeroDanger' } as const;
  const faixa = { info: theme.tintFill, success: theme.onHeroSuccess, error: theme.onHeroDanger };

  return (
    /*
      ⚠️ **O toast sobe junto com o teclado** (25/09/2026). No pé da tela ele nascia ATRÁS do
      teclado aberto: salvar um formulário que o banco recusava parecia "não fazer nada" — o motivo
      estava lá, escondido. Aberto o teclado, ele fica logo acima dele.
    */
    <KeyboardStickyView
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      offset={{ opened: insets.bottom + Space.xxl - Space.md }}>
    <Animated.View
      entering={FadeInDown.duration(Motion.duration.base).easing(Motion.easing.out)}
      exiting={FadeOutDown.duration(Motion.duration.exit)}
      pointerEvents="box-none"
      onLayout={(e) => onAltura(e.nativeEvent.layout.height)}
      style={[styles.host, { bottom: peDoToast(insets.bottom, acimaDaBarra) }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          { backgroundColor: theme.heroSurface, boxShadow: Elevation[scheme].overlay },
        ]}>
        <View style={[styles.faixa, { backgroundColor: faixa[toast.tone] }]} />
        <Icon name={icon[toast.tone]} size="md" color={tom[toast.tone]} />
        <ThemedText type="small" themeColor="onHero" style={styles.message}>
          {toast.message}
        </ThemedText>
        {toast.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              toast.action?.onPress();
              onDismiss();
            }}>
            <ThemedText type="linkPrimary" themeColor="onHero">
              {toast.action.label}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Fechar" hitSlop={12} onPress={onDismiss}>
            <Icon name="xmark" size="sm" color="onHeroMuted" />
          </Pressable>
        )}
      </View>
    </Animated.View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    paddingLeft: Space.lg + 3,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  faixa: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  message: {
    flex: 1,
  },
});
