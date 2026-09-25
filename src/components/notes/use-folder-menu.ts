import { useCallback } from 'react';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { actionSheet, confirmarApagarPasta, notesLabel } from '@/components/notes/note-actions';
import { useToast } from '@/components/ui/toast';
import { useDeleteFolder, useUpdateFolder, type NoteFolder } from '@/hooks/use-notes';

/**
 * O menu do LADRILHO de pasta — o que o toque longo abre quando o dedo não anda.
 *
 * A grade não tem menu de contexto (`ItemLink` desenha o nativo, e ele é para linha que navega),
 * e empurrar as ações para dentro da tela da pasta esconderia "fixar" e "cor" atrás de uma
 * navegação inteira. Aqui vale o idioma da tela inicial do iOS: segura, e ou você arrasta, ou
 * solta e escolhe.
 *
 * É hook e não componente porque ele não desenha nada: o sheet é nativo (`showItemActions`), e o
 * que ele precisa — mutation e toast — só existe dentro da árvore do React. Duas telas chamam
 * (a home e a de uma pasta, para as subpastas), e uma cópia em cada seria a segunda que diverge.
 *
 * Cor fica de fora do hook de propósito: ela abre um `<ColorPicker>`, que é estado e árvore da
 * TELA — o hook devolve o toque, a tela decide onde o sheet mora.
 */
export function useFolderMenu({ onColor }: { onColor: (folder: NoteFolder) => void }) {
  const toast = useToast();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();

  return useCallback(
    (folder: NoteFolder) => {
      actionSheet(
        {
          title: folder.name,
          message: notesLabel(folder.notes_count),
          // Apagar mora AQUI também (25/09/2026, *"Eu não consigo apagar uma pasta?"*): só existia
          // em "Gerenciar pastas", longe do ladrilho que a pessoa segura. Por último, destrutivo.
          options: [folder.pinned ? 'Desafixar' : 'Fixar', 'Cor', 'Arquivar', 'Abrir', 'Apagar'],
          destructiveIndex: 4,
        },
        (i) => {
          if (i === 0) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            updateFolder.mutate(
              { id: folder.id, pinned: !folder.pinned },
              { onError: () => toast({ message: 'Não deu para fixar a pasta.', tone: 'error' }) }
            );
          } else if (i === 1) {
            onColor(folder);
          } else if (i === 2) {
            updateFolder.mutate(
              { id: folder.id, archived: true },
              {
                onSuccess: () =>
                  toast({
                    message: 'Pasta arquivada.',
                    tone: 'success',
                    action: {
                      label: 'Desfazer',
                      onPress: () => updateFolder.mutate({ id: folder.id, archived: false }),
                    },
                  }),
                onError: () => toast({ message: 'Não deu para arquivar a pasta.', tone: 'error' }),
              }
            );
          } else if (i === 3) {
            router.push(`/notes/folder/${folder.id}`);
          } else if (i === 4) {
            confirmarApagarPasta(folder, () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              deleteFolder.mutate(folder.id, {
                onError: () => toast({ message: 'Não deu para apagar a pasta.', tone: 'error' }),
              });
            });
          }
        }
      );
    },
    [onColor, updateFolder, deleteFolder, toast]
  );
}
