import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { noteFace, noteStrike } from '@/design/note-colors';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { noteBlocks, type NoteBlock } from '@/lib/note-blocks';
import { parseInline } from '@/lib/note-inline';

/**
 * O corpo da nota em modo LEITURA — os oito blocos de `note-blocks.ts` e, dentro de cada um, as
 * quatro marcas inline de `note-inline.ts`.
 *
 * Toda a marcação (`#`, `- [ ]`, `>`, `*`, `_`) some da tela; ela continua existindo só no texto,
 * que é o que volta inteiro para o WhatsApp — e é lá que `*negrito*` também é negrito.
 *
 * Um `Pressable` só por fora, com altura mínima: nota curta deixava 70% da tela em branco sem
 * affordance nenhuma. O vazio É a área de edição, como no Apple Notes. A exceção é a caixinha do
 * item marcável, que ganha o gesto para si e NÃO entra em edição.
 */
export function NoteBody({
  content,
  onEdit,
  onToggleLine,
}: {
  content: string;
  onEdit: () => void;
  onToggleLine: (index: number) => void;
}) {
  const blocos = noteBlocks(content);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        blocos.length === 0 ? 'Escrever na nota' : 'Conteúdo da nota. Toque para editar.'
      }
      onPress={onEdit}
      style={styles.corpo}>
      {blocos.length === 0 ? (
        <ThemedText type="subtitle" themeColor="textSecondary">
          Escreve alguma coisa…
        </ThemedText>
      ) : (
        blocos.map((b) => <Bloco key={b.index} bloco={b} onToggle={onToggleLine} />)
      )}
    </Pressable>
  );
}

function Bloco({ bloco: b, onToggle }: { bloco: NoteBlock; onToggle: (i: number) => void }) {
  const theme = useTheme();

  if (b.kind === 'divider') {
    return <View style={[styles.divisoria, { backgroundColor: theme.separator }]} />;
  }

  if (b.kind === 'todo') {
    return (
      <View style={styles.linhaItem}>
        {/* Caixinha pequena, alvo de toque ≥ 44 pelo hitSlop. */}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: !!b.done }}
          accessibilityLabel={b.text}
          hitSlop={12}
          onPress={() => onToggle(b.index)}>
          <Animated.View key={b.done ? 'on' : 'off'} entering={FadeIn.duration(Motion.duration.fast)}>
            <Icon
              name={b.done ? 'checkmark.circle.fill' : 'circle'}
              size="lg"
              color={b.done ? 'tint' : 'textSecondary'}
            />
          </Animated.View>
        </Pressable>
        <Inline
          text={b.text}
          style={[
            styles.cresce,
            { color: b.done ? theme.textSecondary : theme.text },
            b.done ? styles.feito : null,
          ]}
        />
      </View>
    );
  }

  if (b.kind === 'bullet' || b.kind === 'numbered') {
    return (
      <View style={styles.linhaLista}>
        {/* Marcador em mono para os números ficarem na mesma coluna. */}
        <ThemedText type="code" themeColor="textSecondary" style={styles.marcador}>
          {b.kind === 'numbered' ? `${b.order ?? 1}.` : '•'}
        </ThemedText>
        <Inline text={b.text} style={styles.cresce} />
      </View>
    );
  }

  if (b.kind === 'quote') {
    return (
      <View style={styles.linhaCitacao}>
        <View style={[styles.barraCitacao, { backgroundColor: theme.tintFill }]} />
        <Inline text={b.text} color={theme.textSecondary} style={styles.cresce} />
      </View>
    );
  }

  const cabecalho = b.kind === 'title' || b.kind === 'h1';
  return (
    <Inline
      text={b.text}
      variante={cabecalho ? 'title2' : b.kind === 'h2' ? 'headline' : 'body'}
      style={cabecalho ? styles.titulo : undefined}
    />
  );
}

/**
 * Uma linha com as marcas inline aplicadas.
 *
 * ⚠️ **Peso é FAMÍLIA, e o peso do BLOCO entra na conta.** `noteFace` recebe 600 num cabeçalho e
 * 400 num parágrafo: `*negrito*` dentro de um título que já é semibold precisa subir para 700,
 * senão ele não faz nada visível. `fontWeight` nem aparece aqui — no Android a fonte custom o
 * ignora e cai no regular com negrito sintético.
 *
 * Um `<ThemedText>` por fora com os `<Text>` dos trechos DENTRO dele: assim a linha inteira
 * quebra, alinha e escala como um parágrafo só, em vez de virar N caixas lado a lado que quebram
 * cada uma por conta.
 *
 * ⚠️ **Os trechos são `Text` CRU de propósito.** `ThemedText` chama `useTheme()` e aplica
 * `flexShrink`/`android_hyphenationFrequency` — que em `<Text>` aninhado são no-op —, e numa
 * lista de 30 cartões com ~3 trechos por linha isso vira ~100 chamadas de hook por render para
 * não mudar um pixel. Cor, tamanho e tracking o filho HERDA do pai; o trecho só acrescenta o que
 * a marca muda.
 */
function Inline({
  text,
  variante = 'body',
  color,
  style,
}: {
  text: string;
  variante?: 'body' | 'headline' | 'title2';
  color?: string;
  style?: React.ComponentProps<typeof ThemedText>['style'];
}) {
  const base = variante === 'body' ? (400 as const) : (600 as const);
  const tipo = variante === 'body' ? 'default' : variante === 'headline' ? 'headline' : 'subtitle';
  const spans = parseInline(text);

  return (
    <ThemedText type={tipo} style={[color ? { color } : null, style]}>
      {spans.map((span, i) => (
        <Text
          key={i}
          style={[
            // `Type.code` traz tamanho e entrelinha do mono; a família vem de `noteFace`, que
            // devolve a MESMA para `code` — as duas concordam, e a ordem só garante isso.
            span.marks.includes('code') ? Type.code : null,
            { fontFamily: noteFace(span.marks, base) },
            { textDecorationLine: noteStrike(span.marks) ?? 'none' },
          ]}>
          {span.text}
        </Text>
      ))}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  /**
   * `minHeight` casa com o do `TextInput` da edição: sem ele o corpo "encolhe" no instante em
   * que a nota sai de edição para leitura, e o dedo persegue o texto que se moveu.
   */
  corpo: { gap: Space.sm, minHeight: 280, flexGrow: 1 },
  /** Título respira mais que a distância entre linhas do corpo — é o que o separa do texto. */
  titulo: { marginBottom: Space.xs },
  linhaItem: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  linhaLista: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  /** Largura fixa: sem ela "1." e "10." desalinham o texto da lista. */
  marcador: { width: 22, textAlign: 'right', lineHeight: Type.body.lineHeight },
  linhaCitacao: { flexDirection: 'row', alignItems: 'stretch', gap: Space.md },
  barraCitacao: { width: 3, borderRadius: Radius.xs },
  divisoria: { height: StyleSheet.hairlineWidth, marginVertical: Space.sm },
  cresce: { flex: 1 },
  feito: { textDecorationLine: 'line-through' },
});
