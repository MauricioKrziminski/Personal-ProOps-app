import { useCallback } from 'react';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { actionSheet, confirmarApagarPasta, notesLabel } from '@/components/notes/note-actions';
import { useMoverPasta } from '@/components/notes/nova-pasta';
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
export function useFolderMenu({
  onColor,
  onRename,
  pastas,
}: {
  onColor: (folder: NoteFolder) => void;
  /** Renomear e trocar o ícone abrem a folha da pasta (`NovaPastaSheet`) — estado da TELA. */
  onRename: (folder: NoteFolder) => void;
  /** A árvore inteira: "Mover para dentro de…" não oferece a própria pasta nem as filhas dela. */
  pastas: NoteFolder[];
}) {
  const toast = useToast();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();
  const mover = useMoverPasta(pastas);

  return useCallback(
    (folder: NoteFolder) => {
      const fixar = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        updateFolder.mutate(
          { id: folder.id, pinned: !folder.pinned },
          { onError: () => toast({ message: 'Não deu para fixar a pasta.', tone: 'error' }) }
        );
      };
      const arquivar = () =>
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
      const apagar = () =>
        confirmarApagarPasta(folder, () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          deleteFolder.mutate(folder.id, {
            onError: () => toast({ message: 'Não deu para apagar a pasta.', tone: 'error' }),
          });
        });
      // Editar ONDE a pasta está (25/09/2026): renomear e mover só existiam em Organizar pastas.
      // Apagar por último, destrutivo.
      const opcoes: { label: string; run: () => void }[] = [
        { label: folder.pinned ? 'Desafixar' : 'Fixar', run: fixar },
        { label: 'Cor', run: () => onColor(folder) },
        { label: 'Renomear', run: () => onRename(folder) },
        { label: 'Mover para dentro de…', run: () => mover(folder) },
        { label: 'Arquivar', run: arquivar },
        { label: 'Abrir', run: () => router.push(`/notes/folder/${folder.id}`) },
        { label: 'Apagar', run: apagar },
      ];
      actionSheet(
        {
          title: folder.name,
          message: notesLabel(folder.notes_count),
          options: opcoes.map((o) => o.label),
          destructiveIndex: opcoes.length - 1,
        },
        (i) => {
          if (i !== undefined) opcoes[i]?.run();
        }
      );
    },
    [onColor, onRename, mover, updateFolder, deleteFolder, toast]
  );
}
