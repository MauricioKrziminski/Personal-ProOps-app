/**
 * Junta o que o usuário USA com o que o app SUGERE, numa lista só.
 *
 * Dois problemas medidos em produção (09/09/2026), os dois invisíveis no simulador:
 *
 * 1. **O seletor mostrava as 13 sugestões e nada mais.** Das 25 categorias reais, 17 não
 *    estavam entre elas — "despesas eventuais" (14 lançamentos), "roupa" (10),
 *    "eletrônicos" (10), "impostos", "presentes", "estudo", "financiamento", "telefone".
 *    Todas nasceram pelo WhatsApp, onde categoria é texto livre, e nenhuma dava para
 *    escolher no app.
 * 2. **Acento e caixa criam gêmeas:** `salario` (7) e `salário` (6) são a mesma coisa
 *    contada duas vezes, e o mesmo vale para `saude`/`saúde` e `alimentacao`/`alimentação`.
 *    Listar as duas faria o seletor parecer quebrado.
 *
 * A chave de agrupamento tira acento e caixa; o RÓTULO que sobrevive é a grafia mais usada,
 * com empate resolvido pela que tem acento (é a forma correta em pt-BR, e é a que o modelo
 * escreve). Isso **não corrige o dado** — só para de mostrar o mesmo item duas vezes.
 */

export type CategoryOption = { label: string; uses: number };

export const foldCategory = (c: string) =>
  c.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

const temAcento = (c: string) => foldCategory(c) !== c.trim().toLowerCase();

export function mergeCategories(
  used: readonly { category: string; uses: number }[],
  suggested: readonly string[],
  keepAlways?: string | null,
): CategoryOption[] {
  const porChave = new Map<string, CategoryOption>();

  const somar = (label: string, uses: number) => {
    const chave = foldCategory(label);
    if (!chave) return;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, { label: label.trim(), uses });
      return;
    }
    // grafia vencedora: a mais usada; empate vai para a acentuada
    const troca =
      uses > atual.uses || (uses === atual.uses && temAcento(label) && !temAcento(atual.label));
    porChave.set(chave, { label: troca ? label.trim() : atual.label, uses: atual.uses + uses });
  };

  for (const u of used) somar(u.category, u.uses);
  // Sugestão nunca usada entra com zero: continua oferecida, mas atrás do que ele usa.
  for (const s of suggested) if (!porChave.has(foldCategory(s))) somar(s, 0);
  // A categoria do lançamento aberto não pode sumir da lista só porque é única no banco.
  if (keepAlways) somar(keepAlways, 0);

  return [...porChave.values()].sort(
    (a, b) => b.uses - a.uses || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

/** Filtro do campo de busca do seletor — sem acento e sem caixa, como o agrupamento. */
export function filterCategories(options: CategoryOption[], term: string): CategoryOption[] {
  const t = foldCategory(term);
  return t ? options.filter((o) => foldCategory(o.label).includes(t)) : options;
}
