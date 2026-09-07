import { StyleSheet } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedView } from "@/components/themed-view";
import { Mark } from "@/components/ui/mark";
import { Motion, Space } from "@/design/tokens";

/**
 * A moldura das telas de conta (entrar, criar conta, recuperar senha).
 *
 * É a mesma anatomia da tela de WhatsApp (`login-screen.tsx`): marca no topo, um bloco de
 * conteúdo, e o botão principal no rodapé. Três telas novas copiando esses 40 linhas de andaime é
 * como elas passam a divergir — o rodapé de uma sobe com o teclado e o da outra não.
 *
 * ⚠️ **O rodapé fica DENTRO do scroll, e o teclado é problema do `ScrollView`.**
 * Isto já foi um `KeyboardAvoidingView` com `behavior="padding"` e um rodapé irmão, e o
 * arranjo colapsava a tela inteira no iOS: a KAV encolhe o container, então o scroll perdia
 * a altura do teclado E a do rodapé de uma vez. No login sobravam ~258pt para um formulário de
 * ~400pt — o "Entrar" encostava no campo de e-mail (2pt medidos no simulador, 04/09/2026) e o
 * campo de senha mais os dois links ficavam escondidos atrás dele, sem nenhuma pista de que
 * havia mais tela. Era o "botões grudados, tudo em cima do outro".
 *
 * ⚠️ **`KeyboardAwareScrollView`, nunca `automaticallyAdjustKeyboardInsets`.**
 * Aquela prop é **iOS-only** — no Android ela não faz nada, em silêncio. O resultado num
 * aparelho Android real: tocar no campo de e-mail abre o teclado POR CIMA do campo e a pessoa
 * digita às cegas. A prop resolvia o colapso do iOS e escondia que o Android continuava sem
 * tratamento nenhum, que é o pior tipo de correção: a plataforma em que ninguém testou some
 * do radar.
 *
 * O `KeyboardAwareScrollView` do `react-native-keyboard-controller` é o que os formulários do
 * app já usam (lançamento, lembrete, nota) e funciona nas DUAS plataformas: insere o inset do
 * teclado e rola o campo focado para a área visível. `bottomOffset` é a folga entre o campo e o
 * topo do teclado — sem ela o cursor encosta na borda.
 *
 * ⚠️ **O conteúdo é CENTRALIZADO como um bloco só** (`justifyContent: 'center'` sobre
 * `flexGrow: 1`), não espalhado entre o topo e o rodapé. A versão anterior tinha um espaçador de
 * `flex: 1` entre o formulário e o rodapé: com a tela sobrando, a marca e os campos colavam no
 * topo e o "Entrar" descia para a base, com um vão morto no meio — a tela parecia dois pedaços
 * soltos em vez de um formulário. Centralizado, a sobra fica igual em cima e embaixo.
 *
 * Isso não conflita com o teclado: `flexGrow` só centraliza enquanto o conteúdo é MENOR que a
 * área visível. Quando o teclado sobe e o conteúdo passa a ser maior, o container volta a se
 * comportar como uma lista normal (alinhada ao topo, rolável) e o `KeyboardAwareScrollView`
 * leva o campo focado para a área visível.
 */
export function AuthScreen({
  children,
  footer,
  showBrand = true,
}: {
  children: React.ReactNode;
  /** O submit e os links secundários. Vai no fim do scroll, colado ao rodapé. */
  footer: React.ReactNode;
  /** Fluxos internos de uma conta aberta não repetem a marca da porta de entrada. */
  showBrand?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.flex}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Space.xxxl,
            paddingBottom: insets.bottom + Space.lg,
          },
        ]}
        bottomOffset={Space.xxl}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        {showBrand ? (
          <Animated.View
            entering={FadeIn.duration(Motion.duration.slow)}
            style={styles.brand}
          >
            <Mark size={44} />
          </Animated.View>
        ) : null}
        {children}

        <Animated.View
          entering={FadeInDown.duration(Motion.duration.slow).delay(
            Motion.stagger.step * 2,
          )}
          style={styles.footer}
        >
          {footer}
        </Animated.View>
      </KeyboardAwareScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Space.xl,
    gap: Space.xxl,
  },
  brand: { alignItems: "flex-start" },
  footer: { gap: Space.sm, alignItems: "stretch" },
});
