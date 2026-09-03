import type { SymbolViewProps } from 'expo-symbols';

/**
 * Categoria → ícone. **A fonte única de todo ícone de lançamento, orçamento e linha do extrato.**
 *
 * ## Por que existe
 *
 * O mesmo gasto aparecia com um ícone diferente em cada tela: `KIND_ICON` (seta para cima/baixo)
 * estava duplicado literalmente em `finance/index.tsx` e `finance/transactions.tsx`, a Hoje
 * desenhava um garfo **fixo** em todo card de orçamento (um teto de "casa" com ícone de
 * restaurante), e a carteira usava `creditcard` para tudo. Três telas, três vocabulários — foi a
 * queixa de "os ícones dos lançamentos é diferente para cada um, nunca padronizado".
 *
 * O desenho do Stitch põe o ícone da CATEGORIA num disco de 40px (`shopping_cart`,
 * `local_gas_station`) e reserva a seta só para o que não tem categoria. É o mesmo critério de
 * Monzo e Revolut: a seta diz a direção do dinheiro, que o valor e a cor já dizem; o ícone da
 * categoria diz *o que foi*, que é a única coisa que a linha ainda não contou.
 *
 * ## Como casar
 *
 * Categoria é **texto livre** no banco (`finance.md`), então o casamento é por substring sem
 * acento — "mercado", "supermercado" e "Mercado Livre" caem todos em carrinho. Sem match, cai na
 * seta do `kind`, que é sempre verdadeira. Nunca inventa um ícone por semelhança.
 *
 * ⚠️ Ícone novo aqui = entrada nova no mapa de `Icon` (`icon.tsx`), senão vira um `circle` vazio
 * no Android. `icon-map.test.ts` quebra o build se faltar.
 */
type IconName = SymbolViewProps['name'];

/** `[padrão na categoria, ícone]`. Ordem importa: o primeiro match ganha. */
const BY_CATEGORY: [RegExp, IconName][] = [
  [/mercado|supermercado|feira|compras/, 'cart'],
  [/restaurante|aliment|comida|lanche|delivery|ifood/, 'fork.knife'],
  [/transporte|uber|combust|gasolina|posto|carro|onibus|metro/, 'car'],
  [/casa|moradia|aluguel|condominio|reforma/, 'house'],
  [/contas|luz|agua|energia|internet|telefone|gas\b/, 'doc.text'],
  [/saude|farmacia|remedio|medico|plano de saude|dentista/, 'heart'],
  [/educa|curso|faculdade|escola|livro/, 'graduationcap'],
  [/assinatura|streaming|netflix|spotify|mensalidade/, 'repeat'],
  [/lazer|viagem|cinema|passeio|hobby/, 'sparkles'],
  [/salario|pagamento|holerite/, 'banknote'],
  [/freela|servico|consultoria|projeto/, 'briefcase'],
  [/presente|doacao/, 'gift'],
  [/academia|esporte|treino/, 'dumbbell'],
  [/investimento|aplicacao|renda/, 'chart.line.uptrend.xyaxis'],
  [/imposto|taxa|tarifa|juros|multa/, 'exclamationmark.triangle'],
  [/cartao|fatura/, 'creditcard'],
];

/** Quando a categoria não diz nada, a direção do dinheiro diz. É sempre verdadeira. */
const BY_KIND: Record<string, IconName> = {
  expense: 'arrow.up.right',
  income: 'arrow.down.left',
  transfer: 'arrow.left.arrow.right',
};

/** Tira acento e caixa — "saúde" e "saude" têm que casar com a mesma entrada. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * O ícone de um lançamento ou de um orçamento.
 *
 * `kind` é opcional: um card de orçamento não tem direção, e aí o fallback é a etiqueta genérica
 * em vez de uma seta que afirmaria "saiu" sobre um teto que ainda não foi gasto.
 */
export function categoryIcon(
  category: string | null | undefined,
  kind?: string | null
): IconName {
  if (category) {
    const plain = normalize(category);
    for (const [pattern, icon] of BY_CATEGORY) if (pattern.test(plain)) return icon;
  }
  return (kind && BY_KIND[kind]) || 'tag';
}
