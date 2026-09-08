/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dueInline, dueLabel, settleHint, settleLabel } from './settle-labels.ts';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Telas onde não existe receita: fatura de cartão e parcela de dívida são
 * sempre saída. Cravar o rótulo ali é correto — o que não pode é uma tela que
 * mostra QUALQUER lançamento decidir sozinha, que foi como receita prevista
 * ganhou "Paguei".
 */
const SEMPRE_PAGAMENTO = new Set([
  'app/finance/cards.tsx',
  'app/finance/debts.tsx',
  'app/finance/forecast.tsx',
]);

test('receita se recebe, despesa se paga', () => {
  assert.equal(settleLabel('income'), 'Recebi');
  assert.equal(settleLabel('expense'), 'Paguei');
  assert.equal(settleLabel('transfer'), 'Concluí');
});

test('kind ausente cai no rótulo de despesa, não em texto vazio', () => {
  for (const valor of [null, undefined, '']) {
    assert.equal(settleLabel(valor), 'Paguei');
  }
});

test('receita não vence — ela é esperada', () => {
  assert.equal(dueLabel('income', '05/10/2026'), 'Previsto para 05/10/2026');
  assert.equal(dueLabel('expense', '05/10/2026'), 'Vence em 05/10/2026');
  assert.equal(dueLabel('income', null), 'Sem data prevista');
  assert.equal(dueLabel('expense', null), 'Sem data de vencimento');
  assert.equal(dueInline('income', '05/10/2026'), 'previsto · chega 05/10/2026');
  assert.equal(dueInline('expense', '05/10/2026'), 'previsto · vence 05/10/2026');
  assert.equal(dueInline('income', null), 'previsto');
});

test('a dica também para de falar só em pagar', () => {
  assert.match(settleHint('income'), /receber/);
  assert.match(settleHint('expense'), /pagar/);
});

/**
 * A regra de `frontend.md`: a decisão mora no primitivo. Quatro telas
 * calculavam o rótulo por conta e três erraram junto — este teste é o que
 * impede a quinta cópia de nascer.
 */
test('nenhuma tela escreve "Paguei" à mão', () => {
  const raiz = path.join(AQUI, '..');
  const suspeitos = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(alvo);
      else if (/\.tsx?$/.test(entrada.name) && !entrada.name.includes('.test.')) {
        const conteudo = fs.readFileSync(alvo, 'utf8');
        // `label="Paguei"` e `label={'Paguei'}` — o rótulo cravado numa tela.
        if (/label=\{?['"`]Paguei/.test(conteudo) && !SEMPRE_PAGAMENTO.has(path.relative(raiz, alvo))) {
          suspeitos.push(path.relative(raiz, alvo));
        }
      }
    }
  };
  varrer(path.join(raiz, 'app'));
  varrer(path.join(raiz, 'components'));
  assert.deepEqual(
    suspeitos,
    [],
    `use settleLabel(tx.kind) em vez de cravar o rótulo: ${suspeitos.join(', ')}`,
  );
});
