import { useEffect } from 'react';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_400Regular_Italic,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from '@expo-google-fonts/hanken-grotesk';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemedText } from '@/components/themed-text';
import { AndroidActionSheet } from '@/components/ui/action-sheet';
import { stackHeaderFonts } from '@/components/ui/app-header';
import { Icon } from '@/components/ui/icon';
import { ConcealProvider } from '@/components/ui/conceal';
import { ToastProvider } from '@/components/ui/toast';
import { AppUpdateProvider } from '@/hooks/use-app-update';
import { ThemeProvider as AppThemeProvider, useBarStyle, useScheme } from '@/hooks/use-theme';
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

/**
 * Modal precisa de saída explícita: arrastar para baixo não é descoberto nem acessível.
 *
 * A saída fala o idioma de cada plataforma. No Android o título do header é alinhado à esquerda,
 * então a palavra "Cancelar" colidia com ele — virava `CancelarNovo lançamento`. Lá a convenção
 * é o X, que ocupa a largura de um ícone e não disputa espaço com o título.
 */
const modalOptions = {
  headerLeft: () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cancelar"
      hitSlop={12}
      onPress={() => router.back()}>
      {Platform.OS === 'android' ? (
        <Icon name="xmark" size="lg" color="text" />
      ) : (
        <ThemedText type="default" themeColor="tint">
          Cancelar
        </ThemedText>
      )}
    </Pressable>
  ),
};

/**
 * O provider de tema envolve TUDO, e por isso a árvore do app mora num componente separado:
 * `useScheme()` e `useBarStyle()` só existem dentro dele.
 */
export default function RootLayout() {
  return (
    <AppThemeProvider>
      <AppTree />
    </AppThemeProvider>
  );
}

function AppTree() {
  const scheme = useScheme();

  // Tocar numa notificação precisa levar a algum lugar — inclusive em cold start.
  useEffect(attachNotificationListeners, []);

  /**
   * As duas famílias do design (Hanken Grotesk + JetBrains Mono).
   *
   * O app segura o splash até carregarem: `Type` aponta para as faces pelo NOME, e uma face
   * ausente não cai no system font — ela some, deixando a tela em branco por um frame.
   */
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_400Regular_Italic,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  const { session, loading } = useSession();
  const barStyle = useBarStyle();
  /**
   * A barra de status segue o TEMA e nada mais.
   *
   * Havia uma exceção para Hoje e Financeiro, de quando o painel de destaque sangrava até o topo
   * e o fundo atrás do relógio era sempre escuro. O painel virou card flutuante e o topo dessas
   * telas passou a ser o fundo normal do app — a exceção passou a forçar ícone claro sobre fundo
   * claro no tema light, que é o bug que ela existia para evitar.
   */
  const statusBarStyle = barStyle;

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* Requisito do `react-native-keyboard-controller`: sem o provider os componentes de
            teclado (o editor de nota) não recebem evento nenhum. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <ConcealProvider>
          <ToastProvider>
            <AppUpdateProvider>
              <AnimatedSplashOverlay ready={!loading && fontsLoaded} />
              <AndroidActionSheet />
              {loading ? null : (
              /*
               * `statusBarStyle` mora AQUI, e só aqui.
               *
               * No Android o padrão do `react-native-screens` é `light` — a doc é explícita:
               * "`auto` e `inverted` são suportados só no iOS; no Android caem para `light`".
               * Sem declarar nada, relógio e bateria saíam brancos sobre fundo branco no app
               * inteiro (invisível enquanto havia uma faixa branca cobrindo o topo).
               *
               * Por que a decisão sobe até a raiz em vez de ficar em cada tela: a `NativeTabs`
               * corta a coordenação do `react-native-screens` entre as pilhas, e a declaração da
               * pilha RAIZ ganha sempre. Medido no emulador — `statusBarStyle: 'light'` na pilha
               * da aba Hoje saiu ESCURO sobre o painel preto. E `setStatusBarStyle` no foco perde
               * a corrida com a opção nativa, que é reaplicada a cada troca de tela: voltando
               * pelo botão de voltar, o ícone ficava escuro no preto.
               *
               * Uma declaração só, no lugar que manda, é o que torna isto previsível.
               *
               * ⚠️ FURO CONHECIDO: **voltar** de uma subtela clara para a raiz de uma aba com
               * painel (Orçamentos → Financeiro) deixa o ícone escuro sobre o preto até trocar de
               * aba — na volta nada relê a config. Tentados e medidos sem sucesso:
               * `statusBarStyle` na pilha da aba, em `heroHeaderOptions`, `setStatusBarStyle` num
               * `useEffect` da raiz e num `useFocusEffect` da tela. Parece limitação da
               * `NativeTabs`; a próxima parada é o repo do `react-native-screens`, não mais uma
               * quinta declaração aqui.
               */
              <>
                <StatusBar style={statusBarStyle} />
                <Stack
                  screenOptions={{
                    statusBarStyle: Platform.OS === 'android' ? statusBarStyle : undefined,
                    ...stackHeaderFonts,
                  }}>
                  {/* `/` é a URL inicial: renderiza antes de qualquer guard, por isso fica FORA dos
                      `Stack.Protected` e decide o destino por conta própria. */}
                  <Stack.Screen name="index" options={{ headerShown: false }} />

                  {/* Vitrine de design com dados de exemplo — FORA do portão de sessão de
                      propósito: sem ela não há como olhar as telas sem o OTP do WhatsApp. Não
                      tem link em lugar nenhum; chega-se por `com.proops.personal://design-preview`. */}
                  <Stack.Screen name="design-preview" options={{ headerShown: false }} />

                {/* Porta de mão única nos dois sentidos: sem sessão só existe o login; com sessão
                  o login deixa de existir, então `back` nunca reentra nele. */}
                <Stack.Protected guard={!session}>
                  <Stack.Screen name="login" options={{ headerShown: false }} />
                  <Stack.Screen name="login-whatsapp" options={{ headerShown: false }} />
                  <Stack.Screen name="signup" options={{ headerShown: false }} />
                  <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
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
                <Stack.Screen name="import" options={{ title: 'Importar extrato' }} />
                <Stack.Screen name="import-history" options={{ title: 'Importações' }} />
                  {/* Paywall é modal fechável SEMPRE: paywall que não fecha é reprovação na App Review. */}
                  <Stack.Screen
                    name="paywall"
                    options={{ presentation: 'modal', title: 'Assinar', ...modalOptions }}
                  />
                  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                  <Stack.Screen name="catalog" options={{ title: 'Catálogo' }} />
                </Stack.Protected>
              </Stack>
            </>
              )}
            </AppUpdateProvider>
          </ToastProvider>
          </ConcealProvider>
        </KeyboardProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
