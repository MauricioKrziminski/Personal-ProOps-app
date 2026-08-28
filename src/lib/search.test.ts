import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  noteTitle,
  normalizeFolderName,
  notePreview,
  parseChecklist,
  toTsQuery,
  toggleChecklistLine,
  toIlikeTerm,
} from './search.ts';

test('tsquery: prefixo só no último termo (é o que faz buscar enquanto digita)', () => {
  assert.equal(toTsQuery('reuniao cliente'), 'reuniao & cliente:*');
  assert.equal(toTsQuery('dentista'), 'dentista:*');
});

test('tsquery: entrada vazia ou só pontuação vira string vazia, não query inválida', () => {
  assert.equal(toTsQuery(''), '');
  assert.equal(toTsQuery('   '), '');
  assert.equal(toTsQuery('!!! ??? ...'), '');
});

test('tsquery: pontuação separa termos e não vaza para o operador', () => {
  assert.equal(toTsQuery('mercado, pão'), 'mercado & pão:*');
  assert.equal(toTsQuery("d'agua (fria)"), 'd & agua & fria:*');
});

test('tsquery: acento e maiúscula são preservados em minúscula (unaccent resolve no banco)', () => {
  assert.equal(toTsQuery('REUNIÃO'), 'reunião:*');
});

test('tsquery: número entra como termo', () => {
  assert.equal(toTsQuery('nota 45'), 'nota & 45:*');
});

test('título é a primeira linha não vazia', () => {
  assert.equal(noteTitle('\n\n  Comprar leite\nresto'), 'Comprar leite');
  assert.equal(noteTitle(''), '');
});

test('prévia não repete o título', () => {
  assert.equal(notePreview('Título\nlinha 2\nlinha 3'), 'linha 2 linha 3');
  assert.equal(notePreview('só o título'), '');
});

test('prévia não vaza a marcação do checklist (aparecia `- [x] leite - [ ] pão`)', () => {
  assert.equal(notePreview('Compras\n- [x] leite\n- [ ] pão\n- [ ] café'), 'leite pão café');
});

test('título de nota que começa com checklist mostra o texto, não a marcação', () => {
  assert.equal(noteTitle('- [ ] pagar aluguel\n- [x] luz'), 'pagar aluguel');
});

test('linha comum na prévia continua intacta (o strip não pode comer hífen de texto)', () => {
  assert.equal(notePreview('Título\n- item solto\nmeia-noite'), '- item solto meia-noite');
});

test('checklist: reconhece marcado e desmarcado, e ignora linha comum', () => {
  const items = parseChecklist('Compras\n- [ ] leite\n- [x] pão\ntexto solto');
  assert.deepEqual(items, [
    { index: 1, done: false, text: 'leite' },
    { index: 2, done: true, text: 'pão' },
  ]);
});

test('toggle inverte só a linha pedida e preserva o resto byte a byte', () => {
  const before = 'Compras\n- [ ] leite\n- [x] pão';
  const after = toggleChecklistLine(before, 1);
  assert.equal(after, 'Compras\n- [x] leite\n- [x] pão');
  assert.equal(toggleChecklistLine(after, 2), 'Compras\n- [x] leite\n- [ ] pão');
});

test('toggle em linha que não é checklist não muda nada', () => {
  const t = 'Compras\ntexto';
  assert.equal(toggleChecklistLine(t, 1), t);
  assert.equal(toggleChecklistLine(t, 99), t);
});

test('nome de pasta respeita o check do banco: lower, trim e 40 chars', () => {
  assert.equal(normalizeFolderName('  Mercado  '), 'mercado');
  assert.equal(normalizeFolderName('A'.repeat(60)).length, 40);
});

test('ilike: metacaractere do PostgREST vira espaço (`compra (mercado)` quebrava a query)', () => {
  assert.equal(toIlikeTerm('compra (mercado)'), 'compra mercado');
  assert.equal(toIlikeTerm('a,b'), 'a b');
  assert.equal(toIlikeTerm('100%'), '100');
  assert.equal(toIlikeTerm('a_b'), 'a b');
});

test('ilike: acento, número e hífen sobrevivem', () => {
  assert.equal(toIlikeTerm('café  são-paulo 45'), 'café são-paulo 45');
});

test('ilike: só pontuação vira string vazia', () => {
  assert.equal(toIlikeTerm('()%,'), '');
});
