/**
 * Em qual ambiente este build está falando.
 *
 * ## Por que existe
 *
 * São três apps que convivem no mesmo aparelho (`app.config.js`) e três bancos distintos. Até
 * 07/09/2026 o ÚNICO sinal de qual era qual era o nome do ícone na tela inicial — e o nome não
 * acompanha o banco: um `expo run:android` local instala "ProOps" apontando para o
 * `.env` que estiver na máquina, que pode ser qualquer um dos três. Todos os três exibem ProOps;
 * o selo de ambiente no Perfil é a indicação segura do banco ativo.
 *
 * Num app de dinheiro isso é como se lança despesa no banco errado sem perceber. O rótulo sai do
 * **ref do próprio Supabase que o cliente está usando**, não de uma variável separada que alguém
 * precisa lembrar de trocar: se o `.env` mudar, o rótulo muda junto, porque é a mesma fonte.
 *
 * Módulo PURO — sem React, sem Supabase — pelo mesmo motivo de `dates.ts`: é o que deixa a regra
 * ser coberta por `node --test` sem subir o app. Quem passa a URL é a tela.
 */

/** Os dois projetos hospedados. Os nomes se parecem; o que vale é o ref. */
const REFS: Record<string, string> = {
  kwriuifcwyvdrxtspjiz: 'produção',
  utkqoiigimqzeenxkxdl: 'staging',
};

/** `https://<ref>.supabase.co` → `<ref>`; local não tem ref. */
function refDaUrl(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9]{20})\.supabase\./i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * O rótulo do ambiente, ou `null` quando é produção.
 *
 * **`null` em produção é a regra, não um esquecimento.** O usuário final não tem o que fazer com
 * a palavra "produção" — ela só ocupa espaço e vaza detalhe de infra. O rótulo existe para
 * avisar quando você NÃO está no lugar de sempre, que é a única hora em que a informação muda
 * uma decisão (§8 de design.md: contagem real ou não existe).
 */
export function environmentLabel(url: string): string | null {
  const semUrl = !url.trim();
  if (semUrl) return 'sem banco';

  const ref = refDaUrl(url);
  if (!ref) return 'local'; // 127.0.0.1, 10.0.2.2 no emulador, ou um túnel
  const nome = REFS[ref];
  if (nome === 'produção') return null;
  // Ref desconhecido: mostra o ref para a pessoa poder conferir, em vez de mentir "produção".
  return nome ?? `outro (${ref.slice(0, 6)}…)`;
}

/**
 * O atalho de login de teste é uma ferramenta do runtime de desenvolvimento, não da produção.
 *
 * `__DEV__` também fica verdadeiro num build Debug apontado para produção (como o que usamos
 * para testar no iPhone via Metro). Por isso ele sozinho não protege o botão: o banco efetivo é
 * a segunda parte da regra. Em produção, o atalho nunca aparece, mesmo durante um build Debug.
 */
export function showDevLogin(runtimeDev: boolean, url: string): boolean {
  return runtimeDev && environmentLabel(url) !== null;
}
