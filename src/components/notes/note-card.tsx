import { memo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, type ComposedGesture, type GestureType } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { ItemLink } from '@/components/ui/item-link';
import { Mark } from '@/components/ui/mark';
import { Fonts, type NoteColorName } from '@/constants/theme';
import { noteRail } from '@/design/note-colors';
import { HitTarget, Radius, Space, Type, tabular } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import type { Note } from '@/hooks/use-notes';
import { relativeBR } from '@/lib/dates';
import { todoProgress } from '@/lib/note-blocks';
import { noteTitle, notePreview } from '@/lib/search';
import type { ItemAction } from '@/lib/item-actions';

/**
 * O cartão de uma nota na lista.
 *
 * ## O trilho de cor
 *
 * Três pixels na borda esquerda, tinta cheia, e **só isso**. A cor de nota é conteúdo do usuário,
 * não estado da interface: pintar o cartão inteiro faria a lista competir com o único accent do
 * app e transformaria a tela num mosaico (`design.md` §2b).
 *
 * ⚠️ **Sem cor própria, a nota herda a da PASTA.** A pasta já identifica o lugar, e sem a herança
 * o trilho ficaria vazio em quase toda nota — a cor só apareceria em quem tivesse mexido nota por
 * nota, que é o oposto de "dá para reconhecer de relance".
 *
 * ## A alça de arrastar
 *
 * Só aparece no modo de ordem MANUAL, e o gesto vive nela — nunca no cartão inteiro. No iOS o
 * `ItemLink` é `Link.Menu`, ou seja `UIContextMenuInteraction`, que tem reconhecedor de toque
 * longo próprio: dois no mesmo cartão brigam. A alça pega ao primeiro movimento, como no
 * Lembretes do iOS.
 */

export interface NoteCardActions {
  onPin: (note: Note) => void;
  onMove: (note: Note) => void;
  onColor: (note: Note) => void;
  onArchive: (note: Note) => void;
  onTrash: (note: Note) => void;
}

export interface NoteCardProps {
  note: Note;
  folderName?: string;
  /** Cor da pasta, usada quando a nota não tem a própria. */
  folderColor?: NoteColorName | null;
  actions: NoteCardActions;
  /** Gesto de arrasto. Presente = modo manual, e a alça aparece. */
  drag?: ComposedGesture | GestureType;
  /** `true` enquanto ESTE cartão está levantado. */
  dragging?: boolean;
}

function NoteCardBase({ note, folderName, folderColor, actions, drag, dragging }: NoteCardProps) {
  // Dynamic Type XL: a prévia cai para uma linha para os metadados não sumirem da tela.
  const { fontScale } = useWindowDimensions();
  const theme = useTheme();
  const scheme = useScheme();

  const titulo = noteTitle(note.content) || 'Sem título';
  const previa = notePreview(note.content);
  const { done, total } = todoProgress(note.content);
  // Tag com o mesmo nome da pasta não vira metadado: `mercado · #mercado` gasta a linha inteira
  // para dizer a mesma coisa duas vezes.
  const tags = (note.tags ?? []).filter((t) => t.toLowerCase() !== folderName?.toLowerCase());

  const contagem = total > 0 ? `${done}/${total}` : null;
  const quando = relativeBR(note.updated_at);
  const trilho = noteRail(note.color ?? folderColor ?? null, scheme);

  const label = [
    titulo,
    folderName ? `pasta ${folderName}` : null,
    tags.length > 0 ? `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}` : null,
    contagem ? `${done} de ${total} itens feitos` : null,
    note.source === 'whatsapp' ? 'via WhatsApp' : null,
    `atualizada ${quando}`,
    note.pinned ? 'fixada' : null,
  ]
    .filter(Boolean)
    .join(', ');

  /**
   * Toda ação do arrasto existe TAMBÉM aqui.
   *
   * Arrastar não é acessível: quem usa leitor de tela nunca levanta um cartão. O menu é o
   * caminho dele — e é também o caminho de quem simplesmente não descobriu a alça.
   */
  const menu: ItemAction[] = [
    {
      label: note.pinned ? 'Desafixar' : 'Fixar',
      icon: note.pinned ? 'pin.slash' : 'pin',
      onPress: () => actions.onPin(note),
    },
    { label: 'Cor', icon: 'paintpalette', onPress: () => actions.onColor(note) },
    { label: 'Mover para pasta', icon: 'folder', onPress: () => actions.onMove(note) },
    { label: 'Arquivar', icon: 'archivebox', onPress: () => actions.onArchive(note) },
    { label: 'Lixeira', icon: 'trash', destructive: true, onPress: () => actions.onTrash(note) },
  ];

  return (
    <ItemLink href={`/notes/${note.id}`} title={titulo} actions={menu}>
      {({ onLongPress }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onLongPress={onLongPress}
          style={styles.alvo}>
          {({ pressed }) => (
            <View
              style={[
                styles.cartao,
                {
                  backgroundColor: pressed || dragging ? theme.backgroundSelected : theme.surface,
                  borderColor: theme.separator,
                },
              ]}>
              {trilho ? <View style={[styles.trilho, { backgroundColor: trilho }]} /> : null}

              <View style={styles.conteudo}>
                {/* Título e pin dividem a primeira linha: o pin fica no canto do cartão (padrão
                    do Keep), não como bullet antes do texto — ali ele lia como marcador. */}
                <View style={styles.cabeca}>
                  <ThemedText type="headline" style={styles.cresce}>
                    {titulo}
                  </ThemedText>
                  {note.pinned ? <Icon name="pin.fill" size="sm" color="tint" /> : null}
                  {drag ? <Alca gesture={drag} /> : null}
                </View>

                {previa ? (
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={fontScale >= 1.4 ? 1 : 2}>
                    {previa}
                  </ThemedText>
                ) : null}

                {/* Faixa de metadados com FORMA, não string corrida: pasta é pill, checklist é
                    ícone + contagem, origem é ícone, e a data vai encostada à direita. */}
                <View style={styles.meta}>
                  {folderName ? (
                    <View style={[styles.pilulaPasta, { backgroundColor: theme.accentSoft }]}>
                      <ThemedText themeColor="tint" style={styles.pilulaTexto}>
                        {folderName}
                      </ThemedText>
                    </View>
                  ) : null}

                  {contagem ? (
                    <View style={styles.pedaco}>
                      <Icon name="checkmark.circle" size={13} color="textSecondary" />
                      <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                        {contagem}
                      </ThemedText>
                    </View>
                  ) : null}

                  {/* A espiral marca o que a IA registrou — o quinto papel previsto em §2b. Um
                      balão de conversa diria "veio de um chat"; a marca diz "isto entrou pelo
                      ProOps", que é a informação que importa. */}
                  {note.source === 'whatsapp' ? (
                    <View style={styles.pedaco}>
                      <Mark size={13} color="textSecondary" />
                      <ThemedText type="caption" themeColor="textSecondary">
                        WhatsApp
                      </ThemedText>
                    </View>
                  ) : null}

                  <ThemedText
                    type="caption"
                    themeColor="textSecondary"
                    style={[styles.quando, tabular]}>
                    {quando}
                  </ThemedText>
                </View>
              </View>
            </View>
          )}
        </Pressable>
      )}
    </ItemLink>
  );
}

/**
 * O punho.
 *
 * `accessibilityElementsHidden` porque ele não é alcançável por leitor de tela de jeito nenhum —
 * e fingir que é, oferecendo um botão que não faz nada ao toque, é pior que não oferecer. Quem
 * navega por leitor move pelo menu de contexto, que tem as mesmas ações.
 */
function Alca({ gesture }: { gesture: ComposedGesture | GestureType }) {
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.alca}>
        <Icon name="line.3.horizontal" size="md" color="textSecondary" />
      </View>
    </GestureDetector>
  );
}

/** A lista redesenha o cartão inteiro a cada arrasto; sem `memo` são N re-renders por quadro. */
export const NoteCard = memo(NoteCardBase);

const styles = StyleSheet.create({
  /**
   * O cartão é uma `View` DENTRO do `Pressable`, não o próprio `Pressable`.
   *
   * `<Link asChild>` + `<Link.Trigger>` engolem o `style` do filho: padding e fundo postos no
   * `Pressable` simplesmente não aparecem — foi assim que o cartão ficou invisível e o texto
   * colado na borda.
   */
  alvo: { minHeight: HitTarget },
  cartao: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    // Cartão OUTLINED, não elevated: quem desenha a borda é a hairline, não a sombra. É o que
    // Linear e Notion fazem, e funciona nos dois temas.
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  /** O trilho sangra de topo a base porque é IDENTIDADE do cartão, não um ponto ao lado dele. */
  trilho: { width: 3, alignSelf: 'stretch' },
  conteudo: { flex: 1, gap: Space.xs + 2, padding: Space.lg },
  cabeca: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: 2 },
  /** Pasta é LUGAR: ganha pill no accent suave. Origem e checklist são fatos: ficam em texto. */
  pilulaPasta: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
    maxWidth: 130,
  },
  pilulaTexto: {
    ...Type.caption,
    // Peso é FAMÍLIA (§3): no Android a fonte custom IGNORA `fontWeight` e cai no regular com
    // negrito sintético — ficava certo só no iOS.
    fontFamily: Fonts.semibold,
  },
  pedaco: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  /** Encostada à direita: a data é a âncora que faz as linhas lerem como coluna. */
  quando: { marginLeft: 'auto' },
  cresce: { flex: 1 },
  alca: {
    width: HitTarget - 12,
    height: HitTarget - 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Space.sm,
  },
});
