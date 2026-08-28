/**
 * Termo de busca do usuário → `tsquery` do Postgres.
 *
 * A coluna `notes.search_tsv` usa a config `pt_unaccent` (portuguese + unaccent), então acento e
 * plural já são resolvidos no banco. O que sobra para o cliente é montar um tsquery seguro e com
 * **prefixo no último termo** — é o prefixo que faz busca-enquanto-digita funcionar
 * ("reuni" acha "reunião"). `websearch_to_tsquery` não faz prefixo, por isso montamos à mão.
 */
export function toTsQuery(input: string): string {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);

  if (terms.length === 0) return '';

  return terms.map((term, i) => (i === terms.length - 1 ? `${term}:*` : term)).join(' & ');
}

const CHECKLIST_LINE = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

/**
 * Linha como ela é LIDA, sem a marcação que só existe para o texto voltar inteiro ao WhatsApp.
 *
 * Título e prévia mostram conteúdo, não fonte: sem isto a lista exibia `- [x] leite - [ ] pão`.
 * Mora aqui, e não em cada tela, porque `noteTitle` alimenta título de tela, action sheet e
 * rótulo de acessibilidade — oito chamadas que teriam o mesmo vazamento.
 */
function stripMarkup(line: string): string {
  return CHECKLIST_LINE.exec(line)?.[3] ?? line;
}

/**
 * A `#tag` já é mostrada na faixa de metadados da linha. Repetida dentro da prévia ela vira
 * ruído — e numa lista de 20 notas o olho lê o mesmo token duas vezes por linha.
 */
function stripTags(text: string): string {
  return text.replace(/(^|\s)#[a-z0-9_]{2,30}\b/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Primeira linha não vazia do conteúdo — é o "título" da nota.
 *
 * Não existe coluna `title` de propósito: viria null em 100% das notas que chegam pelo WhatsApp e
 * a lista teria duas aparências.
 */
export function noteTitle(content: string): string {
  const first = content.split('\n').find((line) => line.trim().length > 0);
  return stripMarkup(first?.trim() ?? '');
}

/** Corpo sem a primeira linha, para a prévia da lista não repetir o título. */
export function notePreview(content: string): string {
  const lines = content.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  const body = lines
    .slice(firstIndex + 1)
    .map(stripMarkup)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripTags(body);
}

export interface ChecklistItem {
  index: number;
  done: boolean;
  text: string;
}

/**
 * Checklist mora dentro do próprio texto (`- [ ]` / `- [x]`), não em jsonb nem em tabela filha:
 * é o que mantém a nota sendo texto puro que volta para o WhatsApp.
 */
export function parseChecklist(content: string): ChecklistItem[] {
  return content.split('\n').flatMap((line, index) => {
    const m = CHECKLIST_LINE.exec(line);
    if (!m) return [];
    return [{ index, done: m[2].toLowerCase() === 'x', text: m[3] }];
  });
}

/** Marca/desmarca UMA linha, preservando o resto do texto exatamente como está. */
export function toggleChecklistLine(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return content;

  const m = CHECKLIST_LINE.exec(line);
  if (!m) return content;

  const done = m[2].toLowerCase() === 'x';
  lines[lineIndex] = `${m[1]}- [${done ? ' ' : 'x'}] ${m[3]}`;
  return lines.join('\n');
}

/** Nome de pasta normalizado — o `check` do banco exige `lower(trim())` com no máximo 40. */
export function normalizeFolderName(name: string): string {
  return name.toLowerCase().trim().slice(0, 40);
}

/**
 * Termo seguro para dentro de um filtro `or=(col.ilike.%termo%,…)` do PostgREST.
 *
 * `URLSearchParams` percent-encoda o valor, então não há como escapar para outro parâmetro, e a
 * RLS continua limitando ao workspace — **não é brecha de segurança**. Mas os metacaracteres do
 * PostgREST (`,` separa condições, `()` agrupam) e os curingas do `ilike` (`%`, `_`) quebram a
 * query com 400: buscar `compra (mercado)` hoje falha.
 *
 * Por isso é allowlist, não blocklist: letra, número, espaço e hífen passam; o resto vira espaço.
 */
export function toIlikeTerm(input: string): string {
  return input
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * `#tag` sai do próprio texto — é a MESMA regra do `note_tags_of` que gera `notes.tags` no banco.
 *
 * A coluna é `GENERATED ALWAYS`: não dá para escrever nela. Por isso editar tag é editar TEXTO,
 * e não um campo à parte. É o que mantém a nota sendo texto puro que volta inteiro para o
 * WhatsApp — a decisão original do produto — enquanto a tela oferece chips de verdade.
 */
export const TAG_RE = /#([a-z0-9_]{2,30})/gi;

export function tagsOf(content: string): string[] {
  const found = Array.from(content.matchAll(TAG_RE), (m) => m[1].toLowerCase());
  return Array.from(new Set(found)).sort();
}

/** Normaliza o que o usuário digitou: sem `#`, minúsculo, só o que o banco reconhece como tag. */
export function normalizeTag(input: string): string {
  return input.trim().replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** Tag válida é a que o banco vai enxergar — senão o chip apareceria e sumiria no salvamento. */
export function isValidTag(tag: string): boolean {
  return /^[a-z0-9_]{2,30}$/.test(tag);
}

/** Acrescenta `#tag` no fim do texto. Já presente (em qualquer caixa) → não duplica. */
export function addTag(content: string, tag: string): string {
  const clean = normalizeTag(tag);
  if (!isValidTag(clean) || tagsOf(content).includes(clean)) return content;
  const body = content.replace(/\s+$/, '');
  return body.length === 0 ? `#${clean}` : `${body} #${clean}`;
}

/** Tira todas as ocorrências de `#tag` do texto, sem deixar espaço duplo nem linha só de espaço. */
export function removeTag(content: string, tag: string): string {
  const clean = normalizeTag(tag);
  if (!clean) return content;
  return content
    .split('\n')
    .map((line) =>
      line
        .replace(new RegExp(`(^|\\s)#${clean}\\b`, 'gi'), '$1')
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]+$/, '')
    )
    .join('\n');
}
