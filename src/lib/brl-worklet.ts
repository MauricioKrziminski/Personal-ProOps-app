import { formatBRL } from './dates.ts';

/**
 * O separador entre `R$` e o número, **lido do próprio `formatBRL`** no carregamento do módulo.
 *
 * ⚠️ Cravar ` ` seria uma aposta: o ICU do Hermes no Android e o do sistema no iOS já
 * divergiram entre NBSP (U+00A0) e NNBSP (U+202F), e `brl-worklet.test.ts` roda no ICU do
 * **Node** — ele provaria paridade com o Node, não com o aparelho. Derivado, não há o que
 * divergir: o mesmo `Intl` que formata a tela define a constante.
 */
const ESPACO = formatBRL(0).replace('R$', '').replace('0,00', '');

/**
 * `moneySign(c) + formatBRL(|c|)`, mas rodando dentro de um worklet.
 *
 * ⚠️ **Existe porque `Intl` não serve no runtime da UI.** O worklet do Reanimated roda numa
 * instância SEPARADA do Hermes, e alocar um `Intl.NumberFormat` por quadro é a definição de
 * jank — num count-up são 60 por segundo. Aqui é só aritmética de inteiro.
 *
 * `brl-worklet.test.ts` compara os dois byte a byte em ~2.000 casos: se um dia divergirem, é o
 * teste que quebra, não o número na tela do usuário.
 */
export function brlWorklet(cents: number): string {
  'worklet';
  const arredondado = Math.round(cents);
  const negativo = arredondado < 0;
  const abs = Math.abs(arredondado);
  const inteiro = String(Math.floor(abs / 100));
  const centavos = abs % 100;

  let milhar = '';
  for (let i = 0; i < inteiro.length; i++) {
    // Ponto a cada 3 dígitos contando da DIREITA — `(len - i) % 3` acerta sem reverter a string.
    if (i > 0 && (inteiro.length - i) % 3 === 0) milhar += '.';
    milhar += inteiro[i];
  }

  return `${negativo ? '−' : ''}R$${ESPACO}${milhar},${centavos < 10 ? '0' : ''}${centavos}`;
}
