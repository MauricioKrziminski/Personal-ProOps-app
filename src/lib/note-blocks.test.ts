import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify, lineAt, noteBlocks, setBlockKind, todoProgress, toggleTodo } from './note-blocks.ts';

/**
 * O parser de blocos é a única coisa entre "texto que veio do WhatsApp" e "nota formatada na
 * tela". Ele erra em silêncio: um regex frouxo não quebra nada, só faz `--- ` virar item de lista
 * e a divisória sumir. Por isso cada tipo tem caso aqui.
 */

test('classifica os sete tipos de bloco', () => {
  assert.equal(classify('# Título').kind, 'h1');
  assert.equal(classify('## Sub').kind, 'h2');
  assert.equal(classify('- [ ] leite').kind, 'todo');
  assert.equal(classify('- [x] pão').kind, 'todo');
  assert.equal(classify('- item').kind, 'bullet');
  assert.equal(classify('* item').kind, 'bullet');
  assert.equal(classify('1. primeiro').kind, 'numbered');
  assert.equal(classify('> citação').kind, 'quote');
  assert.equal(classify('---').kind, 'divider');
  assert.equal(classify('só um texto').kind, 'text');
});

test('a marcação não vaza para o texto', () => {
  assert.equal(classify('# Título').text, 'Título');
  assert.equal(classify('- [x] pão integral').text, 'pão integral');
  assert.equal(classify('1. primeiro').text, 'primeiro');
  assert.equal(classify('> disse ele').text, 'disse ele');
});

test('divisória não é confundida com item de lista', () => {
  // `---` casaria com um regex de bullet escrito com `[-*]\s*`. Se alguém "consertar" o regex,
  // este teste é quem avisa.
  assert.equal(classify('---').kind, 'divider');
  assert.equal(classify('***').kind, 'divider');
  assert.equal(classify('___').kind, 'divider');
  // `- ` é um item RECÉM-COMEÇADO, não um parágrafo: quem digita "- " e ainda não escreveu
  // precisa ver a bolinha aparecer. Classificar como texto faria o marcador piscar na primeira
  // letra digitada.
  assert.equal(classify('- ').kind, 'bullet');
  assert.equal(classify('- ').text, '');
});

test('a primeira linha vira título — mas só se for parágrafo', () => {
  assert.equal(noteBlocks('Reunião\ndetalhes')[0].kind, 'title');
  assert.equal(
    noteBlocks('- [ ] leite\n- [ ] pão')[0].kind,
    'todo',
    'lista de compras não se chama "leite"'
  );
  assert.equal(noteBlocks('# Cabeçalho\ntexto')[0].kind, 'h1');
});

test('linha em branco não vira bloco, mas o índice continua o da linha original', () => {
  const blocos = noteBlocks('primeiro\n\n\nsegundo');
  assert.equal(blocos.length, 2);
  assert.equal(blocos[1].index, 3, 'o índice é o do texto cru — é por ele que o toggle reescreve');
});

test('toggle marca e desmarca preservando o recuo', () => {
  assert.equal(toggleTodo('  - [ ] leite', 0), '  - [x] leite');
  assert.equal(toggleTodo('  - [x] leite', 0), '  - [ ] leite');
});

test('toggle em linha que não é item não muda nada', () => {
  const texto = 'só um parágrafo';
  assert.equal(toggleTodo(texto, 0), texto);
  assert.equal(toggleTodo(texto, 99), texto, 'índice fora do texto não estoura');
});

test('converter bloco preserva o texto', () => {
  assert.equal(setBlockKind('comprar pão', 0, 'todo'), '- [ ] comprar pão');
  assert.equal(setBlockKind('- [ ] comprar pão', 0, 'h1'), '# comprar pão');
  assert.equal(setBlockKind('# comprar pão', 0, 'quote'), '> comprar pão');
});

test('reaplicar o mesmo tipo devolve o bloco a parágrafo', () => {
  // Sem isto, virar citação seria beco sem saída: não haveria como voltar sem apagar o caractere
  // na mão, e o botão ficaria "ligado" para sempre.
  assert.equal(setBlockKind('> citação', 0, 'quote'), 'citação');
  assert.equal(setBlockKind('- [x] feito', 0, 'todo'), 'feito');
});

test('converter para divisória e sair dela não inventa texto', () => {
  assert.equal(setBlockKind('qualquer coisa', 0, 'divider'), '---');
  assert.equal(setBlockKind('---', 0, 'bullet'), '- ');
});

test('lineAt encontra a linha do cursor', () => {
  const texto = 'um\ndois\ntrês';
  assert.equal(lineAt(texto, 0), 0);
  assert.equal(lineAt(texto, 4), 1);
  assert.equal(lineAt(texto, texto.length), 2);
  assert.equal(lineAt(texto, -1), -1, 'sem cursor conhecido não escolhe uma linha ao acaso');
});

test('progresso conta só os itens marcáveis', () => {
  const nota = '# Feira\n- [x] leite\n- [ ] pão\n- não é item\n> nem isso';
  assert.deepEqual(todoProgress(nota), { done: 1, total: 2 });
  assert.deepEqual(todoProgress('sem item nenhum'), { done: 0, total: 0 });
});

// ── o editor: título em campo próprio (23/09/2026) ─────────────────────────────────

test('separarTitulo: parágrafo e "# título" viram título; lista não', async () => {
  const { separarTitulo } = await import('./note-blocks.ts');
  assert.deepEqual(separarTitulo('Compras\n- leite'), { titulo: 'Compras', corpo: '- leite' });
  assert.deepEqual(separarTitulo('# Reunião de segunda\ntexto'), { titulo: 'Reunião de segunda', corpo: 'texto' });
  assert.deepEqual(separarTitulo('- [ ] leite\n- [ ] ovos'), { titulo: '', corpo: '- [ ] leite\n- [ ] ovos' });
  assert.deepEqual(separarTitulo('\nsó corpo'), { titulo: '', corpo: 'só corpo' });
  assert.deepEqual(separarTitulo('Só título'), { titulo: 'Só título', corpo: '' });
  assert.deepEqual(separarTitulo(''), { titulo: '', corpo: '' });
});

test('juntarTitulo desfaz separarTitulo — nada pula de campo ao reabrir', async () => {
  const { separarTitulo, juntarTitulo } = await import('./note-blocks.ts');
  const casos: [string, string][] = [
    ['Compras', '- leite\n- ovos'],
    ['Só título', ''],
    ['', '- [ ] leite'],
    // sem título e corpo em parágrafo: a 1ª linha do corpo NÃO pode virar título ao reabrir
    ['', 'comprar pão\nleite'],
    ['', '# seção'],
    ['', ''],
    ['Título', '\ncom linha em branco'],
  ];
  for (const [titulo, corpo] of casos) {
    assert.deepEqual(separarTitulo(juntarTitulo(titulo, corpo)), { titulo, corpo }, JSON.stringify([titulo, corpo]));
  }
});

test('juntarTitulo nunca deixa quebra de linha entrar no título', async () => {
  const { juntarTitulo } = await import('./note-blocks.ts');
  assert.equal(juntarTitulo('linha um\nlinha dois', 'corpo'), 'linha um linha dois\ncorpo');
});

// ── Enter numa lista continua a lista ──────────────────────────────────────────────

test('Enter depois de um item abre o próximo do mesmo tipo', async () => {
  const { continuarLista } = await import('./note-blocks.ts');
  assert.deepEqual(continuarLista('- leite', '- leite\n'), { texto: '- leite\n- ', cursor: 10 });
  assert.deepEqual(continuarLista('* pão', '* pão\n'), { texto: '* pão\n* ', cursor: 8 });
  // marcado vira desmarcado: o item novo ainda não foi feito
  assert.deepEqual(continuarLista('- [x] feito', '- [x] feito\n'), { texto: '- [x] feito\n- [ ] ', cursor: 18 });
  assert.deepEqual(continuarLista('1. um', '1. um\n'), { texto: '1. um\n2. ', cursor: 9 });
  assert.deepEqual(continuarLista('9) nove', '9) nove\n'), { texto: '9) nove\n10) ', cursor: 12 });
  // o recuo é preservado
  assert.deepEqual(continuarLista('  - sub', '  - sub\n'), { texto: '  - sub\n  - ', cursor: 12 });
});

test('Enter no meio da nota, no meio de um item, ou com autocorretor junto', async () => {
  const { continuarLista } = await import('./note-blocks.ts');
  // no meio do texto: o resto continua depois do marcador novo
  assert.deepEqual(continuarLista('- a\n- c', '- a\n\n- c'), { texto: '- a\n- \n- c', cursor: 6 });
  // o Enter cai no meio do item: a metade de baixo ganha o marcador
  assert.deepEqual(continuarLista('- leite ovos', '- leite\n ovos'), { texto: '- leite\n-  ovos', cursor: 10 });
  // Gboard confirma a palavra corrigida e o Enter na mesma edição
  assert.deepEqual(continuarLista('- leit', '- leite\n'), { texto: '- leite\n- ', cursor: 10 });
});

test('Enter num item vazio sai da lista', async () => {
  const { continuarLista } = await import('./note-blocks.ts');
  assert.deepEqual(continuarLista('- leite\n- ', '- leite\n- \n'), { texto: '- leite\n', cursor: 8 });
  assert.deepEqual(continuarLista('- [ ] ', '- [ ] \n'), { texto: '', cursor: 0 });
});

test('fora de lista, colando várias linhas ou digitando letra, nada muda', async () => {
  const { continuarLista } = await import('./note-blocks.ts');
  assert.equal(continuarLista('texto', 'texto\n'), null);
  assert.equal(continuarLista('- a', '- a\nb\nc\n'), null);
  assert.equal(continuarLista('- a', '- ab'), null);
  assert.equal(continuarLista('- a\n', '- a'), null);
  // divisória não é lista
  assert.equal(continuarLista('---', '---\n'), null);
});
