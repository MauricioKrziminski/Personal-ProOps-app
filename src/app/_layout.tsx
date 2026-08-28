import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { ToastProvider } from '@/components/ui/toast';
import { useSession } from '@/hooks/use-session';

SplashScreen.preventAutoHideAsync();

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
  const { session, loading } = useSession();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <ToastProvider>
          <AnimatedSplashOverlay />
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
                <Stack.Screen name="catalog" options={{ title: 'Catálogo' }} />
              </Stack.Protected>
            </Stack>
          )}
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
