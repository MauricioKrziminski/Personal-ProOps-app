/**
 * Uma nota é uma lista de BLOCOS — e os blocos moram no próprio texto.
 *
 * ## Por que markdown no `content`, e não uma tabela de blocos
 *
 * O Notion guarda cada bloco como linha de banco, com id, tipo e pai. É o certo para um produto
 * cuja tela é a fonte da verdade. Aqui não é: **a nota nasce no WhatsApp**, como texto puro, e
 * volta para o WhatsApp como texto puro. Uma tabela de blocos obrigaria o agente a decidir tipo
 * de bloco no meio de uma transcrição de áudio, e obrigaria toda leitura a remontar o texto para
 * responder "quanto eu anotei?".
 *
 * Guardando a marcação DENTRO do texto, quatro coisas continuam de graça: o WhatsApp escreve e lê
 * sem saber que blocos existem, o `search_tsv` do Postgres continua indexando, copiar a nota
 * copia algo legível, e nenhuma migration é necessária para inventar um tipo novo de bloco.
 *
 * O preço é conhecido e aceito: sem blocos aninhados de profundidade arbitrária e sem arrastar
 * bloco para dentro de bloco. Se um dia isso fizer falta, aí sim vale a tabela — e a conversão é
 * um parser, que é este arquivo.
 *
 * ## A sintaxe
 *
 * É a do Markdown, porque é a que as pessoas já digitam sem aprender:
 *
 * | escreve | vira |
 * |---|---|
 * | `# texto` | título de seção |
 * | `## texto` | subtítulo |
 * | `- [ ] texto` / `- [x] texto` | item marcável |
 * | `- texto` ou `* texto` | item de lista |
 * | `1. texto` | item numerado |
 * | `> texto` | citação |
 * | `---` | divisória |
 * | qualquer outra coisa | parágrafo |
 *
 * A PRIMEIRA linha preenchida vira o título da nota — mas só se ela for parágrafo. Uma nota que
 * começa com um item marcável não promove o to-do a título (uma lista de compras não se chama
 * "leite"), e é por isso que `title` é decidido aqui e não por quem desenha.
 */

export type BlockKind =
  | 'title'
  | 'h1'
  | 'h2'
  | 'todo'
  | 'bullet'
  | 'numbered'
  | 'quote'
  | 'divider'
  | 'text';

export interface NoteBlock {
  /** Índice da linha no texto ORIGINAL. É por ele que o toggle reescreve. */
  index: number;
  kind: BlockKind;
  /** O conteúdo sem a marcação. Linha em branco não vira bloco. */
  text: string;
  /** Só em `todo`. */
  done?: boolean;
  /** Só em `numbered` — o número que a pessoa digitou. */
  order?: number;
}

const TODO = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;
const HEADING = /^(#{1,2})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** Classifica UMA linha. Exportada porque a barra de blocos precisa saber onde o cursor está. */
export function classify(line: string): { kind: Exclude<BlockKind, 'title'>; text: string; done?: boolean; order?: number } {
  const todo = TODO.exec(line);
  if (todo) return { kind: 'todo', text: todo[3], done: todo[2].toLowerCase() === 'x' };

  // Divisória ANTES de bullet: `---` casaria com `[-*]\s` se a ordem fosse outra? Não casaria
  // (não há espaço), mas a ordem explícita evita que alguém "conserte" o regex e quebre isso.
  if (DIVIDER.test(line)) return { kind: 'divider', text: '' };

  const head = HEADING.exec(line);
  if (head) return { kind: head[1].length === 1 ? 'h1' : 'h2', text: head[2].trim() };

  const num = NUMBERED.exec(line);
  if (num) return { kind: 'numbered', text: num[2], order: Number(num[1]) };

  const bullet = BULLET.exec(line);
  if (bullet) return { kind: 'bullet', text: bullet[1] };

  const quote = QUOTE.exec(line);
  if (quote) return { kind: 'quote', text: quote[1] };

  return { kind: 'text', text: line.trim() };
}

/**
 * O texto inteiro como blocos, pulando linhas em branco.
 *
 * Substitui `readLines` de `lib/search.ts`, que conhecia só dois tipos (título e checklist) e
 * mandava todo o resto para "parágrafo".
 */
export function noteBlocks(content: string): NoteBlock[] {
  const lines = content.split('\n');
  const firstFilled = lines.findIndex((l) => l.trim().length > 0);

  return lines.flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    const b = classify(line);
    // Só parágrafo vira título. Nota que abre em to-do, citação ou cabeçalho mantém o que é.
    const kind: BlockKind = index === firstFilled && b.kind === 'text' ? 'title' : b.kind;
    return [{ index, kind, text: b.text, done: b.done, order: b.order }];
  });
}

/** A marcação de cada tipo, para escrever de volta. `title` não tem marcação: é parágrafo. */
const PREFIX: Record<BlockKind, string> = {
  title: '',
  text: '',
  h1: '# ',
  h2: '## ',
  todo: '- [ ] ',
  bullet: '- ',
  numbered: '1. ',
  quote: '> ',
  divider: '---',
};

/** Onde o cursor está, em número de linha. `-1` quando não dá para saber. */
export function lineAt(content: string, cursor: number): number {
  if (cursor < 0) return -1;
  return content.slice(0, cursor).split('\n').length - 1;
}

/**
 * Converte a linha `index` para outro tipo de bloco, preservando o texto.
 *
 * É o verbo da barra de blocos: a pessoa põe o cursor numa linha e escolhe "virar item marcável".
 * Reaplicar o mesmo tipo **remove** a marcação (vira parágrafo) — é como o Notion e o Bear se
 * comportam, e evita o beco sem saída de transformar em citação e não conseguir voltar.
 */
export function setBlockKind(content: string, index: number, kind: BlockKind): string {
  const lines = content.split('\n');
  if (index < 0 || index >= lines.length) return content;

  const atual = classify(lines[index]);
  const alvo: BlockKind = atual.kind === kind ? 'text' : kind;

  if (alvo === 'divider') {
    lines[index] = '---';
  } else if (atual.kind === 'divider') {
    // Sair de divisória não tem texto para preservar — a linha começa vazia no tipo novo.
    lines[index] = PREFIX[alvo];
  } else {
    lines[index] = `${PREFIX[alvo]}${atual.text}`;
  }
  return lines.join('\n');
}

/**
 * Marca/desmarca o item da linha `index`.
 *
 * Reescreve SÓ aquela linha e mantém o recuo original: reconstruir o texto inteiro a partir dos
 * blocos apagaria as linhas em branco que a pessoa deixou de propósito entre parágrafos.
 */
export function toggleTodo(content: string, index: number): string {
  const lines = content.split('\n');
  if (index < 0 || index >= lines.length) return content;
  const m = TODO.exec(lines[index]);
  if (!m) return content;
  lines[index] = `${m[1]}- [${m[2].toLowerCase() === 'x' ? ' ' : 'x'}] ${m[3]}`;
  return lines.join('\n');
}

/** Quantos itens marcáveis existem e quantos estão feitos. Alimenta o resumo da lista. */
export function todoProgress(content: string): { done: number; total: number } {
  const todos = noteBlocks(content).filter((b) => b.kind === 'todo');
  return { done: todos.filter((b) => b.done).length, total: todos.length };
}
