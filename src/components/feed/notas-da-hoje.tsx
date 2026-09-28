import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon } from '@/components/ui/icon';
import type { NoteColorName } from '@/constants/theme';
import { notePalette } from '@/design/note-colors';
import { Radius, Space, tabular } from '@/design/tokens';
import { PaletaTingida, useScheme, useTheme } from '@/hooks/use-theme';
import type { Note } from '@/hooks/use-notes';
import { relativeBR } from '@/lib/dates';
import { todoProgress } from '@/lib/note-blocks';
import { notePreview, noteTitle } from '@/lib/search';

/**
 * A largura do cartão: dois inteiros e a ponta do terceiro a 384dp — a ponta diz "rola". Cresce
 * com a fonte do sistema (até 1,35×): com 164dp fixos, a 1,3× a prévia virava uma coluna de cinco
 * linhas de uma palavra.
 */
const LARGURA = 164;

function CartaoDeNota({
  nota,
  corDaPasta,
  onOpen,
}: {
  nota: Note;
  corDaPasta: NoteColorName | null;
  onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const { fontScale } = useWindowDimensions();
  const largura = Math.round(LARGURA * Math.min(1.35, Math.max(1, fontScale)));
  const paleta = notePalette(nota.color ?? corDaPasta, scheme, theme);
  const cores = paleta ? { ...theme, ...paleta } : theme;
  const titulo = noteTitle(nota.content) || 'Sem título';
  // A prévia pode ficar pela metade: o texto inteiro está a um toque (§7). Corta em palavra.
  const previa = notePreview(nota.content, 70);
  const { done, total } = todoProgress(nota.content);
  const quando = relativeBR(nota.updated_at);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[titulo, total > 0 ? `${done} de ${total} itens feitos` : null, `atualizada ${quando}`, nota.pinned ? 'fixada' : null]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onOpen(nota.id)}
      style={{ width: largura }}>
      <View style={[styles.cartao, { backgroundColor: cores.surface, borderColor: cores.cardBorder }]}>
        <PaletaTingida cores={paleta}>
          <View style={styles.cabeca}>
            <ThemedText type="headline" style={styles.cresce}>
              {titulo}
            </ThemedText>
            {nota.pinned ? <Icon name="pin.fill" size="xs" color="tint" /> : null}
          </View>
          {previa ? (
            <ThemedText type="small" themeColor="textSecondary">
              {previa}
            </ThemedText>
          ) : null}
          <View style={styles.meta}>
            {total > 0 ? (
              <View style={styles.pedaco}>
                <Icon name="checkmark.circle" size="xs" color="textSecondary" />
                <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
                  {`${done}/${total}`}
                </ThemedText>
              </View>
            ) : null}
            <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
              {quando}
            </ThemedText>
          </View>
        </PaletaTingida>
      </View>
    </PressableScale>
  );
}

/**
 * As notas na Hoje (28/09/2026): as FIXADAS — ou, sem nenhuma fixada, as mexidas por último —
 * numa faixa que rola para o lado, com a cor da nota (ou da pasta) pintando o cartão inteiro,
 * como na aba Notas.
 *
 * Notas são metade do produto e não apareciam na tela inicial. Só conteúdo real: não há cartão
 * "Nova nota" — o "Lançar" já cria nota, e um atalho repetindo o botão ao lado é o eco que tirou
 * o "Diga ao agente" da Hoje em 17/09.
 */
export function NotasDaHoje({
  notas,
  corDaPasta,
  onOpen,
}: {
  notas: readonly Note[];
  corDaPasta: (folderId: string | null) => NoteColorName | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.faixa}>
      {notas.map((n) => (
        <CartaoDeNota key={n.id} nota={n} corDaPasta={corDaPasta(n.folder_id)} onOpen={onOpen} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  faixa: { gap: Space.md },
  cartao: {
    flex: 1,
    minHeight: 120,
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    // Contorno de 1px, a assinatura do card (§2) — na nota ele é o tom forte da cor dela.
    borderWidth: 1,
  },
  cabeca: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs },
  cresce: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Space.md, marginTop: 'auto', paddingTop: Space.xs },
  pedaco: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
});
