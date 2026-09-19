import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';

import { AuthScreen } from '@/components/auth/auth-screen';
import { OtpInput } from '@/components/auth/otp-input';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Motion, Space } from '@/design/tokens';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/hooks/use-session';

const RESEND_SECONDS = 45;
const MIN_PASSWORD = 8;

type Step = 'email' | 'code' | 'password';

/**
 * Recuperar senha em três passos: e-mail → código → senha nova.
 *
 * O código é validado antes de revelar os campos da senha. `verifyOtp` de recuperação abre uma
 * sessão, então esta rota fica fora do `Stack.Protected guard={!session}`. Assim a tela não é
 * desmontada no momento em que o código é aceito e a pessoa consegue concluir a troca; a saída
 * para o app só acontece depois de `updateUser({ password })` retornar com sucesso.
 *
 * Código, não link — mesma decisão e mesmo motivo do cadastro (`signup.tsx`). Exige o template
 * "Reset password" do projeto Supabase com `{{ .Token }}` no corpo.
 */
export default function ForgotPasswordScreen() {
  const { session } = useSession();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [senhaTrocada, setSenhaTrocada] = useState(false);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // `updateUser` dispara o evento de sessão antes de a cortina terminar. Esperar o estado exibido
  // pelo SessionProvider evita mandar o usuário de volta ao login durante a própria transição.
  useEffect(() => {
    if (senhaTrocada && session) router.replace('/');
  }, [senhaTrocada, session]);

  const emailOk = email.trim().includes('@');
  const passwordOk = password.length >= MIN_PASSWORD && password === confirm;

  const requestCode = async () => {
    if (!emailOk || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCooldown(RESEND_SECONDS);
    setCode('');
    setStep('code');
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    await requestCode();
  };

  /** Recebe o código por parâmetro: no auto-submit o `useState` ainda não assentou. */
  const verifyCode = async (submitted?: string) => {
    const token = submitted ?? code;
    if (token.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'recovery',
    });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('password');
  };

  const changePassword = async () => {
    if (!passwordOk || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSenhaTrocada(true);
  };

  const footerLabel = { email: 'Enviar código', code: 'Validar código', password: 'Trocar senha' }[step];
  const footerAction = {
    email: requestCode,
    code: verifyCode,
    password: changePassword,
  }[step];
  const footerDisabled = { email: !emailOk, code: code.length < 6, password: !passwordOk }[step];

  const voltar = () => {
    if (step === 'email') {
      router.back();
      return;
    }
    if (step === 'code') {
      setStep('email');
    } else {
      setStep('code');
    }
    setError(null);
  };

  const backLabel = step === 'email' ? 'Voltar' : step === 'code' ? 'Trocar e-mail' : 'Voltar ao código';

  return (
    <AuthScreen
      footer={
        <>
          <Button
            label={footerLabel}
            onPress={footerAction}
            loading={busy}
            disabled={footerDisabled}
            size="lg"
            block
            origemDaCortina
          />
          <Button label={backLabel} variant="ghost" onPress={voltar} disabled={busy} block />
        </>
      }>
      {step === 'email' ? (
        <Animated.View
          key="email"
          entering={FadeInLeft.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Recuperar senha</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Mandamos um código de 6 dígitos para o seu e-mail.
            </ThemedText>
          </View>
          <Field label="E-mail" error={error ?? undefined}>
            <TextField
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (error) setError(null);
              }}
              placeholder="voce@exemplo.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={() => requestCode()}
              autoFocus
              editable={!busy}
              invalid={!!error}
            />
          </Field>
        </Animated.View>
      ) : step === 'code' ? (
        <Animated.View
          key="code"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Confira o e-mail</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Mandamos um código de 6 dígitos para {email.trim()}.
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
              <Button label="Reenviar código" variant="ghost" size="sm" onPress={resend} disabled={busy} />
            )}
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          key="password"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Senha nova</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Código validado. Agora escolha a senha que você vai usar para entrar.
            </ThemedText>
          </View>
          <Field label="Senha nova" hint={`Pelo menos ${MIN_PASSWORD} caracteres`}>
            <TextField
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              autoFocus
              editable={!busy}
            />
          </Field>
          <Field
            label="Repita a senha"
            error={confirm.length > 0 && password !== confirm ? 'As senhas não batem' : undefined}>
            <TextField
              ref={confirmRef}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => passwordOk && changePassword()}
              invalid={confirm.length > 0 && password !== confirm}
              editable={!busy}
            />
          </Field>
        </Animated.View>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  step: { gap: Space.xl },
  copy: { gap: Space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
