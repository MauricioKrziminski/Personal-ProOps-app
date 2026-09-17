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

import { contrast } from './contrast.ts';

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

/** Mistura com branco. `peso` é quanto de BRANCO entra. */
export function clarear(hex: string, peso: number): string {
  return blend('#FFFFFF', hex, peso);
}

/** Mistura com preto. `peso` é quanto de PRETO entra. */
export function escurecer(hex: string, peso: number): string {
  return blend('#000000', hex, peso);
}

/** As duas tintas que a face do cartão pode usar — os mesmos valores de `onCardLight` e `onCardInk`. */
export const TINTA_CLARA = '#F4F4F2';
export const TINTA_ESCURA = '#0B0B0C';
/** A opacidade do texto secundário na face (`onCardLightMuted` / `onCardInkMuted`). */
export const ALFA_DA_TINTA_SUAVE = 0.78;
/** O brilho diagonal do metal (`cardSheen`). */
export const ALFA_DO_BRILHO = 0.08;
/** Quanto o degradê do metal anda a partir da base, sempre para o lado que AUMENTA o contraste. */
const PASSO_DO_METAL = 0.14;
/** O mínimo AA para texto de 12–16px, nos dois textos da face. */
const CONTRASTE_MINIMO = 4.5;

export type FaceDoCartao = {
  tinta: 'clara' | 'escura';
  /** A cor de cima do metal (a do banco, ajustada só o que o contraste pede). */
  base: string;
  /** A cor de baixo do metal. */
  fim: string;
};

const faces = new Map<string, FaceDoCartao>();

/**
 * A face de um emissor com o texto LEGÍVEL garantido por construção.
 *
 * A cor do banco é pura quando dá (a maioria), e desliza para o escuro (tinta clara) ou para o
 * claro (tinta escura) só o quanto o contraste pede: texto principal E secundário ≥ 4,5:1 em
 * todo o metal, brilho incluído. Medido em 17/09/2026: com a cor pura e o secundário a 60%, NENHUM
 * banco passava no secundário, e Santander, Caixa, Amex e Mastercard não passavam nem no
 * principal. Os vermelhos ficam um pouco mais fundos — continuam lendo como a marca.
 *
 * A tinta é a que precisa de MENOS ajuste; num empate curto (até 0,04) vence a clara, que é como
 * os cartões de verdade dessas cores costumam ser.
 */
export function faceDoCartao(marca: string): FaceDoCartao {
  const guardada = faces.get(marca);
  if (guardada) return guardada;

  const ajuste = (tinta: 'clara' | 'escura') => {
    const cor = tinta === 'clara' ? TINTA_CLARA : TINTA_ESCURA;
    const lado = tinta === 'clara' ? '#000000' : '#FFFFFF';
    for (let k = 0; k <= 0.8; k += 0.02) {
      const base = blend(lado, marca, k);
      const fim = blend(lado, base, PASSO_DO_METAL);
      const brilho = blend('#FFFFFF', base, ALFA_DO_BRILHO);
      const legivel = [base, fim, brilho].every(
        (f) =>
          contrast(cor, f) >= CONTRASTE_MINIMO &&
          contrast(blend(cor, f, ALFA_DA_TINTA_SUAVE), f) >= CONTRASTE_MINIMO
      );
      if (legivel) return { k, base, fim };
    }
    return { k: 1, base: lado === '#000000' ? '#000000' : '#FFFFFF', fim: lado };
  };

  const clara = ajuste('clara');
  const escura = ajuste('escura');
  const face: FaceDoCartao =
    clara.k <= escura.k + 0.04
      ? { tinta: 'clara', base: clara.base, fim: clara.fim }
      : { tinta: 'escura', base: escura.base, fim: escura.fim };
  faces.set(marca, face);
  return face;
}

/** Qual tinta escreve sobre a cor do emissor (ver `faceDoCartao`). */
export function tintaDoCartao(hex: string): 'clara' | 'escura' {
  return faceDoCartao(hex).tinta;
}
