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
  // `forecast.tsx` SAIU daqui em 09/09/2026: a justificativa acima ("fatura de cartão e parcela
  // de dívida são sempre saída") deixou de valer no minuto em que a tela passou a listar receita
  // prevista. Allowlist com motivo vencido é allowlist que esconde bug.
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
 * O DAS é comprado dia 20 e a fatura vence dia 10 do mês seguinte. A linha
 * escrevia "vence 10/09" em cima de uma compra de 20/08 — a data da FATURA
 * apresentada como se fosse a do lançamento. É a queixa de 09/09/2026, e ela
 * vale para as 69 linhas de cartão que têm `due_at` diferente de `occurred_at`.
 */
test('no cartão a data é da fatura, e o rótulo diz isso', () => {
  assert.equal(dueInline('expense', '10/09/2026', { onCard: true }), 'na fatura de 10/09/2026');
  assert.equal(dueLabel('expense', '10/09/2026', { onCard: true }), 'Entra na fatura de 10/09/2026');
  for (const texto of [
    dueInline('expense', '10/09/2026', { onCard: true }),
    dueLabel('expense', '10/09/2026', { onCard: true }),
  ]) {
    assert.doesNotMatch(texto, /vence/i, 'quem vence é a fatura, não a compra');
  }
});

test('fatura sem data ainda diz que é do cartão', () => {
  assert.equal(dueInline('expense', null, { onCard: true }), 'na próxima fatura');
  assert.equal(dueLabel('expense', null, { onCard: true }), 'Entra na próxima fatura');
});

test('no cartão a baixa não tira nada do caixa, e a dica não promete isso', () => {
  assert.match(settleHint('expense', { onCard: true }), /fatura/);
  assert.doesNotMatch(settleHint('expense', { onCard: true }), /projeção/);
});

test('fora do cartão nada mudou', () => {
  assert.equal(dueInline('expense', '05/10/2026', {}), 'previsto · vence 05/10/2026');
  assert.equal(settleHint('income', {}), settleHint('income'));
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
        /**
         * A string em QUALQUER posição, não só colada em `label=` — mas só em CÓDIGO.
         *
         * A versão anterior era `/label=\{?['"`]Paguei/` e deixou passar a Hoje, onde o
         * literal estava no FIM de um ternário (`: 'Paguei'`) — o teste existia, rodava verde,
         * e o defeito que ele foi escrito para pegar estava na tela mais usada do app. Um
         * guarda que depende de a violação ter uma forma específica não é guarda.
         *
         * Alargar a regex sozinha, porém, passou a acusar três arquivos que só CITAM a palavra
         * num comentário (inclusive este próprio histórico). Por isso o comentário sai antes da
         * checagem: o alvo é o rótulo que chega na tela, não a prosa que explica por que ele
         * não deve existir.
         */
        const codigo = conteudo
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/['"`]Paguei['"`]/.test(codigo) && !SEMPRE_PAGAMENTO.has(path.relative(raiz, alvo))) {
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
