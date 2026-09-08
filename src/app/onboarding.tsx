import { useState } from 'react';
import { Stack, router } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';

import { AlertPreferencesSection } from '@/components/profile/alert-preferences-section';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { useToast } from '@/components/ui/toast';
import { Space, Radius, Type } from '@/design/tokens';
import { useProfile, useUpdateProfile } from '@/hooks/use-profile';
import { useSession } from '@/hooks/use-session';
import { useTheme, useThemeMode, type ThemeMode } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function OnboardingScreen() {
  const { session } = useSession();
  const userId = session?.user.id;
  const profile = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const finish = async () => {
    if (!userId || saving) return;
    setSaving(true);
    try {
      if (name !== null) await updateProfile.mutateAsync({ display_name: name.trim() || null });
      // Presentation preference only: never use editable metadata for access control.
      const { error } = await supabase.auth.updateUser({
        data: { onboarding_completed: true },
      });
      if (error) throw error;
      router.replace('/');
    } catch {
      toast({ message: 'Não deu para salvar. Tente novamente.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen contentStyle={styles.content}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.intro}>
        <ThemedText type="title">Seu app, do seu jeito</ThemedText>
        <ThemedText themeColor="textSecondary">
          Escolha como prefere começar. Você pode mudar tudo depois no Perfil.
        </ThemedText>
      </View>
      <View style={styles.intro}>
        <ThemedText type="subtitle">Como podemos te chamar?</ThemedText>
        <TextInput
          accessibilityLabel="Seu nome (opcional)"
          placeholder="Seu nome (opcional)"
          placeholderTextColor={theme.textSecondary}
          value={name ?? profile.data?.display_name ?? ''}
          onChangeText={setName}
          maxLength={100}
          editable={!saving && !profile.isLoading && !profile.isError}
          autoCapitalize="words"
          style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        />
      </View>
      <Section title="Aparência">
        {([['system', 'Seguir o aparelho'], ['light', 'Claro'], ['dark', 'Escuro']] as const).map(([value, label]) => (
          <Row key={value} title={label} chevron={false}
            accessibilityState={{ selected: mode === value }}
            trailing={mode === value ? <ThemedText>✓</ThemedText> : undefined}
            onPress={() => setMode(value as ThemeMode)} />
        ))}
      </Section>
      <AlertPreferencesSection userId={userId} hasVerifiedPhone={!!session?.user.phone_confirmed_at} showHistory={false} />
      <ThemedText type="small" themeColor="textSecondary">
        Os avisos financeiros são opcionais. Seus lembretes continuam com os canais que você escolher em cada um.
      </ThemedText>
      <Button label="Começar a usar" onPress={finish} loading={saving} block />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: Space.xl, paddingTop: Space.xxxl, paddingBottom: Space.xxxl },
  intro: { gap: Space.sm },
  input: { borderWidth: 1, borderRadius: Radius.md, padding: Space.md, ...Type.body, minHeight: 48 },
});
