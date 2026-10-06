/** A chave do apelido é minúscula e sem acento; a tela mostra `dito` (como a pessoa escreveu)
 * quando existe e capitaliza a primeira letra ("roxinho" → "Roxinho"). */
export function apelidoParaExibir(alias: string): string {
  const t = alias.trim();
  return t ? t[0].toLocaleUpperCase('pt-BR') + t.slice(1) : t;
}
