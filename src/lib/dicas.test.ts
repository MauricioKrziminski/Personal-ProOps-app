import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DICAS, GUIA, O_QUE_DA_PARA_FAZER, destinoDoItem, dicaDaVez, encerrar, reacender, type EstadoDasDicas } from './dicas.ts';

const vazio: EstadoDasDicas = { encerradas: [], suspensas: [], forcada: null };

test('a dica da vez é a primeira do catálogo daquela tela que está na tela e não foi encerrada', () => {
  assert.equal(dicaDaVez('hoje', vazio, ['hoje-painel', 'conta-extrato']), 'hoje-painel');
  assert.equal(dicaDaVez('hoje', { ...vazio, encerradas: ['hoje-painel'] }, ['hoje-painel', 'conta-extrato']), 'conta-extrato');
  assert.equal(dicaDaVez('hoje', { ...vazio, encerradas: ['hoje-painel', 'conta-extrato'] }, ['hoje-painel', 'conta-extrato']), null);
});

test('dica de algo que não está na tela não trava a próxima (sem cartão, vem a do gráfico)', () => {
  assert.equal(dicaDaVez('financeiro', vazio, ['fin-grafico']), 'fin-grafico');
  assert.equal(dicaDaVez('financeiro', vazio, []), null);
});

test('uma por visita: dispensou uma, a tela fica quieta até a próxima abertura do app', () => {
  const depois = encerrar(vazio, 'hoje-painel', 'hoje');
  assert.deepEqual(depois.encerradas, ['hoje-painel']);
  assert.equal(dicaDaVez('hoje', depois, ['hoje-painel', 'conta-extrato']), null, 'a próxima não emenda');
  assert.equal(dicaDaVez('financeiro', depois, ['fin-pilha']), 'fin-pilha', 'as outras telas seguem');
});

test('a dica das listas é UMA: usada nas Notas, não aparece em Lançamentos', () => {
  const depois = encerrar(vazio, 'lista-arrasto', 'notas');
  assert.equal(dicaDaVez('lancamentos', { ...depois, suspensas: [] }, ['lista-arrasto']), null);
});

test('"Mostrar" do guia reacende a dica, mesmo encerrada e com a tela quieta', () => {
  const encerrada = encerrar(encerrar(vazio, 'hoje-painel', 'hoje'), 'conta-extrato', 'hoje');
  const acesa = reacender(encerrada, 'conta-extrato');
  assert.equal(dicaDaVez('hoje', acesa, ['hoje-painel', 'conta-extrato']), 'conta-extrato');
  // Dispensada de novo, não volta sozinha.
  assert.equal(dicaDaVez('hoje', encerrar(acesa, 'conta-extrato', 'hoje'), ['hoje-painel', 'conta-extrato']), null);
});

test('o catálogo: frase curta, uma tela pelo menos, ids únicos', () => {
  assert.equal(new Set(DICAS.map((d) => d.id)).size, DICAS.length);
  for (const d of DICAS) {
    assert.ok(d.telas.length > 0, d.id);
    assert.ok(d.texto.length <= 90, `${d.id}: frase de dica cabe em duas linhas`);
  }
});

test('o guia tem porta para TODA dica, e o "Mostrar" dela leva à tela onde ela mora', () => {
  const noGuia = GUIA.flatMap((g) => g.itens).flatMap((i) => ('dica' in i ? [i.dica] : []));
  for (const d of DICAS) assert.ok(noGuia.includes(d.id), `${d.id} sem entrada no guia`);
  const item = GUIA.flatMap((g) => g.itens).find((i) => 'dica' in i && i.dica === 'fin-pilha')!;
  assert.equal(destinoDoItem(item), '/finance');
  const semDica = GUIA.flatMap((g) => g.itens).find((i) => !('dica' in i))!;
  assert.equal(destinoDoItem(semDica), semDica.href);
});

test('menos texto: título curto e uma linha de explicação, no guia inteiro', () => {
  for (const i of GUIA.flatMap((g) => g.itens)) {
    assert.ok(i.titulo.length <= 32, `título longo: ${i.titulo}`);
    assert.ok(i.texto.length <= 70, `texto longo: ${i.texto}`);
  }
});

test('todo gesto escondido tem dica: painel, gráfico, pilha, Carteira, contas, arrasto, ordem e pastas, fatura', () => {
  assert.deepEqual(
    DICAS.map((d) => d.id),
    ['hoje-painel', 'conta-extrato', 'fin-grafico', 'fin-painel', 'fin-pilha', 'carteira', 'lista-arrasto', 'notas-ordem', 'notas-pastas', 'fatura-cartao'],
  );
  // a dica da conta vale na Hoje e na lista de Contas; usada numa, some na outra
  const depois = encerrar(vazio, 'conta-extrato', 'contas');
  assert.equal(dicaDaVez('hoje', { ...depois, suspensas: [] }, ['conta-extrato']), null);
});

test('o passo "O que dá para fazer" do onboarding: seis linhas curtas, e foto e áudio só pelo WhatsApp', () => {
  assert.equal(O_QUE_DA_PARA_FAZER.length, 6);
  for (const l of O_QUE_DA_PARA_FAZER) {
    assert.ok(l.titulo.length <= 28, `título longo: ${l.titulo}`);
    assert.ok(l.texto.length <= 60, `texto longo: ${l.texto}`);
  }
  // o Agente do app só recebe texto: prometer foto nele seria mentir
  assert.match(O_QUE_DA_PARA_FAZER[0].texto, /No WhatsApp, até foto e áudio/);
});
