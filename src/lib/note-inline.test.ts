import assert from 'node:assert/strict';
import { test } from 'node:test';

import { marksAt, parseInline, stripInline, toggleMark } from './note-inline.ts';
import { classify } from './note-blocks.ts';

/**
 * O parser inline erra em silêncio das duas formas: marcando o que não devia (um `_` no meio de
 * `snake_case`) e deixando o delimitador vazar para a tela (o defeito que a lista já teve com
 * `# Feira`). Cada regra da abertura/fechamento tem caso aqui.
 */

const textos = (t: string) => parseInline(t).map((s) => [s.text, s.marks.join('+')]);

test('as quatro marcas', () => {
  assert.deepEqual(textos('*leite*'), [['leite', 'bold']]);
  assert.deepEqual(textos('_hoje_'), [['hoje', 'italic']]);
  assert.deepEqual(textos('~café~'), [['café', 'strike']]);
  assert.deepEqual(textos('`npm test`'), [['npm test', 'code']]);
});

test('texto sem marcação sai inteiro, num span só', () => {
  assert.deepEqual(textos('comprar pão na padaria'), [['comprar pão na padaria', '']]);
  assert.deepEqual(parseInline(''), []);
});

test('marca no meio da frase', () => {
  assert.deepEqual(textos('comprar *leite* hoje'), [
    ['comprar ', ''],
    ['leite', 'bold'],
    [' hoje', ''],
  ]);
});

test('aninha, e a ordem das marcas segue a de abertura', () => {
  assert.deepEqual(textos('*_urgente_*'), [['urgente', 'bold+italic']]);
  assert.deepEqual(textos('_*urgente*_'), [['urgente', 'italic+bold']]);
});

test('duas marcas iguais na mesma linha não se confundem', () => {
  assert.deepEqual(textos('*um* e *dois*'), [
    ['um', 'bold'],
    [' e ', ''],
    ['dois', 'bold'],
  ]);
});

/* ── o que NÃO pode virar marcação ─────────────────────────────────────────── */

test('snake_case fica intocado — o `_` vem depois de letra e não abre', () => {
  assert.deepEqual(textos('usar snake_case aqui'), [['usar snake_case aqui', '']]);
  assert.deepEqual(textos('__init__ do python'), [['__init__ do python', '']]);
  assert.equal(stripInline('amount_cents e folder_id'), 'amount_cents e folder_id');
});

test('multiplicação não vira negrito', () => {
  assert.deepEqual(textos('2*3*4'), [['2*3*4', '']]);
  assert.deepEqual(textos('3 * 4'), [['3 * 4', '']]);
});

test('delimitador solto é texto', () => {
  assert.deepEqual(textos('abriu *mas não fechou'), [['abriu *mas não fechou', '']]);
  assert.equal(stripInline('custou ~30 reais'), 'custou ~30 reais');
});

test('mono é literal: nada é interpretado lá dentro', () => {
  assert.deepEqual(textos('`a_b_c`'), [['a_b_c', 'code']]);
  assert.deepEqual(textos('`*não é negrito*`'), [['*não é negrito*', 'code']]);
});

/* ── a fronteira com os BLOCOS de note-blocks.ts ───────────────────────────── */

test('`*negrito*` no começo da linha não vira item de lista', () => {
  // BULLET exige espaço depois do `*`; sem ele a linha é parágrafo e o negrito é inline.
  assert.equal(classify('*leite* sem lactose').kind, 'text');
  assert.deepEqual(textos(classify('*leite* sem lactose').text), [
    ['leite', 'bold'],
    [' sem lactose', ''],
  ]);
});

test('`* leite` continua sendo item de lista, e o texto dele não tem marcação', () => {
  const b = classify('* leite');
  assert.equal(b.kind, 'bullet');
  assert.deepEqual(textos(b.text), [['leite', '']]);
});

test('`***` continua divisória e `___` também', () => {
  assert.equal(classify('***').kind, 'divider');
  assert.equal(classify('___').kind, 'divider');
  assert.equal(classify('---').kind, 'divider');
});

/* ── marksAt: o estado da barra ────────────────────────────────────────────── */

test('marksAt aponta a marca sob o cursor, não a primeira igual da linha', () => {
  const t = '*leite* e mais leite';
  assert.deepEqual(marksAt(t, 3), ['bold']);       // dentro do primeiro trecho
  assert.deepEqual(marksAt(t, 17), []);            // no "leite" solto do fim
});

/* ── toggleMark ────────────────────────────────────────────────────────────── */

test('seleção vazia insere o par e deixa o cursor no meio', () => {
  const r = toggleMark('nota ', 5, 5, 'bold');
  assert.equal(r.text, 'nota **');
  assert.deepEqual(r.selection, { start: 6, end: 6 });
});

test('envolve a seleção e devolve a seleção nova sobre o mesmo texto', () => {
  const r = toggleMark('comprar leite hoje', 8, 13, 'bold');
  assert.equal(r.text, 'comprar *leite* hoje');
  assert.equal(r.text.slice(r.selection.start, r.selection.end), 'leite');
});

test('já envolvido, desfaz — virar negrito não é caminho de mão única', () => {
  const r = toggleMark('comprar *leite* hoje', 9, 14, 'bold');
  assert.equal(r.text, 'comprar leite hoje');
  assert.equal(r.text.slice(r.selection.start, r.selection.end), 'leite');
});

test('o espaço das pontas fica FORA do delimitador', () => {
  // `*leite *` não viraria negrito nenhum: delimitador seguido de espaço não abre/fecha.
  const r = toggleMark('comprar leite hoje', 7, 14, 'bold');
  assert.equal(r.text, 'comprar *leite* hoje');
  assert.deepEqual(textos(r.text)[1], ['leite', 'bold']);
});

test('seleção só de espaço não escreve nada', () => {
  const r = toggleMark('a   b', 1, 4, 'italic');
  assert.equal(r.text, 'a   b');
});

test('o que toggleMark escreve, parseInline lê de volta', () => {
  for (const mark of ['bold', 'italic', 'strike', 'code'] as const) {
    const r = toggleMark('comprar leite hoje', 8, 13, mark);
    assert.deepEqual(
      parseInline(r.text).find((s) => s.text === 'leite')?.marks,
      [mark],
      `${mark} não voltou do parse`
    );
  }
});
