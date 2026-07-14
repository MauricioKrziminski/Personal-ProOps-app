import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

// Login por Phone OTP: o telefone verificado é a mesma chave que vincula o WhatsApp.
export function LoginScreen() {
  const theme = useTheme();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const e164 = phone.startsWith('+') ? phone : `+55${phone.replace(/\D/g, '')}`;
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('code');
  };

  const verifyCode = async () => {
    setBusy(true);
    setError(null);
    const e164 = phone.startsWith('+') ? phone : `+55${phone.replace(/\D/g, '')}`;
    const { error: err } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    setBusy(false);
    if (err) {
      setError(err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    // sucesso: onAuthStateChange troca a tela automaticamente
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Animated.View entering={FadeInUp.duration(600)} style={styles.hero}>
          <ThemedText type="title">ProOps</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.tagline}>
            Suas notas, lembretes e gastos.{'\n'}Direto do WhatsApp.
          </ThemedText>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(600).delay(150)} style={styles.formWrap}>
          <GlassCard style={styles.card}>
            {step === 'phone' ? (
              <>
                <ThemedText type="smallBold">Seu WhatsApp</ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  placeholder="(11) 99999-9999"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  value={phone}
                  onChangeText={setPhone}
                />
              </>
            ) : (
              <>
                <ThemedText type="smallBold">Código enviado por SMS</ThemedText>
                <TextInput
                  style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                  placeholder="000000"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  value={code}
                  onChangeText={setCode}
                />
              </>
            )}

            {error && (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            )}
            {!isSupabaseConfigured && (
              <ThemedText type="small" themeColor="textSecondary">
                Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env para
                ativar o login.
              </ThemedText>
            )}

            <Pressable
              disabled={busy}
              onPress={step === 'phone' ? sendCode : verifyCode}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.tint },
                pressed && styles.pressed,
              ]}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText type="smallBold" style={styles.buttonText}>
                  {step === 'phone' ? 'Receber código' : 'Entrar'}
                </ThemedText>
              )}
            </Pressable>

            {step === 'code' && (
              <Pressable onPress={() => setStep('phone')}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.backLink}>
                  Usar outro número
                </ThemedText>
              </Pressable>
            )}
          </GlassCard>
        </Animated.View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.five,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  tagline: {
    textAlign: 'center',
  },
  formWrap: {
    alignSelf: 'stretch',
  },
  card: {
    gap: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    fontSize: 18,
    fontFamily: Fonts.rounded,
  },
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.8,
  },
  backLink: {
    textAlign: 'center',
  },
});
