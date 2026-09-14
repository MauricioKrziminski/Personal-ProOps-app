import Animated, {
  LinearTransition,
  SlideOutRight,
  type useAnimatedRef,
} from 'react-native-reanimated';

import { NoteCard, type NoteCardActions } from '@/components/notes/note-card';
import { Reorderable } from '@/components/ui/reorderable';
import { Motion } from '@/design/tokens';
import type { Note, NoteFolder } from '@/hooks/use-notes';

/**
 * Um ESCOPO de notas arrastáveis — a home usa dois (fixadas e soltas), a tela de uma pasta usa um.
 *
 * ⚠️ **Escopos separados não são detalhe de layout.** Cada `onReorder` manda `ord 1..N` para a
 * RPC, e a leitura é `pinned desc, position asc`: com fixadas e soltas no MESMO escopo, o
 * primeiro arrasto daria posição 1 a uma nota solta e ela subiria para o meio das fixadas. Dois
 * escopos mantêm os dois grupos inteiros sem o banco precisar saber que existe uma seção.
 *
 * ⚠️ **A alça só existe com `enabled`.** Um punho que aparece e não arrasta (ordem por data,
 * busca ativa) é pior que punho nenhum: ele promete um gesto que a tela recusa em silêncio.
 */
export function NoteList({
  notas,
  acoes,
  folderById,
  showFolder = true,
  enabled,
  scrollRef,
  topInset,
  viewportHeight,
  onDragStateChange,
  onReorder,
}: {
  notas: Note[];
  acoes: NoteCardActions;
  /** A nota herda o nome e a COR da pasta quando não tem cor própria. */
  folderById: (id: string | null) => NoteFolder | undefined;
  /**
   * Mostrar a pílula com o nome da pasta.
   *
   * `false` DENTRO de uma pasta: ali a pílula repete o título da tela em toda linha, e a cor do
   * trilho já diz de qual pasta a nota herdou. A cor continua vindo — ela identifica, a palavra
   * só ecoa.
   */
  showFolder?: boolean;
  enabled: boolean;
  scrollRef: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  topInset: number;
  /** Altura VISÍVEL da rolagem. Sem ela o auto-scroll mede pela janela e só dispara tarde. */
  viewportHeight: number;
  onDragStateChange: (v: boolean) => void;
  onReorder: (ids: string[]) => void;
}) {
  return (
    <Reorderable
      data={notas}
      keyExtractor={(n) => n.id}
      enabled={enabled}
      activation="alça"
      scrollRef={scrollRef}
      topInset={topInset}
      viewportHeight={viewportHeight || undefined}
      onDragStateChange={onDragStateChange}
      onReorder={onReorder}
      renderItem={({ item, active, drag }) => {
        const pasta = folderById(item.folder_id);
        return (
          // `layout` fecha o buraco quando uma nota é fixada ou movida — a lista se reorganiza
          // andando, não piscando. `exiting` é a outra metade: arquivar e mandar para a lixeira
          // SAEM pela direita, que é a direção de "tirei isto daqui".
          <Animated.View
            layout={LinearTransition.duration(Motion.duration.base)}
            exiting={SlideOutRight.duration(Motion.duration.exit)}>
            <NoteCard
              note={item}
              folderName={showFolder ? pasta?.name : undefined}
              folderColor={pasta?.color ?? null}
              actions={acoes}
              drag={enabled ? drag : undefined}
              dragging={active}
            />
          </Animated.View>
        );
      }}
    />
  );
}
