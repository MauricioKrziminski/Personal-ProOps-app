import assert from 'node:assert/strict';
import { test } from 'node:test';

import { brlWorklet } from './brl-worklet.ts';
import { formatBRL, moneySign } from './dates.ts';

/**
 * O count-up do herói escreve com `brlWorklet`; o resto do app escreve com `formatBRL`. Se os
 * dois divergirem num único centavo, o número PISCA de uma grafia para outra no fim da animação
 * — e ninguém olha para isso de novo depois de escrever a animação.
 */
test('brlWorklet é byte a byte igual a moneySign + formatBRL', () => {
  const casos: number[] = [
    0, 1, 9, 10, 99, 100, 101, 999, 1000, 1001, 99999, 100000, 999999, 1000000,
    99999999, 100000000,
    -1, -72, -100, -832663, -75939, -99999999,
  ];
  // Aleatórios cobrem as fronteiras de milhar que a lista à mão não adivinha.
  for (let i = 0; i < 2000; i++) casos.push(Math.round((Math.random() - 0.5) * 2e9));

  for (const c of casos) {
    assert.equal(brlWorklet(c), `${moneySign(c)}${formatBRL(Math.abs(c))}`, `cents=${c}`);
  }
});

test('o separador vem do Intl, não de um espaço cravado', () => {
  /*
    O ICU já divergiu entre NBSP (U+00A0) e NNBSP (U+202F) conforme a plataforma. Cravar o
    caractere passaria neste teste (que roda no ICU do Node) e quebraria no aparelho — por isso
    a constante é DERIVADA de `formatBRL`. Aqui só se prova que ela não virou um espaço comum.
  */
  const separador = brlWorklet(0).replace('R$', '').replace('0,00', '');
  assert.equal(separador, formatBRL(0).replace('R$', '').replace('0,00', ''));
  assert.notEqual(separador, ' ', 'espaço comum quebraria a grafia no aparelho');
});
