import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';

import { AuthScreen } from '@/components/auth/auth-screen';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Field, TextField } from '@/components/ui/field';
import { Motion, Space } from '@/design/tokens';
import { authErrorMessage } from '@/lib/auth-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * Entrar com e-mail e senha — a porta principal desde 03/09/2026.
 *
 * O Phone OTP continua existindo em `/login-whatsapp` para quem já tem conta por telefone; o
 * link no rodapé leva até lá. Nada de migração forçada: os dois caminhos convivem.
 *
 * Dois campos e um botão. Validação mínima na tela (e-mail com "@", senha não vazia) — quem
 * decide se a combinação existe é o servidor, e a resposta dele não distingue "e-mail errado"
 * de "senha errada" de propósito (enumeração de conta).
 */
export function EmailLoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const valid = email.includes('@') && password.length > 0;

  const signIn = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    // Sucesso: `Stack.Protected` do layout raiz troca a tela.
  };

  // Atalho de desenvolvimento: entra como o usuário de teste (só em __DEV__).
  const devLogin = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: 'dev@proops.local',
      password: 'devtest123',
    });
    setBusy(false);
    if (err) setError(authErrorMessage(err));
  };

  return (
    <AuthScreen
      footer={
        <>
          <Button label="Entrar" onPress={signIn} loading={busy} disabled={!valid} size="lg" block />
          <Button
            label="Criar conta"
            variant="ghost"
            onPress={() => router.push('/signup')}
            disabled={busy}
            block
          />
          {__DEV__ && (
            <Button label="Entrar como teste (dev)" variant="ghost" size="sm" onPress={devLogin} block />
          )}
        </>
      }>
      <Animated.View
        entering={FadeInLeft.duration(Motion.duration.slow).easing(Motion.easing.out)}
        style={styles.step}>
        <View style={styles.copy}>
          <ThemedText type="title">Entrar</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Suas notas, lembretes e gastos, organizados num lugar só.
          </ThemedText>
        </View>

        <Field
          label="E-mail"
          hint={
            isSupabaseConfigured
              ? undefined
              : 'Configure EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env.'
          }>
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
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!busy}
            invalid={!!error}
          />
        </Field>

        <Field label="Senha" error={error ?? undefined}>
          <TextField
            ref={passwordRef}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              if (error) setError(null);
            }}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={signIn}
            editable={!busy}
            invalid={!!error}
          />
        </Field>

        <View style={styles.links}>
          <Button
            label="Esqueci minha senha"
            variant="ghost"
            size="sm"
            onPress={() => router.push('/forgot-password')}
            disabled={busy}
          />
          <Button
            label="Entrar com o WhatsApp"
            variant="ghost"
            size="sm"
            icon="bubble.left"
            onPress={() => router.push('/login-whatsapp')}
            disabled={busy}
          />
        </View>
      </Animated.View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  step: { gap: Space.xl },
  copy: { gap: Space.sm },
  /** Cancela o padding da pílula: o rótulo do ghost alinha com o campo acima. */
  links: { alignItems: 'flex-start', marginLeft: -Space.md },
});
