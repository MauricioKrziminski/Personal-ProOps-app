import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, useColorScheme } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { AndroidActionSheet } from '@/components/ui/action-sheet';
import { ToastProvider } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-session';
import { attachNotificationListeners, configureNotificationHandler } from '@/lib/notifications';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Antes não havia opção default nenhuma: cada foco/mount podia refazer todas as RPCs.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Modal precisa de saída explícita: arrastar para baixo não é descoberto nem acessível. */
const modalOptions = {
  headerLeft: () => (
    <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
      <ThemedText type="default" themeColor="tint">
        Cancelar
      </ThemedText>
    </Pressable>
  ),
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Tocar numa notificação precisa levar a algum lugar — inclusive em cold start.
  useEffect(attachNotificationListeners, []);

  const { session, loading } = useSession();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* Requisito do `react-native-keyboard-controller`: sem o provider os componentes de
            teclado (o editor de nota) não recebem evento nenhum. */}
        <KeyboardProvider>
          <ToastProvider>
            <AnimatedSplashOverlay />
          <AndroidActionSheet />
            {loading ? null : (
              <Stack>
                {/* Porta de mão única nos dois sentidos: sem sessão só existe o login; com sessão
                  o login deixa de existir, então `back` nunca reentra nele. */}
                <Stack.Protected guard={!session}>
                  <Stack.Screen name="login" options={{ headerShown: false }} />
                </Stack.Protected>

                <Stack.Protected guard={!!session}>
                  {/* O grupo de abas desenha os próprios headers nas pilhas aninhadas. */}
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

                  {/* Atenção total: formulário com etapas vive acima das abas. */}
                  <Stack.Screen
                    name="finance/transaction-form"
                    options={{ presentation: 'modal', title: 'Lançamento', ...modalOptions }}
                  />
                  <Stack.Screen
                    name="reminder-form"
                    options={{ presentation: 'modal', title: 'Lembrete', ...modalOptions }}
                  />
                  <Stack.Screen name="reminders" options={{ title: 'Lembretes' }} />
                  <Stack.Screen name="search" options={{ title: 'Buscar' }} />
                  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                  <Stack.Screen name="catalog" options={{ title: 'Catálogo' }} />
                </Stack.Protected>
              </Stack>
            )}
          </ToastProvider>
        </KeyboardProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
