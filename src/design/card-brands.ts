/**
 * A cor do BANCO, para o cartão de crédito parecer o cartão que está na carteira da pessoa.
 *
 * ## Por que estas cores não moram em `constants/theme.ts`
 *
 * Todo o resto do app tem par light/dark porque a cor é NOSSA e muda com o tema. Estas não são
 * nossas: o roxo do Nubank é roxo no claro e no escuro, senão deixa de ser o roxo do Nubank. Elas
 * também nunca pintam texto nem superfície do app — só entram misturadas com preto no fundo do
 * cartão, no ponto da bandeira e na barra de limite DELE. Por isso o arquivo é allowlisted no
 * `anti-slop.test.ts` em vez de a regra ser afrouxada.
 *
 * ## O histórico, porque isto já foi decidido nos dois sentidos
 *
 * `design.md` proibia cor de bandeira, com um motivo real: roxo em finanças no Brasil lê como
 * Nubank, e a cor de outra empresa ficaria no ponto de maior destaque da tela. Em 03/09/2026 o
 * dono do produto decidiu o contrário — o desenho do Stitch pinta o cartão com a cor do banco, e
 * é isso que faz o bloco parecer um cartão em vez de um card. A diferença que sustenta a decisão:
 * a cor aparece DENTRO da forma de um cartão de crédito, onde o usuário já espera a marca do
 * emissor, e não como accent do app.
 *
 * ## Como o casamento é feito
 *
 * Por substring do nome que o usuário deu à conta, sem acento e em minúsculas. É o mesmo critério
 * frouxo do `ilike` que resolve conta por nome no WhatsApp, e pelo mesmo motivo: o nome é texto
 * livre ("Nubank Ultravioleta", "nu roxinho", "Itaú Black"). Sem match, o cartão fica na cor
 * neutra do sistema — nunca chuta uma marca.
 */

/** `[padrão no nome, cor da marca]`. A ordem importa: o primeiro match ganha. */
const BRANDS: [RegExp, string][] = [
  [/\bnubank\b|\bnu\b|ultravioleta|roxinho/, '#820AD1'],
  [/itau|personnalite|iti\b/, '#EC7000'],
  [/inter\b/, '#FF7A00'],
  [/bradesco|next\b/, '#CC092F'],
  [/santander/, '#EC0000'],
  [/caixa/, '#0070AF'],
  [/banco do brasil|\bbb\b|ourocard/, '#F5C518'],
  [/\bxp\b|xp investimentos/, '#1E5AA8'],
  [/\bc6\b|carbon/, '#5A5A5A'],
  [/\bbtg\b/, '#14324F'],
  [/safra/, '#003B71'],
  [/sicredi/, '#3FA110'],
  [/sicoob/, '#00694E'],
  [/porto seguro|porto\b/, '#0033A0'],
  [/mercado pago|mercadopago|\bmeli\b/, '#00B1EA'],
  [/picpay/, '#21C25E'],
  [/\bneon\b/, '#00A9E0'],
  [/original/, '#00A868'],
  [/\bpan\b/, '#00A0DF'],
  [/\bwill\b/, '#F5B700'],
  [/digio/, '#0090FF'],
  [/\bamex\b|american express/, '#006FCF'],
  [/\bvisa\b/, '#1A1F71'],
  [/master ?card|\bmaster\b/, '#EB001B'],
  [/\belo\b/, '#E8A100'],
  [/hipercard/, '#B3131B'],
];

/** Quando o nome não diz nada. Cinza de superfície, não uma marca inventada. */
export const NEUTRAL_BRAND = '#4A4B4F';

/** Tira acento e caixa — "Itaú" e "itau" têm que casar com a mesma entrada. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function brandColor(name: string | null | undefined): string {
  if (!name) return NEUTRAL_BRAND;
  const plain = normalize(name);
  for (const [pattern, color] of BRANDS) if (pattern.test(plain)) return color;
  return NEUTRAL_BRAND;
}

/**
 * Mistura a cor da marca com uma cor de BASE.
 *
 * A primeira versão misturava com preto puro e o resultado era quase invisível: um cartão sem
 * marca reconhecida (base neutra puxada 86% para o preto) virava `#0A0A0B` sobre um fundo
 * `#131315` — o cartão sumia. Misturar com a superfície do painel resolve os dois casos de uma
 * vez: a marca tinge, e o cartão nunca fica mais escuro que o resto da tela.
 *
 * É também o que o export faz de verdade: `#1d142b` não é roxo × preto, é roxo sobre um cinza
 * escuro.
 *
 * `weight` é quanto da MARCA entra (0 = só a base, 1 = só a marca).
 */
export function blend(hex: string, base: string, weight: number): string {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(base.slice(1), 16);
  const w = Math.min(1, Math.max(0, weight));
  const ch = (shift: number) =>
    Math.round((((a >> shift) & 255) * w + ((b >> shift) & 255) * (1 - w)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Alfa em cima de um hex de 6 dígitos, no formato que o Skia e o RN aceitam. */
export function alpha(hex: string, a: number): string {
  return `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/**
 * O chip EMV.
 *
 * Não é cor de tema (não muda com light/dark) nem de marca (é igual em todo cartão) — é a cor de
 * um chip de contato, e ela é dourada. Mora aqui pelo mesmo motivo das outras: um par light/dark
 * em `theme.ts` seria mentira.
 */
export const CHIP_GOLD = { top: '#F7E7A9', bottom: '#B8860B' } as const;
