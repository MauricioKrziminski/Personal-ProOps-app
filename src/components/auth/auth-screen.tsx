import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthCap } from "@/components/auth/auth-cap";
import { useCortinaAberta } from "@/components/motion/session-curtain";
import { ThemedView } from "@/components/themed-view";
import { Motion, Space } from "@/design/tokens";
import { alturaDaCapa } from "@/design/wave-math";

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
 * ## A capa (16/09/2026)
 *
 * Com a marca (`showBrand`), o topo é a `AuthCap`: a tinta da abertura parada numa curva, como o
 * login dos vídeos de referência. A cortina da raiz PARA nessa mesma curva quando o destino é uma
 * tela de conta (abertura sem sessão, saída), e desmonta por cima dela sem salto. O conteúdo
 * começa abaixo do ponto mais baixo da curva, e o rodapé encosta na base (`marginTop: 'auto'`)
 * quando sobra tela — com teclado, a lista rola como antes.
 *
 * ## A entrada
 *
 * O conteúdo só MONTA depois que a cortina abriu pela primeira vez: por baixo da tinta não há o
 * que mostrar, e montado antes ele "entraria" escondido. A trava (`visto`) nunca volta a `false` —
 * sem ela, o formulário sumiria por baixo da cortina que cobre ao entrar na conta.
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
  const { height } = useWindowDimensions();
  const aberta = useCortinaAberta();
  const [visto, setVisto] = useState(aberta);
  if (aberta && !visto) setVisto(true);

  const entrada = (indice: number) =>
    FadeInDown.withInitialValues({ opacity: 0, transform: [{ translateY: 16 }] })
      .duration(Motion.duration.slow + 80)
      .easing(Motion.easing.out)
      .delay(indice * Motion.stagger.step * 3)
      .reduceMotion(ReduceMotion.System);

  return (
    <ThemedView style={styles.flex}>
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: showBrand
              ? alturaDaCapa(height) + Space.xl
              : insets.top + Space.xxxl,
            paddingBottom: insets.bottom + Space.lg,
          },
        ]}
        bottomOffset={Space.xxl}
        keyboardShouldPersistTaps="handled"
        // `interactive` (arrastar o teclado para baixo) é iOS-only: no Android ele cai em
        // `none`, e o gesto de fechar arrastando simplesmente não existe. `on-drag` é o
        // equivalente que a plataforma tem.
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
      >
        {showBrand ? (
          <>
            {/* A capa é tinta nos dois temas: ícones claros por cima dela. */}
            <StatusBar style="light" />
            <AuthCap />
          </>
        ) : null}
        {visto ? (
          <>
            <Animated.View entering={entrada(0)}>{children}</Animated.View>
            <Animated.View entering={entrada(1)} style={styles.footer}>
              {footer}
            </Animated.View>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Space.xl,
    gap: Space.xxl,
  },
  footer: { gap: Space.sm, alignItems: "stretch", marginTop: "auto" },
});
