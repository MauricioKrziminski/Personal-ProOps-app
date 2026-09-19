import { createNativeQueryFocusHandler } from '@/lib/query-invalidation';
import { useEffect, useRef } from 'react';
import { MartianMono_400Regular } from '@expo-google-fonts/martian-mono';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_400Regular_Italic,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_600SemiBold_Italic,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_700Bold_Italic,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import simbolosAndroid from 'expo-symbols/androidWeights/regular';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { EntradaProvider } from '@/components/motion/entrada';
import { CortinaProvider, useCortina } from '@/components/motion/session-curtain';
import { FlightProvider } from '@/components/motion/flight-layer';
import { LockOverlay } from '@/components/ui/lock-overlay';
import { LockProvider, useLock } from '@/hooks/use-lock';
import { AndroidActionSheet } from '@/components/ui/action-sheet';
import { stackHeaderFonts } from '@/components/ui/app-header';
import { IOS_26_OU_MAIS } from '@/constants/platform';
import { ConcealProvider } from '@/components/ui/conceal';
import { ToastProvider } from '@/components/ui/toast';
import { AppUpdateProvider } from '@/hooks/use-app-update';
import { ThemeProvider as AppThemeProvider, useBarStyle, useScheme } from '@/hooks/use-theme';
import { SessionProvider, useSession } from '@/hooks/use-session';
import { hasCompletedOnboarding } from '@/lib/onboarding';
import { attachNotificationListeners, configureNotificationHandler } from '@/lib/notifications';

SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

/**
 * As telas de conta: sem header, barra de status clara sobre a capa de tinta, e passagem em
 * `fade` entre elas — a capa é a mesma nas quatro, e um deslize a faria correr de lado.
 */
const contaOptions = {
  headerShown: false,
  animation: 'fade' as const,
  statusBarStyle: Platform.OS === 'android' ? ('light' as const) : undefined,
};

/**
 * Os formulários modais. No iOS a apresentação é o sheet nativo; no Android `modal` é uma tela
 * cheia que entraria de lado como um detalhe, e a tarefa precisa ler como algo que SOBE sobre a
 * tela (a mesma leitura do sheet).
 */
const modalOptions = {
  presentation: 'modal' as const,
  headerShown: false,
  animation: Platform.OS === 'android' ? ('slide_from_bottom' as const) : undefined,
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Antes não havia opção default nenhuma: cada foco/mount podia refazer todas as RPCs.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: Platform.OS === 'web',
    },
  },
});


/**
 * O provider de tema envolve TUDO, e por isso a árvore do app mora num componente separado:
 * `useScheme()` e `useBarStyle()` só existem dentro dele.
 */
export default function RootLayout() {
  return (
    /*
      `GestureHandlerRootView` envolve TUDO, e é requisito do `react-native-gesture-handler`:
      sem ele nenhum `GestureDetector` recebe evento no Android — **sem erro, sem aviso, sem log**.
      O expo-router não o monta (só a pilha JS dele, que este app não usa: a navegação é nativa
      por `react-native-screens`), então a raiz é nossa.

      Por fora do `AppThemeProvider` porque ele não depende de tema nenhum, e porque a raiz de
      gesto precisa ser o ancestral comum de qualquer coisa que arraste — hoje a grade de pastas
      e a lista de notas, amanhã o que vier.
    */
    <GestureHandlerRootView>
      <AppThemeProvider>
        {/*
          Tema → cortina (a camada usa tema) → sessão (o portão usa a cortina) → árvore. O efeito
          que limpa o cache do TanStack na troca de usuário lê a sessão MOSTRADA, que só muda com
          a cortina fechada.
        */}
        <CortinaProvider>
          <SessionProvider>
            <AppTree />
          </SessionProvider>
        </CortinaProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Diz à abertura quando revelar: fontes e sessão prontas, e a trava resolvida.
 *
 * Com a trava ligada a abertura SEGURA a marca enquanto o sistema pede a senha — desbloqueou, a
 * tinta sobe direto no app (a mesma passagem de quem abre sem senha); cancelou, ela revela a
 * trava, que tem o "tentar de novo". Pedido do dono do produto, 17/09/2026.
 */
function AvisoDaAbertura({ pronto, temSessao }: { pronto: boolean; temSessao: boolean }) {
  const cortina = useCortina();
  const { carregando, locked, estado } = useLock();
  useEffect(() => {
    if (!pronto || carregando) return;
    if (temSessao && locked && estado !== 'falhou') cortina.segurarAbertura();
    else cortina.marcarPronto(temSessao ? 'app' : 'conta');
  }, [pronto, carregando, temSessao, locked, estado, cortina]);
  return null;
}

function AppTree() {
  const scheme = useScheme();
  const pathname = usePathname();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const handleState = createNativeQueryFocusHandler(queryClient, AppState.currentState);
    const subscription = AppState.addEventListener('change', (state) => {
      void handleState(state);
    });
    return () => subscription.remove();
  }, []);

  // Tabs/stacks can keep screens mounted. Re-entering a route is not a query mount.
  useEffect(() => {
    void queryClient.refetchQueries({ type: 'active', stale: true });
  }, [pathname]);

  // Tocar numa notificação precisa levar a algum lugar — inclusive em cold start.
  useEffect(attachNotificationListeners, []);

  /**
   * A família do design (Plus Jakarta Sans) e a mono do código inline das notas.
   *
   * O app segura o splash até carregarem: `Type` aponta para as faces pelo NOME, e uma face
   * ausente não cai no system font — ela some, deixando a tela em branco por um frame.
   */
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_400Regular_Italic,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_600SemiBold_Italic,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_700Bold_Italic,
    MartianMono_400Regular,
    /*
      No Android o ícone é TEXTO na fonte Material Symbols, e o `SymbolView` só carrega essa fonte
      quando monta — até lá ele desenha uma caixa vazia. Numa tela com dez linhas, os chips ficavam
      vazios por alguns segundos e os ícones "pipocavam" depois. Carregada aqui, junto das outras,
      ela já existe quando a primeira tela aparece. É o mesmo nome que o `expo-symbols` usa, então
      o `loadAsync` dele encontra a fonte pronta.
    */
    ...(Platform.OS === 'android' ? { [simbolosAndroid.name]: simbolosAndroid.font } : {}),
  });

  const { session, loading } = useSession();
  const pronto = !loading && (fontsLoaded || !!fontError);
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (loading) return;
    const user = session?.user.id ?? null;
    if (previousUser.current !== undefined && previousUser.current !== user) {
      queryClient.clear();
    }
    previousUser.current = user;
  }, [loading, session?.user.id]);
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
          {/*
            A trava fica ACIMA do `<Stack>` e DENTRO dos providers (precisa de `useTheme` e de
            `useSafeAreaInsets`). Fica abaixo da cortina de sessão (900 < 1000), pelo mesmo
            motivo dela: é um overlay sobre o app inteiro, não uma rota — rota tem "voltar", e
            voltar de uma tela de bloqueio é a própria falha.
          */}
          <LockProvider>
          <AvisoDaAbertura pronto={pronto} temSessao={!!session} />
          <EntradaProvider>
          <ToastProvider>
            <AppUpdateProvider>
              <LockOverlay />
              <AndroidActionSheet />
              {/*
                ⚠️ **Nada de tela antes de as fontes existirem** (16/09/2026). A árvore montava assim
                que a sessão resolvia, e o Android mede cada texto na primeira vez que o vê: medido
                com a fonte substituta (mais estreita) e desenhado depois com o Jost, "Trocar o
                valor" virava "Trocar o" — o resto cortado, sem erro, e em faces diferentes a cada
                recarregamento. A abertura cobre a tela nesse intervalo, então esperar não custa um
                quadro visível. Com erro de fonte, segue: texto na fonte do sistema é melhor que app
                parado.
              */}
              {loading || !(fontsLoaded || fontError) ? null : (
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
                {/* A camada do voo do cartão mora ao lado do `<Stack>`, acima das telas (800). */}
                <FlightProvider>
                <Stack
                  screenOptions={{
                    statusBarStyle: Platform.OS === 'android' ? statusBarStyle : undefined,
                    /*
                      As duas opções abaixo vieram das pilhas de aba quando as 23 telas de detalhe
                      migraram para cá (07/09/2026). Sem elas:

                      - `headerShadowVisible` volta ao padrão e reaparece a sombra sob o header,
                        que o design nunca teve;
                      - no iOS o botão "voltar" carrega o TÍTULO da tela anterior, e a anterior
                        agora é uma raiz de aba com `headerShown: false` — sem título. O sistema
                        cai no nome da ROTA e o botão passaria a dizer "(tabs)". `minimal` é só o
                        chevron, que é o que estas telas precisam. (No Android é ignorado.)
                    */
                    headerShadowVisible: false,
                    /*
                      ⚠️ **Header translúcido desde o PRIMEIRO quadro no iOS 26 — é o que impede o
                      app de travar** (19/09/2026). No iOS ≥ 26 o `react-native-screens` embrulha
                      toda tela de header opaco num `SafeAreaView` de topo, e o `expo-router` só
                      torna o header translúcido quando a tela declara título grande ou busca — pelo
                      `<Stack.Screen options>` de DENTRO dela, ou seja, depois do primeiro commit. A
                      tela nascia opaca e virava translúcida no meio da transição; o
                      `UINavigationController` reajustava o inset do scroll, o `SafeAreaView` e o
                      `RNSScreenState` recomitavam, e o ciclo não parava: main thread a 100% e
                      `ShadowTree::commit` estourando `attempts < 1024` (abort no Debug; no Release o
                      app congela e o watchdog mata). Medido no simulador: 5 de 6 aberturas de
                      Orçamentos, Projeção, Patrimônio e Lançamentos travavam; com esta linha, 0 de 24.

                      Com a translucidez constante, o conteúdo corre por baixo do vidro e o inset vem
                      do próprio scroll (`contentInsetAdjustmentBehavior="automatic"`, que o
                      `Screen` usa). Tela empurrada cuja raiz não é scroll precisa somar
                      `useHeaderHeight()` — ver `ConversationWorkspace`. Abaixo do iOS 26 o
                      `SafeAreaView` não existe, e translúcido lá seria só perder o fundo da barra.
                      Nenhuma tela pode sobrescrever com `headerTransparent: false`
                      (`anti-slop.test.ts`).
                    */
                    headerTransparent: IOS_26_OU_MAIS,
                    headerBackButtonDisplayMode: 'minimal',
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
                {/*
                  As telas de conta têm a capa de tinta no topo nos dois temas: a barra de status é
                  CLARA nelas. No Android quem manda é a opção da tela (a declaração da raiz vale
                  para o resto); no iOS, o `StatusBar` que o `AuthScreen` monta.
                */}
                <Stack.Protected guard={!session}>
                  <Stack.Screen name="login" options={contaOptions} />
                  <Stack.Screen name="login-whatsapp" options={contaOptions} />
                  <Stack.Screen name="signup" options={contaOptions} />
                  {/*
                    A recuperação mora NO portão de conta (19/09/2026): o código e a senha nova
                    rodam num cliente descartável, que não grava sessão nenhuma; só depois da troca
                    a sessão chega ao cliente principal, como num login. Aí o portão fecha esta tela
                    e abre o app — e `back` nunca volta para ela.
                  */}
                  <Stack.Screen name="forgot-password" options={contaOptions} />
                </Stack.Protected>

                <Stack.Protected guard={!!session && !hasCompletedOnboarding(session.user.user_metadata)}>
                  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                </Stack.Protected>
                <Stack.Protected guard={!!session && hasCompletedOnboarding(session.user.user_metadata)}>
                  {/* As cinco raízes de aba. Elas desenham o `AppHeader` por conta própria. */}
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

                  {/*
                    ⚠️ **Toda tela SECUNDÁRIA mora aqui, não dentro de `(tabs)`** (07/09/2026).

                    Enquanto elas eram pilhas aninhadas nas abas, a tab bar continuava visível por
                    baixo: a dock aparecia dentro da conversa do agente, da fatura, do editor de
                    nota. Não há como escondê-la tela a tela — no iOS a `NativeTabs` É a barra do
                    sistema —, e o padrão que a doc do Expo documenta para "detail screen overlays
                    the tab bar" é este: a rota de detalhe entra no stack RAIZ, que fica acima do
                    grupo de abas.

                    A URL não mudou em nenhuma delas: `(tabs)` é um GRUPO e nunca entrou no
                    caminho, então `/finance/cards` continua `/finance/cards`.

                    O título vive AQUI porque aqui é onde o header é desenhado. Uma tela nova de
                    detalhe se registra nesta lista — se esquecer, ela aparece com o nome do
                    arquivo na barra.
                  */}
                  <Stack.Screen name="finance/transactions" options={{ title: 'Lançamentos' }} />
                  <Stack.Screen name="finance/cycle" options={{ title: 'Detalhe do ciclo' }} />
                  <Stack.Screen name="finance/[txId]" options={{ title: 'Lançamento' }} />
                  <Stack.Screen name="finance/accounts" options={{ title: 'Contas' }} />
                  <Stack.Screen name="finance/cards" options={{ title: 'Cartões' }} />
                  {/*
                    A fatura aberta pela Carteira entra em `fade`: o cartão chega voando por cima
                    (camada de voo) e pousa no topo dela. Por qualquer outro caminho, o push
                    normal da plataforma.
                  */}
                  <Stack.Screen
                    name="finance/invoice/[id]"
                    options={({ route }) => ({
                      title: 'Fatura',
                      animation: (route.params as { via?: string } | undefined)?.via === 'carteira' ? 'fade' : 'default',
                    })}
                  />
                  {/*
                    A Carteira entra e sai em `fade`, e a tela de baixo precisa CONTINUAR desenhada.

                    - **Android: modal transparente.** Como `push`, o Financeiro era desanexado
                      durante a Carteira e voltava esmaecendo do zero ao fechar — dois quadros de
                      tela vazia e a barra de abas surgindo do nada (medido em 17/09/2026). No
                      Android o modal mora no MESMO contêiner da pilha, então a camada de voo
                      continua por cima.
                    - **iOS: `push`.** Lá o modal transparente é apresentado ACIMA da raiz React e
                      esconderia o voo; o `fade` do iOS cruza as duas telas, sem vazio. O gesto
                      de voltar sai porque o fechar é o arraste para baixo.
                  */}
                  <Stack.Screen
                    name="finance/wallet"
                    options={{
                      headerShown: false,
                      animation: 'fade',
                      presentation: Platform.OS === 'android' ? 'transparentModal' : 'card',
                      gestureEnabled: Platform.OS !== 'ios',
                    }}
                  />
                  <Stack.Screen name="finance/invoices" options={{ title: 'Faturas' }} />
                  <Stack.Screen name="finance/installments" options={{ title: 'Parceladas' }} />
                  <Stack.Screen name="finance/budgets" options={{ title: 'Orçamentos' }} />
                  <Stack.Screen name="finance/goals" options={{ title: 'Metas' }} />
                  <Stack.Screen name="finance/debts" options={{ title: 'Dívidas' }} />
                  <Stack.Screen name="finance/recurring" options={{ title: 'Recorrentes' }} />
                  <Stack.Screen name="finance/forecast" options={{ title: 'Projeção' }} />
                  <Stack.Screen name="finance/reports" options={{ title: 'Relatórios' }} />
                  <Stack.Screen name="finance/net-worth" options={{ title: 'Patrimônio' }} />
                  <Stack.Screen name="finance/rules" options={{ title: 'Regras' }} />
                  <Stack.Screen name="finance/manage" options={{ title: 'Gerenciar' }} />
                  <Stack.Screen name="finance/plan" options={{ title: 'Plano' }} />

                  {/* Sem título: o da nota é o conteúdo dela, e um provisório faria a barra
                      trocar de texto na frente do usuário. */}
                  <Stack.Screen name="notes/[id]" options={{ title: '' }} />
                  <Stack.Screen name="notes/folders" options={{ title: 'Organizar pastas' }} />
                  {/* O título vem da TELA (`Stack.Screen` interno): é o nome da pasta. */}
                  <Stack.Screen name="notes/folder/[id]" options={{ title: 'Pasta' }} />
                  <Stack.Screen name="notes/archived" options={{ title: 'Arquivadas' }} />
                  <Stack.Screen name="notes/trash" options={{ title: 'Lixeira' }} />

                  <Stack.Screen name="profile/members" options={{ title: 'Pessoas' }} />
                  <Stack.Screen name="profile/alerts" options={{ title: 'Histórico de alertas' }} />

                  {/* Mesma regra do `notes/[id]`: em `new` o conteúdo é o campo vazio, e em
                      `[id]` o nome da conversa só é conhecido depois da query. */}
                  <Stack.Screen name="agent/new" options={{ title: '' }} />
                  <Stack.Screen name="agent/[id]" options={{ title: '' }} />
                  <Stack.Screen name="agent/history" options={{ title: 'Histórico' }} />

                  {/*
                    Atenção total: formulário com etapas vive acima das abas.

                    ⚠️ **`headerShown: false` — o cabeçalho é o `TaskHeader`, no conteúdo.**
                    `react-native-screens` (`ScreenStackHeaderConfig.kt:374-382`) roda
                    `toolbar.title = null` sempre que existe um subview LEFT customizado, e o ✕
                    era exatamente isso: no Android estas três telas renderizavam SEM TÍTULO —
                    "Novo lançamento" e "Editar lançamento" eram a mesma tela na tela. O
                    `modalOptions` que morava aqui também era o único pedaço de chrome do app sem
                    um token de espaço (um `<Pressable hitSlop={12}>` cru), que era a queixa
                    literal do dono do produto sobre o título colado no botão de fechar.
                  */}
                  <Stack.Screen
                    name="finance/transaction-form"
                    options={modalOptions}
                  />
                  <Stack.Screen
                    name="reminder-form"
                    options={modalOptions}
                  />
                  <Stack.Screen name="reminders" options={{ title: 'Lembretes' }} />
                  <Stack.Screen name="search" options={{ title: 'Buscar' }} />
                <Stack.Screen name="import" options={{ title: 'Importar extrato' }} />
                <Stack.Screen name="import-history" options={{ title: 'Importações' }} />
                  {/* Paywall é modal fechável SEMPRE: paywall que não fecha é reprovação na App Review. */}
                  <Stack.Screen
                    name="paywall"
                    options={modalOptions}
                  />
                  <Stack.Screen name="link-phone" options={{ headerShown: false }} />
                  {/* O par de `link-phone`: cadastra e-mail e senha numa conta que só tem
                      WhatsApp, ou troca o endereço de quem já tem. As duas portas do produto
                      passaram a abrir dos dois lados. */}
                  <Stack.Screen name="link-email" options={{ headerShown: false }} />
                  <Stack.Screen name="catalog" options={{ title: 'Catálogo' }} />
                </Stack.Protected>
              </Stack>
              </FlightProvider>
            </>
              )}
            </AppUpdateProvider>
          </ToastProvider>
          </EntradaProvider>
          </LockProvider>
          </ConcealProvider>
        </KeyboardProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
