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

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView toast={toast} onDismiss={dismiss} /> : null}
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
        <ThemedText type="small" style={styles.message} numberOfLines={2}>
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
