/**
 * Os tipos de lançamento que se criam de um toque — UMA lista para o app inteiro: os menus
 * "Lançar" da Hoje e das Finanças, cada um abrindo o formulário único no tipo (29/09/2026, *"se
 * tiver [em outro lugar], padronize no app inteiro"*). Rótulo escrito à mão em cada tela é como a
 * Hoje ficou sem Recorrente e Financiamento enquanto as Finanças tinham os dois.
 */
export const ATALHOS_DE_LANCAMENTO = {
  lancamento: { label: 'Gasto ou receita', icon: 'dollarsign.circle' },
  recorrente: { label: 'Recorrente', icon: 'arrow.triangle.2.circlepath' },
  financiamento: { label: 'Financiamento', icon: 'building.columns' },
} as const;
