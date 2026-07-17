import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { LoginScreen } from '@/components/login-screen';
import { useSession } from '@/hooks/use-session';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {loading ? null : session ? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="finance/transactions" />
            <Stack.Screen name="finance/goals" />
            <Stack.Screen name="finance/budgets" />
            <Stack.Screen name="finance/accounts" />
            <Stack.Screen name="finance/transaction-form" options={{ presentation: 'modal' }} />
          </Stack>
        ) : (
          <LoginScreen />
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
