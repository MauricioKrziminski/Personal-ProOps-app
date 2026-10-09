import * as WebBrowser from 'expo-web-browser';

/**
 * Termos de Uso e Política de Privacidade — fonte única (paywall, cadastro e Perfil).
 *
 * ⚠️ PROVISÓRIAS: as duas URLs abaixo são palpite e precisam ser confirmadas pelo dono do produto
 * antes da submissão às lojas (a Apple e o Google abrem os dois links na revisão).
 */
export const URL_TERMOS = 'https://proops.com.br/termos';
export const URL_PRIVACIDADE = 'https://proops.com.br/privacidade';

/** Abre no navegador do sistema (a folha de leitura), sem sair do app. */
export const abrirLegal = (url: string) => void WebBrowser.openBrowserAsync(url);
