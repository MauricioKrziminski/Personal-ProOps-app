/**
 * Marcação INLINE dentro de uma linha de nota — negrito, itálico, riscado e mono.
 *
 * ## Por que a sintaxe é a do WhatsApp, e não a do Markdown
 *
 * `note-blocks.ts` já explica por que a marcação de BLOCO mora dentro do texto: a nota nasce no
 * WhatsApp como texto puro e volta para lá como texto puro. A marcação inline herda a mesma
 * restrição, e ela decide a sintaxe sozinha: `**negrito**` do Markdown chegaria no WhatsApp com
 * os asteriscos à mostra, enquanto `*negrito*` **renderiza como negrito nos dois lados**. O mesmo
 * para `_itálico_`, `~riscado~` e `` `mono` ``.
 *
 * Medido antes de escolher (staging, 14/09/2026): das notas existentes, **zero** usavam `*…*`,
 * `_…_`, `~…~` ou `**…**`. Não havia legado para honrar.
 *
 * ## Por que um scanner, e não um regex
 *
 * As regras de abertura e fechamento dependem do caractere ANTERIOR e do SEGUINTE, o que em regex
 * pede lookbehind — e o suporte do Hermes a lookbehind não é algo em que valha apostar uma
 * feature de texto. O scanner também é imune a backtracking catastrófico, que é o modo de falha
 * de um regex de delimitadores aninhados sobre texto que o usuário escreve.
 *
 * ## As regras, e o que elas protegem
 *
 * Um delimitador **abre** quando vem no começo da linha ou depois de espaço/`([{"'`, e é seguido
 * de algo que não é espaço. **Fecha** quando vem depois de algo que não é espaço e é seguido de
 * fim de linha ou de espaço/pontuação de fechamento.
 *
 * - `snake_case` e `__init__` ficam intocados: o `_` vem depois de letra, então não abre.
 * - `2*3*4` não vira negrito: o `*` vem depois de dígito.
 * - `*negrito*` no começo da linha não vira item de lista: `BULLET` em `note-blocks.ts` exige
 *   **espaço** depois do `-`/`*`, e aqui não há.
 * - `***` continua divisória: `DIVIDER` exige três ou mais e é testado ANTES, no classificador
 *   de blocos — este arquivo só recebe o texto de um bloco já classificado.
 *
 * ⚠️ Dentro de `` ` `` nada mais é interpretado, como em qualquer markdown: `` `a_b_c` `` é mono
 * com underscores literais. É a única forma de escrever um trecho de código sem lutar contra o
 * formatador.
 */

export type Mark = 'bold' | 'italic' | 'strike' | 'code';

export interface InlineSpan {
  text: string;
  marks: Mark[];
}

/** O caractere de cada marca. É por ele que se escreve de volta. */
export const DELIM: Record<Mark, string> = {
  bold: '*',
  italic: '_',
  strike: '~',
  code: '`',
};

const MARK_OF: Record<string, Mark> = { '*': 'bold', _: 'italic', '~': 'strike', '`': 'code' };

/** Antes de um delimitador que ABRE só pode haver começo de linha, espaço ou abertura. */
const ANTES_DE_ABRIR = new Set([' ', '\t', '(', '[', '{', '"', "'", '“', '‘', '—', '–']);
/** Depois de um delimitador que FECHA só pode haver fim de linha, espaço ou pontuação. */
const DEPOIS_DE_FECHAR = new Set([
  ' ', '\t', '.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'", '”', '’', '—', '–',
]);

/**
 * Delimitador colado em delimitador, para `*_urgente_*` aninhar.
 *
 * ⚠️ Tem de ser um caractere DIFERENTE. Aceitando o mesmo, `__init__` abriria itálico no segundo
 * `_` e fecharia no penúltimo — o nome da função apareceria como `_init_` com "init" em itálico,
 * que é exatamente o que a regra do `_` existe para impedir.
 */
function vizinhoDelimitador(vizinho: string | undefined, atual: string): boolean {
  return vizinho !== undefined && vizinho !== atual && MARK_OF[vizinho] !== undefined;
}

function podeAbrir(text: string, i: number): boolean {
  const antes = i === 0 ? '' : text[i - 1];
  const depois = text[i + 1];
  if (depois === undefined || depois === ' ' || depois === '\t') return false;
  if (depois === text[i]) return false; // `**` vazio não abre nada
  return antes === '' || ANTES_DE_ABRIR.has(antes) || vizinhoDelimitador(antes, text[i]);
}

function podeFechar(text: string, i: number): boolean {
  const antes = text[i - 1];
  const depois = text[i + 1];
  if (antes === undefined || antes === ' ' || antes === '\t') return false;
  if (depois === undefined) return true;
  return DEPOIS_DE_FECHAR.has(depois) || vizinhoDelimitador(depois, text[i]);
}

/**
 * Onde cada par casado começa e termina.
 *
 * Devolve dois mapas por índice de caractere: `abre[i]` e `fecha[i]` dizem qual marca aquele
 * delimitador governa. Delimitador solto (sem par) não entra em nenhum dos dois e por isso é
 * renderizado como texto comum — escrever `3 * 4` continua escrevendo `3 * 4`.
 */
function casar(text: string): { abre: Map<number, Mark>; fecha: Map<number, Mark> } {
  const abre = new Map<number, Mark>();
  const fecha = new Map<number, Mark>();
  const pilha: { i: number; mark: Mark }[] = [];

  for (let i = 0; i < text.length; i++) {
    const mark = MARK_OF[text[i]];
    if (!mark) continue;

    // Mono é literal: do primeiro ` até o próximo, sem interpretar nada no meio.
    if (mark === 'code') {
      if (!podeAbrir(text, i)) continue;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '`' && podeFechar(text, j)) {
          abre.set(i, 'code');
          fecha.set(j, 'code');
          i = j;
          break;
        }
      }
      continue;
    }

    // Fechar tem precedência sobre abrir: em `*a*` o segundo `*` poderia abrir de novo
    // (`*` seguido de fim de linha não abre, mas `*a* *b*` sim), e sem a precedência o par
    // casaria errado e o segundo trecho ficaria sem marca.
    // Laço em vez de `findLastIndex`: o método é ES2023 e não vale apostar uma feature de
    // texto no suporte do Hermes.
    let aberto = -1;
    for (let k = pilha.length - 1; k >= 0; k--) {
      if (pilha[k].mark === mark) { aberto = k; break; }
    }
    if (aberto !== -1 && podeFechar(text, i)) {
      abre.set(pilha[aberto].i, mark);
      fecha.set(i, mark);
      pilha.length = aberto; // o que ficou aberto por dentro nunca casou: descarta
      continue;
    }
    if (podeAbrir(text, i)) pilha.push({ i, mark });
  }

  return { abre, fecha };
}

/** A linha quebrada em trechos, cada um com as marcas que valem ali. */
export function parseInline(text: string): InlineSpan[] {
  const { abre, fecha } = casar(text);
  if (abre.size === 0) return text ? [{ text, marks: [] }] : [];

  const spans: InlineSpan[] = [];
  const ativas: Mark[] = [];
  let buffer = '';

  const despeja = () => {
    if (buffer) spans.push({ text: buffer, marks: [...ativas] });
    buffer = '';
  };

  for (let i = 0; i < text.length; i++) {
    const inicia = abre.get(i);
    const termina = fecha.get(i);

    if (inicia !== undefined) {
      despeja();
      ativas.push(inicia);
      if (inicia === 'code') {
        // O conteúdo do mono vai inteiro, sem interpretar delimitador nenhum.
        let j = i + 1;
        while (j < text.length && fecha.get(j) !== 'code') j++;
        spans.push({ text: text.slice(i + 1, j), marks: [...ativas] });
        ativas.pop();
        i = j;
      }
      continue;
    }
    if (termina !== undefined) {
      despeja();
      const at = ativas.lastIndexOf(termina);
      if (at !== -1) ativas.splice(at, 1);
      continue;
    }
    buffer += text[i];
  }
  despeja();

  return spans.filter((s) => s.text.length > 0);
}

/**
 * O texto como ele é LIDO, sem os delimitadores casados.
 *
 * ⚠️ `stripMarkup` em `src/lib/search.ts` PRECISA chamar isto. Sem ele o `*` vaza para o título e
 * para a prévia da lista — o mesmo defeito que aconteceu quando os blocos nasceram e a lista
 * passou a exibir `# Feira` com o jogo-da-velha à mostra.
 */
export function stripInline(text: string): string {
  return parseInline(text)
    .map((s) => s.text)
    .join('');
}

/**
 * Quais marcas valem na posição `i` do texto CRU. Alimenta o estado da barra de formatação.
 *
 * Derivado de `casar`, nunca de procurar o trecho com `indexOf`: numa linha como
 * `*leite* e mais leite` o segundo "leite" casaria com o primeiro e a barra acenderia o negrito
 * no lugar errado.
 */
export function marksAt(text: string, i: number): Mark[] {
  const { abre, fecha } = casar(text);
  const ativas: Mark[] = [];
  for (let k = 0; k < Math.min(i, text.length); k++) {
    const inicia = abre.get(k);
    if (inicia !== undefined) { ativas.push(inicia); continue; }
    const termina = fecha.get(k);
    if (termina !== undefined) {
      const at = ativas.lastIndexOf(termina);
      if (at !== -1) ativas.splice(at, 1);
    }
  }
  return ativas;
}

/**
 * Liga ou desliga uma marca no trecho selecionado, devolvendo o texto novo e onde o cursor fica.
 *
 * Três comportamentos, nessa ordem:
 *
 * 1. **Seleção vazia** — insere o par e põe o cursor no meio, para a pessoa digitar já formatado.
 * 2. **Já envolvido** (`*leite*` com "leite" selecionado) — tira os dois delimitadores. Sem isto
 *    virar negrito seria caminho de mão única, o mesmo beco que `setBlockKind` evita ao desfazer.
 * 3. **Caso normal** — envolve. O espaço nas pontas da seleção fica FORA: um delimitador seguido
 *    de espaço não abre (é a regra do WhatsApp), então `*leite *` não viraria negrito nenhum —
 *    o usuário veria o asterisco e nada acontecendo.
 */
export function toggleMark(
  text: string,
  start: number,
  end: number,
  mark: Mark
): { text: string; selection: { start: number; end: number } } {
  const d = DELIM[mark];
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.max(0, Math.max(start, end), 0);
  const fim = Math.min(b, text.length);

  if (a === fim) {
    return {
      text: `${text.slice(0, a)}${d}${d}${text.slice(a)}`,
      selection: { start: a + 1, end: a + 1 },
    };
  }

  if (text[a - 1] === d && text[fim] === d) {
    return {
      text: `${text.slice(0, a - 1)}${text.slice(a, fim)}${text.slice(fim + 1)}`,
      selection: { start: a - 1, end: fim - 1 },
    };
  }

  const bruto = text.slice(a, fim);
  const esquerda = bruto.length - bruto.trimStart().length;
  const direita = bruto.length - bruto.trimEnd().length;
  const miolo = bruto.trim();
  if (!miolo) return { text, selection: { start, end } };

  const antes = text.slice(0, a + esquerda);
  const depois = text.slice(fim - direita);
  return {
    text: `${antes}${d}${miolo}${d}${depois}`,
    selection: { start: a + esquerda + 1, end: a + esquerda + 1 + miolo.length },
  };
}
