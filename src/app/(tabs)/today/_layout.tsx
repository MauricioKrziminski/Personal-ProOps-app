import { Stack } from 'expo-router';

import { heroHeaderOptions } from '@/components/ui/hero-panel';
import { useTheme } from '@/hooks/use-theme';

/** Pilha da aba Hoje — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function TodayStackLayout() {
  const theme = useTheme();

  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      {/*
       * O cabeçalho veste a cor do painel de destaque.
       *
       * Com header branco em cima da faixa de tinta, o topo lia como duas superfícies coladas e
       * a costura entre elas era a primeira coisa que o olho achava — o painel parecia um bloco
       * no meio da tela, não o alto dela. Bancos que usam esse padrão pintam o cabeçalho junto.
       *
       * Fica no `_layout`, não na tela: é aqui que o header é declarado, e sobrescrever de
       * dentro do corpo depende de o `setOptions` ganhar do que o layout já fixou.
       */}
      <Stack.Screen
        name="index"
        options={{ title: 'Hoje', headerLargeTitle: true, ...heroHeaderOptions(theme) }}
      />
    </Stack>
  );
}
