import type { SymbolViewProps } from 'expo-symbols';

import { showItemActions } from '@/lib/item-actions';

/**
 * O wrapper de action sheet das telas de nota, uma vez só.
 *
 * Ele estava copiado VERBATIM em `notes/[id].tsx`, `notes/folders.tsx` e `notes/trash.tsx` — três
 * cópias de quinze linhas, cada uma com a mesma nota de rodapé explicando por que não usar
 * `Alert` (o do Android renderiza no máximo 3 botões e some com o resto, inclusive o destrutivo).
 * Três cópias é três coisas que divergem.
 */
export function actionSheet(
  config: { title?: string; message?: string; options: string[]; destructiveIndex?: number },
  onPick: (index: number) => void
) {
  const { title, message, options, destructiveIndex } = config;
  showItemActions(
    title ?? '',
    options.map((label, index) => ({
      label,
      destructive: index === destructiveIndex,
      onPress: () => onPick(index),
    })),
    message
  );
}

/**
 * `note_folders.icon` é texto livre no banco; aqui vira nome de SF Symbol com queda para `folder`.
 *
 * Estava duplicado em `[id].tsx` e `folders.tsx`. A queda importa: ícone que o mapa do `Icon` não
 * conhece vira o `circle` genérico no Android, e uma pasta sem ícone nenhum ficaria com um ponto.
 */
export function symbol(icon: string | null | undefined): SymbolViewProps['name'] {
  return (icon ?? 'folder') as SymbolViewProps['name'];
}

/** O catálogo fechado de ícones de pasta. Nunca emoji — a regra de design proíbe na chrome. */
export const FOLDER_ICONS: { name: string; label: string }[] = [
  { name: 'folder', label: 'pasta' },
  { name: 'briefcase', label: 'maleta' },
  { name: 'lightbulb', label: 'lâmpada' },
  { name: 'cart', label: 'carrinho' },
  { name: 'heart', label: 'coração' },
  { name: 'book', label: 'livro' },
  { name: 'airplane', label: 'avião' },
  { name: 'house', label: 'casa' },
  { name: 'dumbbell', label: 'halter' },
  { name: 'pills', label: 'remédios' },
  { name: 'gift', label: 'presente' },
  { name: 'graduationcap', label: 'formatura' },
];

export function notesLabel(count: number): string {
  return `${count} nota${count === 1 ? '' : 's'}`;
}

/**
 * A confirmação de apagar uma pasta, uma vez só: o toque longo no ladrilho e "Gerenciar pastas"
 * perguntam igual. Apagar a pasta nunca apaga nota nem subpasta (`on delete set null`): as notas
 * ficam em "Sem pasta" — e a frase diz isso antes do toque.
 */
export function confirmarApagarPasta(
  // `null` quando a contagem não é conhecida: a pasta ARQUIVADA não tem (`note_folder_counts()`
  // exclui arquivada), e dizer "vazia" ali seria mentir.
  folder: { name: string; notes_count: number | null },
  apagar: () => void
) {
  actionSheet(
    {
      title: `Apagar «${folder.name}»?`,
      message:
        folder.notes_count === null
          ? 'As notas dela ficam em "Sem pasta".'
          : folder.notes_count === 0
            ? 'A pasta está vazia.'
            : `As ${notesLabel(folder.notes_count)} ficam em "Sem pasta".`,
      options: ['Apagar pasta'],
      destructiveIndex: 0,
    },
    apagar
  );
}
