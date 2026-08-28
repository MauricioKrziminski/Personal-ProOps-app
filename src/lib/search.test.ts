import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  noteTitle,
  normalizeFolderName,
  notePreview,
  addTag,
  removeTag,
  tagsOf,
  normalizeTag,
  isValidTag,
  parseChecklist,
  readLines,
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

test('prévia não repete a #tag, que já aparece na faixa de metadados', () => {
  assert.equal(notePreview('Compras\nleite e pão #mercado'), 'leite e pão');
  assert.equal(notePreview('Ideia\n#trabalho separar 10% #freela'), 'separar 10%');
});

test('prévia preserva # colado em palavra e cerquilha solta (não é tag)', () => {
  assert.equal(notePreview('T\nligar para o 3# andar'), 'ligar para o 3# andar');
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


test('tag: acrescenta no fim e não duplica (nem trocando a caixa)', () => {
  assert.equal(addTag('Comprar pão', 'mercado'), 'Comprar pão #mercado');
  assert.equal(addTag('Comprar pão #mercado', 'mercado'), 'Comprar pão #mercado');
  assert.equal(addTag('Comprar pão #Mercado', 'mercado'), 'Comprar pão #Mercado');
  assert.equal(addTag('', 'ideias'), '#ideias');
});

test('tag: entrada suja vira tag válida, e o que o banco não reconhece é recusado', () => {
  assert.equal(normalizeTag('  #Mercado '), 'mercado');
  assert.equal(normalizeTag('não-vale!'), 'novale');
  assert.equal(isValidTag('a'), false);
  assert.equal(isValidTag('ok'), true);
  assert.equal(addTag('Nota', 'x'), 'Nota');
});

test('tag: remover não deixa espaço duplo nem quebra o resto do texto', () => {
  assert.equal(removeTag('Comprar pão #mercado hoje', 'mercado'), 'Comprar pão hoje');
  assert.equal(removeTag('Título\ncorpo #trabalho', 'trabalho'), 'Título\ncorpo');
  assert.equal(removeTag('a #x1 b #x1 c', 'x1'), 'a b c');
});

test('tag: `#tag` colada em palavra não é tag (mesma regra do banco)', () => {
  assert.deepEqual(tagsOf('email#interno e #real'), ['interno', 'real']);
  assert.deepEqual(tagsOf('#a e #ok'), ['ok']);
});

test('readLines: primeira linha vira título e não se repete no corpo', () => {
  const lines = readLines('Reunião com o contador\nlevar extrato do trimestre #trabalho');
  assert.deepEqual(lines, [
    { index: 0, text: 'Reunião com o contador', role: 'title', done: null },
    { index: 1, text: 'levar extrato do trimestre', role: 'body', done: null },
  ]);
});

test('readLines: `#tag` sai do texto exibido — o chip já mostra a mesma tag', () => {
  assert.equal(readLines('Comprar pão #mercado hoje')[0].text, 'Comprar pão hoje');
  // …mas linha que É só tag mantém o texto: senão a nota apareceria em branco.
  assert.equal(readLines('#trabalho')[0].text, '#trabalho');
});

test('readLines: linha vazia não vira linha (o respiro é o gap do container)', () => {
  const lines = readLines('Título\n\n\ncorpo');
  assert.deepEqual(
    lines.map((l) => [l.index, l.text]),
    [
      [0, 'Título'],
      [3, 'corpo'],
    ]
  );
});

test('readLines: índice é o do texto ORIGINAL — é o que toggleChecklistLine reescreve', () => {
  const content = 'Compras\n\n- [ ] leite\n- [x] pão';
  const lines = readLines(content);
  assert.deepEqual(lines, [
    { index: 0, text: 'Compras', role: 'title', done: null },
    { index: 2, text: 'leite', role: 'body', done: false },
    { index: 3, text: 'pão', role: 'body', done: true },
  ]);
  // O índice 2 devolvido aqui tem de casar com a linha que o toggle marca.
  assert.equal(toggleChecklistLine(content, 2), 'Compras\n\n- [x] leite\n- [x] pão');
});

test('readLines: nota que começa em checklist não promove o to-do a título', () => {
  const lines = readLines('- [ ] pagar aluguel\n- [x] luz');
  assert.deepEqual(
    lines.map((l) => l.role),
    ['body', 'body']
  );
});
