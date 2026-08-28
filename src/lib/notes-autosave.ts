/**
 * A decisão "pode gravar?" do autosave da nota, isolada do componente para ter teste.
 *
 * Em 28/08/2026 uma nota vinda do WhatsApp voltou do detalhe com `content` vazio **e**
 * `folder_id` nulo. Foi restaurada à mão. O gatilho não tinha explicação — até aparecer no
 * `logcat` do emulador, às 13:56 do mesmo dia:
 *
 *     E ReactNativeJS: { [ReferenceError: Property 'tagsOf' doesn't exist]
 *       componentStack: '\n    at NoteDetailScreen (…/notes/[id].bundle…)'
 *
 * O Fast Refresh entregou um módulo incompleto enquanto a tela estava aberta, ela lançou no
 * render, e o React remontou. Nesse caminho o `useState` volta ao inicial (`content: ''`,
 * `folderId: null`) — que é exatamente o par de valores que foi gravado. É dev-only (Fast Refresh
 * não existe em produção), mas o app roda em dev client no aparelho, então o risco era real.
 *
 * A regra que fecha a classe inteira: **estado que nunca foi hidratado, ou que voltou ao inicial,
 * não grava por cima de linha que tem conteúdo.** Apagar nota é a Lixeira, que perdoa; autosave
 * silencioso não.
 */
export interface AutosaveState {
  /** `true` depois de copiar a linha do banco para o estado (ou em modo criação). */
  hydrated: boolean;
  /** A nota já foi para a lixeira nesta sessão de tela. */
  trashed: boolean;
  /** `null` até o primeiro insert. */
  id: string | null;
  text: string;
  folderId: string | null;
  /** O que está gravado, na última vez que soubemos. `null` antes da hidratação. */
  persisted: { content: string; folderId: string | null } | null;
}

export type SkipReason =
  | 'trashed'
  | 'not-hydrated'
  | 'unchanged'
  | 'empty-new'
  | 'would-empty';

/** `null` significa **pode gravar**. Qualquer string é o motivo de não gravar. */
export function skipReason(state: AutosaveState): SkipReason | null {
  if (state.trashed) return 'trashed';
  // Antes da hidratação `text` é '' — gravar aqui APAGARIA a nota que ainda está carregando.
  if (!state.hydrated) return 'not-hydrated';

  const last = state.persisted;
  if (last && last.content === state.text && last.folderId === state.folderId) return 'unchanged';

  const blank = state.text.trim() === '';
  // Nota em branco nunca é inserida — é a "nota vazia piscando na lista de todo mundo".
  if (!state.id && blank) return 'empty-new';
  // E nunca ESVAZIA uma nota que já tinha texto.
  if (state.id && blank && (last?.content ?? '').trim() !== '') return 'would-empty';

  return null;
}
