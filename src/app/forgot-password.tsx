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
import { criarClienteDeRecuperacao, supabase } from '@/lib/supabase';

const RESEND_SECONDS = 45;
const MIN_PASSWORD = 8;

type Step = 'email' | 'code' | 'password' | 'trocada';
type ClienteDeRecuperacao = ReturnType<typeof criarClienteDeRecuperacao>;

/**
 * Revoga no servidor a sessão que o código abriu, se ela ainda for só desta tela.
 * Fire-and-forget: sair da tela não espera rede, e o `signOut` do auth-js não rejeita.
 */
function descartar(cliente: ClienteDeRecuperacao, pendente: { current: boolean }) {
  if (!pendente.current) return;
  pendente.current = false;
  void cliente.auth.signOut({ scope: 'local' });
}

/**
 * Recuperar senha em três passos: e-mail → código → senha nova.
 *
 * ## A recuperação corre num cliente DESCARTÁVEL
 *
 * `verifyOtp({ type: 'recovery' })` abre uma sessão. No cliente principal ela era gravada e
 * anunciada na hora, com a senha ainda por escolher — e o portão de sessão brigava com a tela
 * para decidir quem ficava. Aqui código e senha nova rodam em `criarClienteDeRecuperacao()`
 * (só memória, nada persistido): a conta só "entra" quando `updateUser({ password })` deu
 * certo e a sessão é entregue ao cliente principal por `setSession`. Daí em diante é um
 * `SIGNED_IN` comum — a cortina do `SessionProvider` e o `Stack.Protected` levam ao app, e esta
 * tela desmonta. Ela não navega para dentro.
 *
 * Desistir no passo da senha ("Cancelar", voltar por gesto, fechar a tela) revoga a sessão de
 * recuperação no servidor. Uma vez entregue ao cliente principal ela NUNCA é revogada daqui:
 * seria derrubar a sessão com que a pessoa acabou de entrar.
 *
 * Se a senha mudou e a entrega falhou, a troca já aconteceu — a tela diz isso e leva ao login.
 *
 * Código, não link — mesma decisão e mesmo motivo do cadastro (`signup.tsx`). Exige o template
 * "Reset password" do projeto Supabase com `{{ .Token }}` no corpo.
 */
export default function ForgotPasswordScreen() {
  const [recuperacao] = useState(criarClienteDeRecuperacao);
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const confirmRef = useRef<TextInput>(null);
  /** O código foi aceito e a sessão de recuperação ainda não foi entregue ao cliente principal. */
  const pendente = useRef(false);
  /** A tela some no meio do `await` quando a sessão aparece; depois dele, só mexe em estado se ainda existir. */
  const montada = useRef(true);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    // Religa no corpo: o StrictMode monta, desmonta e remonta, e só a limpeza deixaria `false`.
    montada.current = true;
    return () => {
      montada.current = false;
      descartar(recuperacao, pendente);
    };
  }, [recuperacao]);

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
    const { error: err } = await recuperacao.auth.verifyOtp({
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
    pendente.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('password');
  };

  const changePassword = async () => {
    if (!passwordOk || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await recuperacao.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // A senha já mudou no servidor. A trava desce ANTES do `setSession`: o `SIGNED_IN` que ele
    // dispara pode desmontar a tela no meio do `await`, e a limpeza revogaria a sessão entregue.
    pendente.current = false;
    const { data } = await recuperacao.auth.getSession();
    const sessao = data.session;
    const entregue =
      !!sessao &&
      !(
        await supabase.auth.setSession({
          access_token: sessao.access_token,
          refresh_token: sessao.refresh_token,
        })
      ).error;
    if (entregue) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    // Não entrou, mas a senha já é a nova: a sessão de recuperação não serve para mais nada.
    pendente.current = true;
    descartar(recuperacao, pendente);
    if (!montada.current) return;
    setBusy(false);
    setStep('trocada');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  const irParaLogin = () => router.replace('/login');

  const footerLabel = {
    email: 'Enviar código',
    code: 'Validar código',
    password: 'Trocar senha',
    trocada: 'Entrar',
  }[step];
  const footerAction = {
    email: requestCode,
    code: verifyCode,
    password: changePassword,
    trocada: irParaLogin,
  }[step];
  const footerDisabled = {
    email: !emailOk,
    code: code.length < 6,
    password: !passwordOk,
    trocada: false,
  }[step];

  const voltar = () => {
    if (step === 'code') {
      setStep('email');
      setError(null);
      return;
    }
    // No passo da senha, sair é DESISTIR: não há código a rever, e a sessão que ele abriu é
    // revogada em vez de ficar viva no servidor até expirar.
    if (step === 'password') descartar(recuperacao, pendente);
    if (router.canGoBack()) router.back();
    else irParaLogin();
  };

  const backLabel = { email: 'Voltar', code: 'Trocar e-mail', password: 'Cancelar', trocada: null }[step];

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
          {backLabel ? (
            <Button label={backLabel} variant="ghost" onPress={voltar} disabled={busy} block />
          ) : null}
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
      ) : step === 'password' ? (
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
          {/* A recusa do servidor é sempre da senha escolhida (igual à antiga, fraca, vazada) ou
              da rede, então mora neste campo — sem ela a tela só vibrava. */}
          <Field label="Senha nova" hint={`Pelo menos ${MIN_PASSWORD} caracteres`} error={error ?? undefined}>
            <TextField
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                if (error) setError(null);
              }}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              autoFocus
              editable={!busy}
              invalid={!!error}
            />
          </Field>
          <Field
            label="Repita a senha"
            error={confirm.length > 0 && password !== confirm ? 'As senhas não batem' : undefined}>
            <TextField
              ref={confirmRef}
              value={confirm}
              onChangeText={(v) => {
                setConfirm(v);
                if (error) setError(null);
              }}
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
      ) : (
        <Animated.View
          key="trocada"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Senha trocada</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Entre com a nova senha.
            </ThemedText>
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
