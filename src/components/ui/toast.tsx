import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useTheme, useScheme } from '@/hooks/use-theme';

type Tone = 'info' | 'success' | 'error';

interface Toast {
  message: string;
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
const ToastStateContext = createContext<{ toast: Toast | null; dismiss: () => void }>({
  toast: null,
  dismiss: () => {},
});

/** Desenha o toast corrente. Vive na raiz e dentro de cada `Sheet`. */
export function ToastOutlet() {
  const { toast, dismiss } = useContext(ToastStateContext);
  return toast ? <ToastView toast={toast} onDismiss={dismiss} /> : null;
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const estado = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={estado}>
        {children}
        <ToastOutlet />
      </ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const scheme = useScheme();

  const icon = {
    info: 'info.circle.fill',
    success: 'checkmark.circle.fill',
    error: 'exclamationmark.triangle.fill',
  } as const;
  const tint = { info: 'tint', success: 'success', error: 'danger' } as const;

  return (
    <Animated.View
      entering={FadeInDown.duration(Motion.duration.base)}
      exiting={FadeOutDown.duration(Motion.duration.exit)}
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + Space.xxl }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          { backgroundColor: theme.surfaceRaised, boxShadow: Elevation[scheme].overlay },
        ]}>
        <Icon name={icon[toast.tone]} size="md" color={tint[toast.tone]} />
        <ThemedText type="small" style={styles.message}>
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
            <ThemedText type="smallBold" themeColor="tint">
              {toast.action.label}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Fechar" hitSlop={12} onPress={onDismiss}>
            <Icon name="xmark" size="sm" color="textSecondary" />
          </Pressable>
        )}
      </View>
    </Animated.View>
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
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  message: {
    flex: 1,
  },
});
