import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { noteInk, noteTile } from '@/design/note-colors';
import { Radius, Space, tabular } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import type { NoteFolder } from '@/hooks/use-notes';
import { symbol } from '@/components/notes/note-actions';

/**
 * Altura do ladrilho — é dela que sai a aritmética exata do slot na grade.
 *
 * ⚠️ **Ela CRESCE com a fonte do sistema.** O ladrilho tem altura fixa e três textos dentro: a
 * 1,3× o nome em `smallBold` mais a contagem passam de 108 e o conteúdo sai pela borda. É a mesma
 * armadilha da face do cartão de crédito (`design.md` §1) — apertar o teto de escala até caber é
 * desligar o Dynamic Type com outro nome.
 *
 * É FUNÇÃO e não constante porque quem posiciona os slots é a tela: o cartão e a grade precisam
 * do mesmo número, e um `* fontScale` escrito num dos dois lados é o defeito que não dá erro.
 */
export function folderTileHeight(fontScale: number): number {
  return Math.round(108 * Math.max(1, fontScale));
}

/**
 * O ladrilho de uma pasta na grade da home.
 *
 * ## Por que a pasta virou LUGAR e não continua um chip de filtro
 *
 * Como chip, ela era um recorte da mesma lista — e a tela abria com quatro fileiras de controle
 * antes da primeira nota. Como ladrilho, ela é um destino: tem ícone, cor, contagem e abre uma
 * tela própria. Os chips de PASTA saíram junto; os de TAG ficaram, porque tag é transversal e
 * recorta a tela inteira, incluindo as pastas.
 *
 * ## A cor mora no LADRILHO do ícone, não no ladrilho inteiro
 *
 * O fundo do quadradinho do ícone é a cor misturada com a superfície (18%), e o glifo é a tinta
 * cheia. O cartão continua sendo `surface` do tema. É a mesma fronteira do trilho de 3px na
 * nota: cor de conteúdo vive em geometria fechada e nunca vira superfície de tela.
 */

function FolderCardBase({
  folder,
  onPress,
  dragging,
}: {
  folder: NoteFolder;
  onPress: () => void;
  /** `true` enquanto ESTE ladrilho está levantado. */
  dragging?: boolean;
}) {
  const theme = useTheme();
  const scheme = useScheme();

  const fundo = noteTile(folder.color, theme.surface, scheme) ?? theme.backgroundElement;
  const tinta = noteInk(folder.color, scheme);

  const label = [
    folder.name,
    `${folder.notes_count} nota${folder.notes_count === 1 ? '' : 's'}`,
    folder.pinned ? 'fixada' : null,
    folder.tags.length > 0 ? folder.tags.map((t) => `tag ${t}`).join(', ') : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.alvo}>
      {({ pressed }) => (
        <View
          style={[
            styles.ladrilho,
            {
              backgroundColor: pressed || dragging ? theme.backgroundSelected : theme.surface,
              borderColor: theme.cardBorder,
            },
          ]}>
          <View style={styles.topo}>
            {/*
              ⚠️ **Quem carrega a cor é o LADRILHO, não o glifo.**
              `Icon` só aceita nome de token de tema, e com razão — cor crua em tela é o que o
              `anti-slop.test.ts` existe para impedir. Tingir o glifo pediria um furo no
              primitivo (ou um truque de blend que não tem valor válido nas duas plataformas).
              O ladrilho colorido com contorno na tinta cheia dá o mesmo reconhecimento à
              distância, mantém o glifo legível e não encosta no contrato do `Icon`.
            */}
            <View
              style={[
                styles.icone,
                { backgroundColor: fundo, borderColor: tinta ?? 'transparent' },
                tinta ? styles.contornado : null,
              ]}>
              <Icon name={symbol(folder.icon)} size="md" color={tinta ? 'text' : 'textSecondary'} />
            </View>
            {folder.pinned ? <Icon name="pin.fill" size="sm" color="tint" /> : null}
          </View>

          {/*
            Nome NUNCA trunca: é identificador (§7). Não coube em duas linhas, a fonte não é o
            problema — o ladrilho é que está estreito, e aí quem cede é o layout.

            ⚠️ **`flexShrink: 0` porque a grade entra com `FadeInDown`** (§3, 15/09/2026): o Yoga
            mede o filho enquanto o contêiner animado ainda está chegando e, com o `flexShrink: 1`
            que o `ThemedText` traz na base, ele prefere ENCOLHER a quebrar — encolhido naquele
            instante, o texto não se remede nunca mais. Foi assim que "App bloqueado" virou "App"
            no APK de release, invisível no dev.
          */}
          <ThemedText type="smallBold" style={styles.nome}>
            {folder.name}
          </ThemedText>

          <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
            {folder.notes_count}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

export const FolderCard = memo(FolderCardBase);

const styles = StyleSheet.create({
  alvo: { flex: 1 },
  ladrilho: {
    flex: 1,
    gap: Space.xs,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
  },
  topo: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  icone: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  /** Contorno na tinta cheia: no escuro, 18% de mistura sozinho quase não separa duas cores. */
  contornado: { borderWidth: 1.5 },
  nome: { flexShrink: 0, maxWidth: '100%' },
});
