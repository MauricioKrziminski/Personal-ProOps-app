import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";

import { AuthScreen } from "@/components/auth/auth-screen";
import { OtpInput } from "@/components/auth/otp-input";
import { PhoneField } from "@/components/auth/phone-field";
import { ThemedText } from "@/components/themed-text";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Motion, Space } from "@/design/tokens";
import { authErrorMessage } from "@/lib/auth-errors";
import {
  displayPhoneBR,
  isValidPhoneBR,
  phoneDigits,
  toE164BR,
} from "@/lib/phone-br";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/** Janela antes de liberar o reenvio. Curta o bastante para não parecer castigo. */
const RESEND_SECONDS = 45;

/**
 * Login por Phone OTP — o telefone verificado é a mesma chave que vincula o WhatsApp.
 *
 * Desde 03/09/2026 esta tela mora em `/login-whatsapp` e a porta principal é e-mail e senha
 * (`email-login-screen.tsx`). Ela continua inteira para quem já tinha conta por telefone.
 *
 * ## Por que esta tela foi refeita
 *
 * A arquitetura de dois passos (número → código) estava certa e continua igual. O que mudou foi
 * a execução, que era a única tela do app fora do próprio design system: `Pressable` e
 * `TextInput` estilizados à mão em vez de `Button`/`Field`, raio fora da escala `Radius`, e o
 * erro do Supabase impresso cru — `Token has expired or is invalid` era literalmente a única
 * frase que o usuário lia ao errar o código, em inglês, num app em pt-BR.
 *
 * Faltavam também as três peças sem as quais um fluxo de OTP não fecha:
 *
 * - **Reenviar.** Sem isso, "o código não chegou" é um beco sem saída.
 * - **O número de volta.** O `+55` era colado em silêncio; agora ele aparece na digitação e é
 *   repetido no passo 2, com "Trocar número" ao lado.
 * - **Autofill de verdade.** `autoComplete="sms-otp"` cobre só o Android — ver `OtpInput`.
 *
 * ## Continuidade com a abertura
 *
 * A espiral no topo é a **mesma geometria** (`@/design/mark-path`) que a animação de abertura
 * deixa na tela. É o que emenda splash e login: antes a abertura desenhava a marca em Skia por
 * 2 s e entregava uma tela que escrevia "Personal / by ProOps" em texto puro.
 *
 * ## O foco
 *
 * O passo 1 não abre o teclado na primeira vez (ver `returning`); o passo 2 abre sempre — nesse
 * ponto o usuário já decidiu e o código está a caminho.
 */
export function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  /**
   * O passo 1 só abre o teclado sozinho na VOLTA.
   *
   * Na primeira vez há uma frase ali explicando por que pedimos o telefone, e o teclado a
   * empurraria para fora antes de ser lida. Quem tocou "Trocar número" já leu tudo isso e tem
   * exatamente uma coisa a fazer.
   */
  const [returning, setReturning] = useState(false);

  // Contagem do reenvio. Um `setInterval` só, derrubado quando zera ou quando a tela sai.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const valid = isValidPhoneBR(phone);

  const requestCode = async (resend = false) => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      phone: toE164BR(phone),
    });
    setBusy(false);

    if (err) {
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCooldown(RESEND_SECONDS);
    if (!resend) {
      setCode("");
      setStep("code");
    }
  };

  /** Recebe o código por parâmetro: no auto-submit o `useState` ainda não assentou. */
  const verifyCode = async (submitted?: string) => {
    const token = submitted ?? code;
    if (token.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      phone: toE164BR(phone),
      token,
      type: "sms",
    });
    setBusy(false);

    if (err) {
      setError(authErrorMessage(err));
      setCode("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    // Sucesso: `onAuthStateChange` troca a tela — o `Stack.Protected` do layout raiz cuida disso.
  };

  const changeNumber = () => {
    setReturning(true);
    setStep("phone");
    setCode("");
    setError(null);
    setCooldown(0);
  };

  // Atalho de desenvolvimento: entra como o usuário de teste sem OTP (só em __DEV__).
  const devLogin = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: "dev@proops.local",
      password: "devtest123",
    });
    setBusy(false);
    if (err) setError(authErrorMessage(err));
  };

  const onPhone = step === "phone";

  return (
    <AuthScreen
      footer={
        <>
          <Button
            label={onPhone ? "Continuar" : "Entrar"}
            onPress={onPhone ? () => requestCode() : () => verifyCode()}
            loading={busy}
            disabled={onPhone ? !valid : code.length < 6}
            size="lg"
            block
          />
          {/* A porta principal é e-mail e senha: esta tela é sempre EMPURRADA de lá, e sem
              este botão ela não tinha nenhuma volta visível — as outras três têm. */}
          <Button
            label={onPhone ? "Voltar" : "Trocar número"}
            variant="ghost"
            onPress={onPhone ? () => router.back() : changeNumber}
            disabled={busy}
            block
          />
          {__DEV__ && (
            <Button
              label="Entrar como teste (dev)"
              variant="ghost"
              size="sm"
              onPress={devLogin}
              block
            />
          )}
        </>
      }
    >
      {onPhone ? (
        <Animated.View
          key="phone"
          entering={FadeInLeft.duration(Motion.duration.slow).easing(
            Motion.easing.out,
          )}
          style={styles.step}
        >
          <View style={styles.copy}>
            <ThemedText type="title">Entrar com o WhatsApp</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Use o mesmo número do seu WhatsApp — é por ele que suas notas,
              lembretes e gastos chegam aqui.
            </ThemedText>
          </View>

          <Field
            label="Número com DDD"
            error={error ?? undefined}
            hint={
              isSupabaseConfigured
                ? undefined
                : "Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env."
            }
          >
            <PhoneField
              autoFocus={returning}
              value={phone}
              onChange={(text) => {
                setPhone(phoneDigits(text));
                if (error) setError(null);
              }}
              onSubmit={() => requestCode()}
              invalid={!!error}
              editable={!busy}
            />
          </Field>

          <View style={styles.note}>
            <Icon name="bubble.left" size="sm" color="textSecondary" />
            <ThemedText
              type="footnote"
              themeColor="textSecondary"
              style={styles.noteText}
            >
              Você recebe um código de 6 dígitos no WhatsApp. Sem senha.
            </ThemedText>
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          key="code"
          entering={FadeInRight.duration(Motion.duration.slow).easing(
            Motion.easing.out,
          )}
          style={styles.step}
        >
          <View style={styles.copy}>
            <ThemedText type="title">Confira o WhatsApp</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Mandamos um código de 6 dígitos para {displayPhoneBR(phone)}.
            </ThemedText>
          </View>

          <Field label="Código" error={error ?? undefined}>
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (error) setError(null);
              }}
              onComplete={(next) => verifyCode(next)}
              invalid={!!error}
              editable={!busy}
              autoFocus
            />
          </Field>

          <View style={styles.note}>
            {cooldown > 0 ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Não chegou? Você pode reenviar em {cooldown}s
              </ThemedText>
            ) : (
              <Button
                label="Reenviar código"
                variant="ghost"
                size="sm"
                onPress={() => requestCode(true)}
                disabled={busy}
              />
            )}
          </View>
        </Animated.View>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  /** Cada passo é um bloco só, para entrar e sair inteiro. */
  step: {
    gap: Space.xl,
  },
  copy: {
    gap: Space.sm,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: Space.sm,
  },
  noteText: {
    flex: 1,
  },
});
