import { useWindowDimensions } from 'react-native';
import type Animated from 'react-native-reanimated';
import type { useAnimatedRef } from 'react-native-reanimated';

import { FolderCard, folderTileHeight } from '@/components/notes/folder-card';
import { Reorderable } from '@/components/ui/reorderable';
import { Space } from '@/design/tokens';
import type { NoteFolder } from '@/hooks/use-notes';

/**
 * A grade de pastas — a home (pastas raiz) e a tela de uma pasta (subpastas).
 *
 * ## Duas colunas, três só em tela larga
 *
 * A 384dp com a calha de 16 sobram 352: em três colunas o ladrilho fica com 112, e nele o nome
 * de uma pasta de duas palavras quebra em três linhas. Duas colunas dão 172, que é onde
 * "Universidade" cabe numa linha só. Acima de 520dp (tablet, paisagem) cabem três.
 *
 * ## O toque longo, e por que ele não é o mesmo gesto da lista
 *
 * Ladrilho não tem menu de contexto — `ItemLink`, que é quem desenha o menu nativo, é para linha
 * que navega. Aqui o idioma é o da tela inicial do iOS: toque abre, toque longo levanta, e
 * soltar sem ter andado abre as ações. Na lista o toque longo já é do menu de contexto, e por
 * isso lá o gesto mora numa alça.
 */
export function FolderGrid({
  pastas,
  enabled,
  scrollRef,
  topInset,
  onDragStateChange,
  onOpen,
  onMenu,
  onReorder,
}: {
  pastas: NoteFolder[];
  enabled: boolean;
  scrollRef: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  topInset: number;
  onDragStateChange: (v: boolean) => void;
  onOpen: (folder: NoteFolder) => void;
  /** Toque longo sem arrastar. */
  onMenu: (folder: NoteFolder) => void;
  onReorder: (ids: string[]) => void;
}) {
  const { width, fontScale } = useWindowDimensions();

  return (
    <Reorderable
      data={pastas}
      keyExtractor={(f) => f.id}
      columns={width >= 520 ? 3 : 2}
      tileHeight={folderTileHeight(fontScale)}
      gap={Space.sm}
      enabled={enabled}
      activation="toque-longo"
      scrollRef={scrollRef}
      topInset={topInset}
      onDragStateChange={onDragStateChange}
      onTapItem={(i) => onMenu(pastas[i])}
      onReorder={onReorder}
      renderItem={({ item, active }) => (
        <FolderCard folder={item} dragging={active} onPress={() => onOpen(item)} />
      )}
    />
  );
}
