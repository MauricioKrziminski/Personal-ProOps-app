import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
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

type PushState = 'unknown' | 'off' | 'on' | 'saving' | 'error';

function usePushToken(userId: string | undefined) {
  const [state, setState] = useState<PushState>('unknown');

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('expo_push_token')
      .eq('id', userId)
      .single()
      .then(({ data }) => setState(data?.expo_push_token ? 'on' : 'off'));
  }, [userId]);

  const enable = async () => {
    if (!userId) return;
    setState('saving');
    try {
      if (!Device.isDevice) throw new Error('push só funciona em aparelho físico');
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') throw new Error('permissão negada');
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
        .data;
      const { error } = await supabase
        .from('profiles')
        .update({ expo_push_token: token })
        .eq('id', userId);
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setState('on');
    } catch (err) {
      console.error('push register:', err);
      setState('error');
    }
  };

  return { state, enable };
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const phone = session?.user.phone ? `+${session.user.phone}` : '—';
  const push = usePushToken(session?.user.id);

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
              É por esse número que suas mensagens viram notas, lembretes e lançamentos.
            </ThemedText>
          </GlassCard>

          <GlassCard style={styles.card}>
            <ThemedText type="smallBold">🔔 Notificações push</ThemedText>
            {push.state === 'on' ? (
              <ThemedText type="small" themeColor="textSecondary">
                ✅ Ativadas — seus lembretes chegam por push, de graça.
              </ThemedText>
            ) : (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  Receba seus lembretes por push gratuitamente, além do WhatsApp.
                </ThemedText>
                <Pressable
                  onPress={push.enable}
                  disabled={push.state === 'saving'}
                  style={({ pressed }) => [
                    styles.enableButton,
                    { backgroundColor: theme.tint, opacity: pressed || push.state === 'saving' ? 0.7 : 1 },
                  ]}>
                  <ThemedText type="smallBold" style={styles.enableLabel}>
                    {push.state === 'saving' ? 'Ativando…' : 'Ativar notificações'}
                  </ThemedText>
                </Pressable>
                {push.state === 'error' && (
                  <ThemedText type="small" themeColor="danger">
                    Não deu para ativar (permissão negada ou emulador).
                  </ThemedText>
                )}
              </>
            )}
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
  enableButton: {
    marginTop: Spacing.one,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  enableLabel: {
    color: '#fff',
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
