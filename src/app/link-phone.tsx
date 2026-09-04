import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';

import { AuthScreen } from '@/components/auth/auth-screen';
import { OtpInput } from '@/components/auth/otp-input';
import { PhoneField } from '@/components/auth/phone-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { Motion, Space } from '@/design/tokens';
import { useSession } from '@/hooks/use-session';
import { authErrorMessage } from '@/lib/auth-errors';
import { displayPhoneBR, isValidPhoneBR, phoneDigits, toE164BR } from '@/lib/phone-br';
import { isExpectedPhoneLink } from '@/lib/phone-link';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const RESEND_SECONDS = 45;

/**
 * Vincula o WhatsApp a uma sessão que já existe por e-mail, ou troca o número atual.
 *
 * `updateUser({ phone })` não altera o telefone imediatamente: o Supabase guarda a tentativa em
 * `phone_change`. Só `verifyOtp(type: 'phone_change')` confirma e dispara a migration 0053, que
 * sincroniza o profile e aposenta a conversa antiga. Usar `signInWithOtp` aqui criaria/entraria
 * em outra conta em vez de adicionar o número à conta aberta.
 */
export default function LinkPhoneScreen() {
  const { session } = useSession();
  const toast = useToast();
  const currentPhone = session?.user.phone ?? null;
  const [phone, setPhone] = useState(() => phoneDigits(currentPhone ?? ''));
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const valid = isValidPhoneBR(phone);
  const sameAsCurrent = !!currentPhone && phoneDigits(currentPhone) === phoneDigits(phone);
  const canRequest = valid && !sameAsCurrent && isSupabaseConfigured;

  const requestCode = async (resend = false) => {
    if (!canRequest || busy) return;
    setBusy(true);
    setError(null);

    const target = toE164BR(phone);
    const { error: requestError } = resend
      ? await supabase.auth.resend({ type: 'phone_change', phone: target })
      : await supabase.auth.updateUser({ phone: target });

    setBusy(false);
    if (requestError) {
      setError(authErrorMessage(requestError));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCooldown(RESEND_SECONDS);
    if (!resend) {
      setCode('');
      setStep('code');
    }
  };

  const verifyCode = async (submitted?: string) => {
    const token = submitted ?? code;
    const expectedUserId = session?.user.id;
    if (!expectedUserId || token.length < 6 || busy) return;

    setBusy(true);
    setError(null);
    const target = toE164BR(phone);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      phone: target,
      token,
      type: 'phone_change',
    });

    if (verifyError) {
      setBusy(false);
      setError(authErrorMessage(verifyError));
      setCode('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    // Defesa em profundidade para o lookup de phone_change do GoTrue. A migration 0053 impede a
    // ambiguidade no banco; se o servidor ainda devolver outra identidade, ela nunca fica ativa.
    if (!isExpectedPhoneLink(data.user, expectedUserId, target)) {
      await supabase.auth.signOut({ scope: 'local' });
      setBusy(false);
      Alert.alert(
        'Vinculação interrompida',
        'A confirmação não voltou para a mesma conta. Entre novamente e tente de novo.'
      );
      return;
    }

    // Convite por telefone pode ter sido criado antes da conta por e-mail. É best-effort como no
    // login: o vínculo confirmado não deve ser desfeito só porque o plano do convidante lotou.
    const { error: inviteError } = await supabase.rpc('accept_pending_invites');
    if (inviteError) console.warn('accept_pending_invites depois de vincular telefone:', inviteError.message);

    setBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({
      message: currentPhone ? 'Número do WhatsApp trocado.' : 'WhatsApp conectado.',
      tone: 'success',
    });
    router.back();
  };

  const changeNumber = () => {
    setStep('phone');
    setCode('');
    setError(null);
    setCooldown(0);
  };

  const phoneHint = !isSupabaseConfigured
    ? 'Configure o Supabase no .env para continuar.'
    : sameAsCurrent
      ? 'Digite um número diferente do atual.'
      : undefined;

  return (
    <AuthScreen
      showBrand={false}
      footer={
        <>
          <Button
            label={step === 'phone' ? 'Enviar código' : 'Confirmar número'}
            onPress={step === 'phone' ? () => requestCode() : () => verifyCode()}
            loading={busy}
            disabled={step === 'phone' ? !canRequest : code.length < 6}
            size="lg"
            block
          />
          <Button
            label={step === 'phone' ? 'Cancelar' : 'Trocar número'}
            variant="ghost"
            onPress={step === 'phone' ? () => router.back() : changeNumber}
            disabled={busy}
            block
          />
        </>
      }>
      {step === 'phone' ? (
        <Animated.View
          key="phone"
          entering={FadeInLeft.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
          <View style={styles.copy}>
            <ThemedText type="title">
              {currentPhone ? 'Trocar o WhatsApp' : 'Conectar o WhatsApp'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {currentPhone
                ? `Hoje sua conta usa ${displayPhoneBR(currentPhone)}. O novo número só entra depois do código.`
                : 'Depois do código, o agente reconhece as mensagens enviadas por este número.'}
            </ThemedText>
          </View>

          <Field label="Número com DDD" error={error ?? undefined} hint={phoneHint}>
            <PhoneField
              value={phone}
              onChange={(text) => {
                setPhone(phoneDigits(text));
                if (error) setError(null);
              }}
              onSubmit={() => requestCode()}
              invalid={!!error}
              editable={!busy}
              autoFocus
            />
          </Field>

          <View style={styles.note}>
            <Icon name="bubble.left" size="sm" color="textSecondary" />
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.noteText}>
              O código de 6 dígitos chega pelo WhatsApp. Não compartilhe com ninguém.
            </ThemedText>
          </View>

          {currentPhone ? (
            <View style={styles.note}>
              <Icon name="exclamationmark.circle" size="sm" color="textSecondary" />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.noteText}>
                Confirmações e rascunhos pendentes da conversa anterior serão descartados.
              </ThemedText>
            </View>
          ) : null}
        </Animated.View>
      ) : (
        <Animated.View
          key="code"
          entering={FadeInRight.duration(Motion.duration.slow).easing(Motion.easing.out)}
          style={styles.step}>
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
  step: { gap: Space.xl },
  copy: { gap: Space.sm },
  note: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  noteText: { flex: 1 },
});
