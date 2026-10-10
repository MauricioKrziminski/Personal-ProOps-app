import * as WebBrowser from 'expo-web-browser';

/**
 * Termos de Uso e Política de Privacidade — fonte única (paywall, cadastro e Perfil).
 *
 * As páginas são servidas pelo próprio agente (`/termos`, `/privacidade`), então a base é a mesma
 * `EXPO_PUBLIC_AGENT_URL` de `agent-api.ts`. Quando houver site próprio, `EXPO_PUBLIC_TERMOS_URL` /
 * `EXPO_PUBLIC_PRIVACIDADE_URL` sobrepõem. Sem nenhuma das duas o link é `null` e `abrirLegal` não faz nada.
 */
const BASE = (process.env.EXPO_PUBLIC_AGENT_URL ?? '').replace(/\/+$/, '');

const url = (override: string | undefined, caminho: string): string | null =>
  override?.trim() || (BASE ? `${BASE}/${caminho}` : null);

export const URL_TERMOS = url(process.env.EXPO_PUBLIC_TERMOS_URL, 'termos');
export const URL_PRIVACIDADE = url(process.env.EXPO_PUBLIC_PRIVACIDADE_URL, 'privacidade');
export const URL_APAGAR_CONTA = url(undefined, 'apagar-conta');

/** Abre no navegador do sistema (a folha de leitura), sem sair do app. */
export const abrirLegal = (link: string | null) => {
  if (link) void WebBrowser.openBrowserAsync(link);
};
