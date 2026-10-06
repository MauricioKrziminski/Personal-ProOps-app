/** O apelido é guardado minúsculo e sem acento; só a tela o capitaliza ("roxinho" → "Roxinho"). */
export function apelidoParaExibir(alias: string): string {
  const t = alias.trim();
  return t ? t[0].toLocaleUpperCase('pt-BR') + t.slice(1) : t;
}
