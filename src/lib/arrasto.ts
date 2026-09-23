import type { ItemAction } from './item-actions';

/**
 * Divide as ações de um card nos dois lados do arrasto (spec `2026-09-23-arrastar-card`).
 *
 * Direita = a ação rápida do item; esquerda = tirar da lista. "Mais" aparece quando sobra ação
 * sem lado — ele abre o mesmo menu do toque longo, com a lista inteira. Arrastar até o fim
 * executa só a PRIMEIRA ação do lado, e só quando ela tem `desfaz`: Apagar nunca vai sozinho.
 */
export function ladosDoArrasto(acoes: ItemAction[]) {
  const usavel = (x: ItemAction) => !x.disabled && Boolean(x.onPress);
  const direita = acoes.filter((x) => x.arrasto === 'direita' && usavel(x));
  const esquerda = acoes.filter((x) => x.arrasto === 'esquerda' && usavel(x));
  const mais = acoes.some(
    (x) => !x.arrasto && !x.disabled && (Boolean(x.onPress) || Boolean(x.actions?.length)),
  );
  const ponta = (lado: ItemAction[]) => (lado[0]?.desfaz ? lado[0] : null);
  return { direita, esquerda, mais, pontaDireita: ponta(direita), pontaEsquerda: ponta(esquerda) };
}

/** O card tem algo para mostrar ao arrastar? Sem nada, o `Deslizavel` nem monta o gesto. */
export function temArrasto(acoes: ItemAction[]): boolean {
  const lados = ladosDoArrasto(acoes);
  return lados.direita.length > 0 || lados.esquerda.length > 0 || lados.mais;
}
