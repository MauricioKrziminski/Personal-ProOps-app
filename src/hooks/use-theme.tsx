import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

/** O que o usuário escolheu — não o que está na tela. `system` segue o aparelho. */
export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme-mode';

interface ThemeState {
  /** A escolha do usuário. */
  mode: ThemeMode;
  /** O que está VALENDO agora — `system` já resolvido. */
  scheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
}

const Ctx = createContext<ThemeState>({ mode: 'system', scheme: 'dark', setMode: () => {} });

/**
 * O tema do app, com escolha explícita do usuário.
 *
 * Ele esteve **travado em dark** entre 02/09 e 03/09/2026, porque o desenho do Stitch é OLED e o
 * modo claro o desmontava. Travar resolveu a tela e cobrou caro: metade da paleta ficou sem
 * ninguém olhando, e "verificar em light e dark" — que é item de checklist do projeto — deixou de
 * fazer sentido. A escolha volta para quem usa o app.
 *
 * `system` é o padrão porque é o que a plataforma espera e o que a maioria das pessoas quer; as
 * outras duas existem para quem tem preferência forte, que em app de finanças é comum (muita
 * gente confere saldo no escuro).
 *
 * A preferência é gravada no `AsyncStorage`, e **antes de ela carregar o app usa o esquema do
 * sistema** em vez de um padrão fixo: assim não há flash de tema errado em quem já escolheu igual
 * ao aparelho, que é o caso mais comum.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (vivo && (raw === 'light' || raw === 'dark' || raw === 'system')) setModeState(raw);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const scheme: 'light' | 'dark' = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;

  const value = useMemo(() => ({ mode, scheme, setMode }), [mode, scheme, setMode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** A paleta que vale agora. É o caminho único para cor em tela. */
export function useTheme() {
  return Colors[useContext(Ctx).scheme];
}

/** A escolha do usuário e como mudá-la — só a tela de Perfil precisa disto. */
export function useThemeMode() {
  return useContext(Ctx);
}

/** `light` ou `dark` já resolvido — para quem precisa do NOME, não da paleta. */
export function useScheme(): 'light' | 'dark' {
  return useContext(Ctx).scheme;
}

/**
 * Estilo dos ícones da status bar.
 *
 * Existe porque **no Android o padrão do `react-native-screens` é `light`**: em toda tela de fundo
 * claro o relógio e a bateria saem brancos sobre branco e somem. Vai como `screenOptions
 * .statusBarStyle` de cada `<Stack>`, NÃO como `<StatusBar>` dentro da tela — o componente aplica
 * o estilo na MONTAGEM, e a `NativeTabs` mantém as abas montadas, então o valor de uma aba vazava
 * para as outras. A opção do navegador é aplicada no FOCO, que é o correto por construção.
 */
export function useBarStyle(): 'light' | 'dark' {
  return useScheme() === 'dark' ? 'light' : 'dark';
}
