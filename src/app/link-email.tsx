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
import { Note } from '@/components/ui/note';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Motion, Space } from '@/design/tokens';
import { useSession } from '@/hooks/use-session';
import { authErrorMessage } from '@/lib/auth-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const RESEND_SECONDS = 45;

/**
 * O par de `/link-phone`: cadastra **e-mail e senha** numa conta que só tem WhatsApp.
 *
 * ## Por que existe
 *
 * O produto tem duas portas de entrada e elas eram de mão única. Quem criou a conta por Phone OTP
 * ficava preso ao WhatsApp — perdeu o número, perdeu a conta —, e quem criou por e-mail já podia
 * acrescentar o telefone (`/link-phone`) mas não o contrário. As duas portas agora abrem dos dois
 * lados. Também serve para TROCAR o endereço de quem já tem e-mail.
 *
 * ## A senha vem antes do código, e isso é de propósito
 *
 * Mesma lição da `forgot-password`: o formulário pede a senha nova ANTES de verificar o código,
 * e `verifyOtp` + `updateUser({ password })` rodam na MESMA função assíncrona. Pedir a senha
 * depois seria uma segunda etapa separada por um `await` que pode mudar a sessão embaixo da tela.
 *
 * ## `updateUser`, nunca `signUp`
 *
 * `signUp` criaria uma conta NOVA e deixaria a do WhatsApp para trás, com os dados dentro.
 * `updateUser({ email })` guarda a tentativa em `email_change` e só `verifyOtp(type:
 * 'email_change')` a confirma — a conta é a mesma, o workspace é o mesmo.
 *
 * ⚠️ Esse fluxo usa o template `email_change`, **não** o `confirmation`. Ele está declarado em
 * `supabase/hosted/supabase/config.toml`; sem isso o Supabase manda o padrão, com
 * `{{ .ConfirmationURL }}` — um link, para um app que só sabe código.
 */
const schema = z
  .object({
    email: z.string().trim().email('Esse e-mail não parece válido'),
    password: z.string().min(8, 'Pelo menos 8 caracteres'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'As senhas não batem',
  });

type FormValues = z.infer<typeof schema>;

export default function LinkEmailScreen() {
  const { session } = useSession();
  const toast = useToast();
  const emailAtual = session?.user.email ?? null;

  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [enviadoPara, setEnviadoPara] = useState('');
  const [senha, setSenha] = useState('');

  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', confirm: '' },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const pedirCodigo = handleSubmit(async (values) => {
    if (busy || !isSupabaseConfigured) return;
    setBusy(true);
    setError(null);

    const { error: falha } = await supabase.auth.updateUser({ email: values.email });

    setBusy(false);
    if (falha) {
      setError(authErrorMessage(falha));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // A senha fica em memória até a confirmação: ela só pode ser gravada DEPOIS do código, senão
    // um e-mail errado deixaria a conta com uma senha que ninguém pediu.
    setSenha(values.password);
    setEnviadoPara(values.email);
    setCode('');
    setStep('code');
    setCooldown(RESEND_SECONDS);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  });

  const reenviar = async () => {
    if (busy || cooldown > 0 || !enviadoPara) return;
    setBusy(true);
    setError(null);
    const { error: falha } = await supabase.auth.resend({
      type: 'email_change',
      email: enviadoPara,
    });
    setBusy(false);
    if (falha) {
      setError(authErrorMessage(falha));
      return;
    }
    setCooldown(RESEND_SECONDS);
  };

  const confirmar = async (submetido?: string) => {
    const token = submetido ?? code;
    if (token.length < 6 || busy) return;

    setBusy(true);
    setError(null);

    /*
      Os dois `await` na MESMA função, sem `setState` entre eles: `verifyOtp` devolve a sessão
      atualizada e é ela que autoriza o `updateUser` da senha. Separar em duas etapas de tela
      deixaria a janela em que o e-mail já mudou e a senha ainda não existe — a pessoa não
      conseguiria entrar por nenhuma das duas portas.
    */
    const { error: falhaCodigo } = await supabase.auth.verifyOtp({
      email: enviadoPara,
      token,
      type: 'email_change',
    });

    if (falhaCodigo) {
      setBusy(false);
      setError(authErrorMessage(falhaCodigo));
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const { error: falhaSenha } = await supabase.auth.updateUser({ password: senha });

    setBusy(false);
    if (falhaSenha) {
      // O e-mail JÁ está vinculado neste ponto — dizer só "deu erro" faria a pessoa repetir o
      // fluxo inteiro. A saída é a recuperação de senha, que agora funciona para este endereço.
      setError(
        `${authErrorMessage(falhaSenha)} O e-mail já está vinculado: use "Esqueci minha senha" para definir uma.`
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({
      message: emailAtual ? 'E-mail da conta trocado.' : 'E-mail e senha cadastrados.',
      tone: 'success',
    });
    router.back();
  };

  return (
    <AuthScreen
      showBrand={false}
      footer={
        <>
          <Button
            label={step === 'form' ? 'Enviar código' : 'Confirmar e-mail'}
            onPress={step === 'form' ? () => pedirCodigo() : () => confirmar()}
            loading={busy}
            disabled={step === 'form' ? !isSupabaseConfigured : code.length < 6}
            size="lg"
            block
          />
          <Button
            label={step === 'form' ? 'Cancelar' : 'Trocar e-mail'}
            variant="ghost"
            onPress={
              step === 'form'
                ? () => router.back()
                : () => {
                    setStep('form');
                    setCode('');
                    setError(null);
                    setCooldown(0);
                  }
            }
            disabled={busy}
            block
          />
        </>
      }>
      {step === 'form' ? (
        <Animated.View
          key="form"
          entering={FadeInLeft.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">
              {emailAtual ? 'Trocar o e-mail' : 'Cadastrar e-mail e senha'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {emailAtual
                ? `Hoje sua conta usa ${emailAtual}. O novo endereço só entra depois do código.`
                : 'Depois disso você entra pelos dois caminhos — e não fica preso ao WhatsApp se perder o número.'}
            </ThemedText>
          </View>

          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <Field label="E-mail" error={errors.email?.message ?? error ?? undefined}>
                <TextField
                  value={field.value}
                  onChangeText={(texto: string) => {
                    field.onChange(texto);
                    if (error) setError(null);
                  }}
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
                  autoFocus
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
                  onSubmitEditing={() => pedirCodigo()}
                  invalid={!!errors.confirm}
                  editable={!busy}
                />
              </Field>
            )}
          />

          <Note icon="lock">
            Seu WhatsApp continua ligado à conta. Isto acrescenta um segundo jeito de entrar.
          </Note>
        </Animated.View>
      ) : (
        <Animated.View
          key="code"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">Confira seu e-mail</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Mandamos um código de 6 dígitos para {enviadoPara}.
            </ThemedText>
          </View>

          <Field label="Código" error={error ?? undefined}>
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                if (error) setError(null);
              }}
              onComplete={(next) => confirmar(next)}
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
                onPress={reenviar}
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
  noteText: { flex: 1 },
});
