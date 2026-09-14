import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { classify, lineAt, type BlockKind } from '@/lib/note-blocks';
import { marksAt, type Mark } from '@/lib/note-inline';

/**
 * A barra de formatação — o "digite / para inserir" do Notion, em forma de barra.
 *
 * Dois grupos, e a divisão é conceitual: à esquerda o que vale para o TRECHO selecionado
 * (negrito, itálico, riscado, mono), à direita o que vale para a LINHA inteira (título,
 * subtítulo, item marcável, lista, numerada, citação, divisória).
 *
 * ## Ela mostra ESTADO, e isso não é enfeite
 *
 * A versão anterior era um teclado de botões cegos: não dava para saber se a linha já era uma
 * citação nem se o cursor estava dentro de um negrito. Sem estado, "aplicar" e "desfazer" são o
 * mesmo toque com resultados diferentes, e a pessoa descobre qual foi depois de acontecer.
 * `classify` responde pela linha e `marksAt` pelo trecho.
 *
 * ## Por que rola na horizontal
 *
 * São onze controles. A 384dp com fonte 1,3× eles não cabem numa fileira sem cada alvo ficar
 * menor que 44pt, que é o piso de toque. Rolar é o que Apple Notes e Bear fazem com a mesma
 * barra, e o grupo inline — o mais usado — começa visível.
 */

const INLINE: { mark: Mark; icon: React.ComponentProps<typeof Icon>['name']; label: string }[] = [
  { mark: 'bold', icon: 'bold', label: 'Negrito' },
  { mark: 'italic', icon: 'italic', label: 'Itálico' },
  { mark: 'strike', icon: 'strikethrough', label: 'Riscado' },
  { mark: 'code', icon: 'chevron.left.forwardslash.chevron.right', label: 'Mono' },
];

const BLOCOS: { kind: BlockKind; icon: React.ComponentProps<typeof Icon>['name']; label: string }[] =
  [
    { kind: 'h1', icon: 'textformat.size', label: 'Título' },
    { kind: 'h2', icon: 'textformat', label: 'Subtítulo' },
    { kind: 'todo', icon: 'checkmark.circle', label: 'Item marcável' },
    { kind: 'bullet', icon: 'list.bullet', label: 'Lista' },
    { kind: 'numbered', icon: 'list.number', label: 'Lista numerada' },
    { kind: 'quote', icon: 'text.quote', label: 'Citação' },
    { kind: 'divider', icon: 'minus', label: 'Divisória' },
  ];

export function FormatBar({
  content,
  selection,
  onMark,
  onBlock,
}: {
  content: string;
  selection: { start: number; end: number };
  onMark: (mark: Mark) => void;
  onBlock: (kind: BlockKind) => void;
}) {
  const theme = useTheme();

  const linha = lineAt(content, selection.start);
  const tipoDaLinha =
    linha >= 0 ? classify(content.split('\n')[linha] ?? '').kind : ('text' as const);
  // ⚠️ Com um TRECHO selecionado, `start` costuma cair EM CIMA do delimitador de abertura
  // (selecionar "leite" em `*leite*` começa no índice do `*`), e ali `marksAt` devolve vazio —
  // a barra diria "não está em negrito" com a seleção visivelmente dentro do negrito, que é
  // exatamente o estado mentiroso que ela existe para acabar. O meio da seleção está sempre
  // dentro dela.
  const ondeLer =
    selection.end > selection.start
      ? Math.floor((selection.start + selection.end) / 2)
      : selection.start;
  const ativas = marksAt(content, ondeLer);

  return (
    <View style={[styles.barra, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.fileira}>
        {INLINE.map((b) => (
          <Botao
            key={b.mark}
            icon={b.icon}
            label={b.label}
            ativo={ativas.includes(b.mark)}
            onPress={() => onMark(b.mark)}
          />
        ))}

        <View style={[styles.filete, { backgroundColor: theme.separator }]} />

        {BLOCOS.map((b) => (
          <Botao
            key={b.kind}
            icon={b.icon}
            label={b.label}
            ativo={tipoDaLinha === b.kind}
            onPress={() => onBlock(b.kind)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Botao({
  icon,
  label,
  ativo,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  ativo: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: ativo }}
      hitSlop={4}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.botao,
        {
          backgroundColor: ativo
            ? theme.accentSoft
            : pressed
              ? theme.backgroundSelected
              : 'transparent',
        },
      ]}>
      {/* Estado por COR, não por glifo: `pin`/`pin.fill` já ensinaram que no Android duas
          variantes do mesmo símbolo colapsam no mesmo ícone do Material. */}
      <Icon name={icon} size="md" color={ativo ? 'tint' : 'text'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  barra: {
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fileira: { alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.xs },
  botao: {
    width: HitTarget - 4,
    height: HitTarget - 8,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filete: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: Space.sm,
    marginHorizontal: Space.xs,
  },
});
