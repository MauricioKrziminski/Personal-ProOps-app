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

/**
 * Primeira linha não vazia do conteúdo — é o "título" da nota.
 *
 * Não existe coluna `title` de propósito: viria null em 100% das notas que chegam pelo WhatsApp e
 * a lista teria duas aparências.
 */
export function noteTitle(content: string): string {
  const first = content.split('\n').find((line) => line.trim().length > 0);
  return first?.trim() ?? '';
}

/** Corpo sem a primeira linha, para a prévia da lista não repetir o título. */
export function notePreview(content: string): string {
  const lines = content.split('\n');
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  return lines
    .slice(firstIndex + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHECKLIST_LINE = /^(\s*)-\s\[( |x|X)\]\s?(.*)$/;

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
