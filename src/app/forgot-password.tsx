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

const RESEND_SECONDS = 45;
const MIN_PASSWORD = 8;

type Step = 'email' | 'password' | 'code';

/**
 * Recuperar senha em três passos: e-mail → senha nova → código.
 *
 * A ordem é essa, e não "código → senha nova", por causa do portão de sessão: `verifyOtp` de
 * recuperação já devolve SESSÃO, e no mesmo instante o `Stack.Protected guard={!session}` do
 * layout raiz desmonta esta tela — antes de o usuário conseguir digitar a senha nova. Pedindo a
 * senha ANTES do código, o `verifyOtp` e o `updateUser` rodam na mesma função assíncrona, que
 * sobrevive ao unmount, e a pessoa cai no app já com a senha trocada.
 *
 * Código, não link — mesma decisão e mesmo motivo do cadastro (`signup.tsx`). Exige o template
 * "Reset password" do projeto Supabase com `{{ .Token }}` no corpo.
 */
export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const emailOk = email.includes('@');
  const passwordOk = password.length >= MIN_PASSWORD && password === confirm;

  const requestCode = async (resend = false) => {
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
    if (!resend) setStep('password');
  };

  /** Recebe o código por parâmetro: no auto-submit o `useState` ainda não assentou. */
  const verifyAndChange = async (submitted?: string) => {
    const token = submitted ?? code;
    if (token.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'recovery',
    });
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // A partir daqui esta tela pode já ter sido desmontada — nada de setState depois do await.
    const { error: upd } = await supabase.auth.updateUser({ password });
    if (upd) {
      // Sessão existe (o código valeu) mas a senha não trocou: a pessoa entra e troca no Perfil.
      console.warn('updateUser depois da recuperação:', upd.message);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const footerLabel = { email: 'Enviar código', password: 'Continuar', code: 'Trocar senha' }[step];
  const footerAction = {
    email: () => requestCode(),
    password: () => setStep('code'),
    code: () => verifyAndChange(),
  }[step];
  const footerDisabled = { email: !emailOk, password: !passwordOk, code: code.length < 6 }[step];

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
          />
          <Button
            label={step === 'email' ? 'Voltar' : 'Trocar e-mail'}
            variant="ghost"
            onPress={step === 'email' ? () => router.back() : () => { setStep('email'); setError(null); }}
            disabled={busy}
            block
          />
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
      ) : step === 'password' ? (
        <Animated.View
          key="password"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Senha nova</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Escolha a senha agora; o código do e-mail vem no próximo passo.
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
              returnKeyType="next"
              onSubmitEditing={() => passwordOk && setStep('code')}
              invalid={confirm.length > 0 && password !== confirm}
              editable={!busy}
            />
          </Field>
        </Animated.View>
      ) : (
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
              onComplete={(next) => verifyAndChange(next)}
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
  step: { gap: Space.xl },
  copy: { gap: Space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
