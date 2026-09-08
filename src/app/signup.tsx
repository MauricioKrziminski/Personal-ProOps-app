import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { z } from 'zod';

import { AuthScreen } from '@/components/auth/auth-screen';
import { OtpInput } from '@/components/auth/otp-input';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Motion, Space } from '@/design/tokens';
import { authErrorMessage } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

/** Janela antes de liberar o reenvio — a mesma do OTP por WhatsApp. */
const RESEND_SECONDS = 45;

const schema = z
  .object({
    name: z.string().trim().min(2, 'Como a gente te chama?').max(60, 'Nome longo demais'),
    email: z.string().trim().email('Esse e-mail não parece válido'),
    password: z.string().min(8, 'Pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não batem' });

type FormValues = z.infer<typeof schema>;

/**
 * Criar conta por e-mail: nome, e-mail, senha, e o código de 6 dígitos que chega no e-mail.
 *
 * **Sem telefone aqui, de propósito.** O plano original pedia um campo de telefone opcional; ele
 * saiu porque `profiles.phone` é a chave pela qual o agente entrega o WhatsApp de alguém
 * (`agent/app/db.py`). Um número NÃO VERIFICADO gravado no cadastro deixaria qualquer pessoa
 * digitar o SEU número e receber os seus lançamentos — e ainda colidiria no `unique` com quem
 * já tem aquele número. Telefone entra só pelo OTP do Perfil (Fase 4), verificado.
 *
 * **Código, não link.** A confirmação usa `verifyOtp(type: 'signup')` com o `{{ .Token }}` do
 * template de e-mail, e não o `{{ .ConfirmationURL }}`: link exige deep link, allow-list de
 * redirect e tratamento de URL no app; código reaproveita o `OtpInput` que o WhatsApp já usa.
 * Exige o template "Confirm signup" do projeto Supabase com `{{ .Token }}` no corpo.
 *
 * **E-mail repetido.** Com confirmação ligada, `signUp` de um e-mail que já existe devolve um
 * usuário FALSO sem erro (proteção contra enumeração) — a marca é `identities` vazio. Sem essa
 * checagem, a tela mostraria "confira seu e-mail" para um e-mail que nunca vai receber nada.
 */
export default function SignupScreen() {
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const { control, handleSubmit, getValues, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirm: '' },
    mode: 'onBlur',
  });
  const errors = formState.errors;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const submit = handleSubmit(async (values) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { display_name: values.name } },
    });
    setBusy(false);

    if (err) {
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (data.user && data.user.identities?.length === 0) {
      setError('Já existe uma conta com esse e-mail. Entre ou recupere a senha.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCooldown(RESEND_SECONDS);
    setCode('');
    // Com confirmação desligada o signUp já devolve sessão e o layout raiz troca a tela sozinho.
    if (!data.session) setStep('code');
  });

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: getValues('email') });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCooldown(RESEND_SECONDS);
  };

  /** Recebe o código por parâmetro: no auto-submit o `useState` ainda não assentou. */
  const verify = async (submitted?: string) => {
    const token = submitted ?? code;
    if (token.length < 6 || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      email: getValues('email'),
      token,
      type: 'signup',
    });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    // Sucesso: sessão criada, `Stack.Protected` troca a tela.
  };

  const onForm = step === 'form';

  return (
    <AuthScreen
      footer={
        <>
          <Button
            label={onForm ? 'Criar conta' : 'Confirmar'}
            onPress={onForm ? () => submit() : () => verify()}
            loading={busy}
            disabled={onForm ? false : code.length < 6}
            size="lg"
            block
          />
          <Button
            label={onForm ? 'Já tenho conta' : 'Trocar e-mail'}
            variant="ghost"
            onPress={onForm ? () => router.back() : () => { setStep('form'); setError(null); }}
            disabled={busy}
            block
          />
        </>
      }>
      {onForm ? (
        <Animated.View
          key="form"
          entering={FadeInLeft.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Criar conta</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              O WhatsApp você conecta depois, no Perfil — se quiser.
            </ThemedText>
          </View>

          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Field label="Nome" error={errors.name?.message}>
                <TextField
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Gabriel"
                  autoCapitalize="words"
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  invalid={!!errors.name}
                  editable={!busy}
                />
              </Field>
            )}
          />

          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <Field label="E-mail" error={errors.email?.message ?? error ?? undefined}>
                <TextField
                  ref={emailRef}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="voce@exemplo.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  invalid={!!errors.email || !!error}
                  editable={!busy}
                />
              </Field>
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <Field label="Senha" error={errors.password?.message} hint="Pelo menos 8 caracteres">
                <TextField
                  ref={passwordRef}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  invalid={!!errors.password}
                  editable={!busy}
                />
              </Field>
            )}
          />

          <Controller
            control={control}
            name="confirm"
            render={({ field }) => (
              <Field label="Repita a senha" error={errors.confirm?.message}>
                <TextField
                  ref={confirmRef}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={() => submit()}
                  invalid={!!errors.confirm}
                  editable={!busy}
                />
              </Field>
            )}
          />
        </Animated.View>
      ) : (
        <Animated.View
          key="code"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Confira o e-mail</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Mandamos um código de 6 dígitos para {getValues('email')}.
            </ThemedText>
          </View>

          <Field label="Código" error={error ?? undefined}>
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (error) setError(null);
              }}
              onComplete={(next) => verify(next)}
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
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  step: { gap: Space.xl },
  copy: { gap: Space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
});
