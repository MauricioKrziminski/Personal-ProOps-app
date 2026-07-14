import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass/glass-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const phone = session?.user.phone ? `+${session.user.phone}` : '—';

  const signOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await supabase.auth.signOut();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Perfil
        </ThemedText>

        <Animated.View entering={FadeInDown.duration(400)} style={styles.cards}>
          <GlassCard style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              WhatsApp vinculado
            </ThemedText>
            <ThemedText type="smallBold">{phone}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              É por esse número que suas mensagens viram notas, lembretes e gastos.
            </ThemedText>
          </GlassCard>

          <GlassCard style={styles.card}>
            <ThemedText type="smallBold">🔔 Notificações push</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Em breve: receba seus lembretes por push gratuitamente, além do WhatsApp.
            </ThemedText>
          </GlassCard>

          <Pressable
            onPress={signOut}
            style={({ pressed }) => [
              styles.signOut,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="danger">
              Sair da conta
            </ThemedText>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  heading: {
    paddingVertical: Spacing.three,
  },
  cards: {
    gap: Spacing.three,
  },
  card: {
    gap: Spacing.two,
  },
  signOut: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
