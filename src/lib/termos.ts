/** Vigência dos Termos e da Política (docs/legal, 09/10/2026). Mudou o texto: muda aqui, e todo mundo aceita de novo. */
export const TERMOS_VERSAO = '2026-10-09';

/** A chave de IA nasce DESLIGADA: consentimento não se presume. */
export const IA_PADRAO = false;

/** Os argumentos de `accept_terms`: a versão vigente e a escolha de IA (que nasce `false`). */
export const argumentosDoAceite = (ia: boolean = IA_PADRAO) => ({ p_version: TERMOS_VERSAO, p_ai_consent: ia });
