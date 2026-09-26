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
  toTsQuery,
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

test('prévia e título não vazam a marcação de NENHUM bloco', () => {
  // Vazou duas vezes na vida deste arquivo: primeiro com checklist, depois com cabeçalho, quando
  // os blocos nasceram e `stripMarkup` só conhecia `- [ ]`.
  assert.equal(noteTitle('# Feira do mês'), 'Feira do mês');
  assert.equal(noteTitle('> citação de abertura'), 'citação de abertura');
  assert.equal(notePreview('titulo\n## sub\n- item\n1. um\n---'), 'sub item um');
});

test('prévia não vaza a marcação do checklist (aparecia `- [x] leite - [ ] pão`)', () => {
  assert.equal(notePreview('Compras\n- [x] leite\n- [ ] pão\n- [ ] café'), 'leite pão café');
});

test('título de nota que começa com checklist mostra o texto, não a marcação', () => {
  assert.equal(noteTitle('- [ ] pagar aluguel\n- [x] luz'), 'pagar aluguel');
});

test('o strip come a MARCAÇÃO, nunca o hífen que é texto', () => {
  // Mudou de propósito em 03/09/2026: `- item` deixou de ser texto solto e passou a ser um bloco
  // de lista, então a prévia mostra o conteúdo sem o traço — que é o trabalho desta função.
  // O que o teste guarda de verdade continua guardado: hífen DENTRO da palavra não é marcação.
  assert.equal(notePreview('Título\n- item solto\nmeia-noite'), 'item solto meia-noite');
  assert.equal(notePreview('Título\nsegunda-feira às 9h'), 'segunda-feira às 9h');
});

test('prévia não repete a #tag, que já aparece na faixa de metadados', () => {
  assert.equal(notePreview('Compras\nleite e pão #mercado'), 'leite e pão');
  assert.equal(notePreview('Ideia\n#trabalho separar 10% #freela'), 'separar 10%');
});

test('prévia preserva # colado em palavra e cerquilha solta (não é tag)', () => {
  assert.equal(notePreview('T\nligar para o 3# andar'), 'ligar para o 3# andar');
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

test('prévia e título não vazam a marcação INLINE (`*negrito*`, `_itálico_`)', () => {
  const nota = '*Feira* de sábado\n_comprar_ ~café~ e `leite`';
  assert.equal(noteTitle(nota), 'Feira de sábado');
  assert.equal(notePreview(nota), 'comprar café e leite');
});

test('o que não é marcação casada continua na tela', () => {
  assert.equal(noteTitle('custou 3 * 4 reais'), 'custou 3 * 4 reais');
  assert.equal(notePreview('titulo\namount_cents e folder_id'), 'amount_cents e folder_id');
});

test('notePreview com limite corta numa palavra inteira e marca o corte — a lista não vira a nota inteira', () => {
  // 25/09/2026, a Lixeira: uma nota grande ocupava a tela inteira dentro de uma linha.
  const corpo = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
  const previa = notePreview(`Afazeres\n${corpo}`, 120);
  assert.ok(previa.length <= 121, `cortou em ${previa.length}`);
  assert.ok(previa.endsWith('…'));
  assert.ok(corpo.startsWith(previa.slice(0, -1)), 'o corte cai numa palavra inteira');
  assert.equal(notePreview('Título\nlinha 2', 120), 'linha 2', 'curto não muda');
});
