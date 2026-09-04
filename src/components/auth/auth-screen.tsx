import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Mark } from '@/components/ui/mark';
import { Motion, Space } from '@/design/tokens';

/**
 * A moldura das telas de conta (entrar, criar conta, recuperar senha).
 *
 * É a mesma anatomia da tela de WhatsApp (`login-screen.tsx`): marca no topo, um bloco de
 * conteúdo centrado que rola quando o teclado sobe, e o botão principal preso no rodapé. Três
 * telas novas copiando esses 40 linhas de andaime é como elas passam a divergir — o rodapé de
 * uma sobe com o teclado e o da outra não.
 */
export function AuthScreen({
  children,
  footer,
}: {
  children: React.ReactNode;
  /** O submit e os links secundários. Fica fora do scroll, colado ao rodapé. */
  footer: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.xxxl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeIn.duration(Motion.duration.slow)} style={styles.brand}>
            <Mark size={44} />
          </Animated.View>
          {children}
        </ScrollView>

        <Animated.View
          entering={FadeInDown.duration(Motion.duration.slow).delay(Motion.stagger.step * 2)}
          style={[styles.footer, { paddingBottom: insets.bottom + Space.lg }]}>
          {footer}
        </Animated.View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xl,
    gap: Space.xxl,
  },
  brand: { alignItems: 'flex-start' },
  footer: {
    paddingHorizontal: Space.xl,
    gap: Space.sm,
    alignItems: 'stretch',
  },
});
