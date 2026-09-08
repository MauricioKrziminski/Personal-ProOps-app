import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityState } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useTheme, useScheme } from '@/hooks/use-theme';

interface RowProps {
  title: string;
  subtitle?: string;
  icon?: SymbolViewProps['name'];
  /** Valor, badge ou qualquer coisa à direita. Chevron é automático quando há `onPress`. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Menu de contexto do item (action sheet nativo). */
  onLongPress?: () => void;
  destructive?: boolean;
  /**
   * Chevron só quando a linha NAVEGA. Linha que restaura, seleciona ou abre menu passa `false` —
   * chevron ali é promessa de tela nova que não existe.
   */
  chevron?: boolean;
  /** `selected` / `checked` — o check do picker não pode ser só cor. */
  accessibilityState?: AccessibilityState;
  /** Rótulo de acessibilidade completo. Sem ele, cai em `title` + `subtitle`. */
  accessibilityLabel?: string;
  /**
   * Nível de aninhamento (0 = raiz). Recua a linha inteira, em degraus de `Space.lg`.
   *
   * Mora AQUI e não num `<View>` em volta porque o realce de press precisa continuar cobrindo a
   * largura toda: recuando por fora, a faixa clara pararia antes da margem e a linha filha
   * pareceria um card dentro da lista.
   */
  indent?: number;
}

/**
 * Linha de lista no padrão iOS.
 *
 * Feedback de press é **highlight de fundo**, nunca `scale` — escalar linha de lista é o tell
 * mais comum de UI que não é nativa (regra de design §5).
 */
export function Row({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
  onLongPress,
  destructive = false,
  chevron,
  accessibilityState,
  accessibilityLabel,
  indent = 0,
}: RowProps) {
  const theme = useTheme();

  const content = (pressed: boolean) => (
    <View
      style={[
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
        indent > 0 && { paddingLeft: Space.lg + indent * Space.lg },
      ]}>
      {/*
        O ícone mora num CHIP redondo, como no desenho: um glifo solto ao lado do texto flutua e
        as linhas perdem a coluna da esquerda. O chip dá a âncora e o alvo visual.
      */}
      {icon ? (
        <View
          style={[
            styles.iconChip,
            { backgroundColor: destructive ? theme.dangerSoft : theme.backgroundElement },
          ]}>
          <Icon name={icon} size="md" color={destructive ? 'danger' : 'text'} />
        </View>
      ) : null}
      {/*
        ⚠️ **Nada aqui trunca.** Título e subtítulo tinham `` e a linha virava
        "Avisos financeiros no c…" / "Trocar número do WhatsA…" num aparelho com fonte grande —
        reticências onde estava a informação. A regra passou a ser: o texto QUEBRA e a linha
        cresce (`minHeight`, não `height`, e sem `overflow: 'hidden'` no grupo do texto).
        Ver `design.md` §7.
      */}
      <View style={styles.labels}>
        <ThemedText type="default" themeColor={destructive ? 'danger' : 'text'}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {/*
        Valor e chevron andam JUNTOS: com `flexWrap` na linha eles poderiam cair em linhas
        diferentes, e um chevron sozinho numa terceira linha não é ponteiro de nada.
      */}
      {trailing || (chevron ?? !!onPress) ? (
        <View style={styles.trailing}>
          {trailing}
          {(chevron ?? !!onPress) ? (
            <Icon name="chevron.right" size="sm" color="textSecondary" />
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (!onPress && !onLongPress) return content(false);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

/**
 * Agrupa `Row`s com hairline entre elas — o container de lista agrupada do iOS.
 * O separador começa depois do ícone, como no sistema.
 */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const theme = useTheme();
  const scheme = useScheme();
  const items = Children.toArray(children);

  return (
    <View style={styles.section}>
      {title ? (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </ThemedText>
      ) : null}
      {/* Mesma elevação do `Card`. Branco sobre `groupedBackground` são 3% de diferença de
          valor: sem a sombra o agrupamento praticamente não existe no tema claro. */}
      <View
        style={[
          styles.group,
          { backgroundColor: theme.surface, boxShadow: Elevation[scheme].raised },
        ]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.separator, { backgroundColor: theme.separator }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    ⚠️ `flexWrap`: o valor à direita desce para a linha de baixo quando o título não caberia.

    Sem isso, com fonte grande o bloco do valor ("−R$ 1.280,00" + a data) comia metade da linha e
    o título ficava com uma coluna estreita demais — o Android então quebrava DENTRO da palavra:
    "Ferramenta / s", "Passagem / aérea". Palavra partida ao meio é pior que reticências, que é o
    problema que a remoção das truncagens veio resolver.

    O gatilho é o `minWidth` de `labels`: enquanto o título tem 180 de largura, tudo fica na mesma
    linha; abaixo disso o valor quebra e cada um fica inteiro na sua.
  */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  labels: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 180,
    gap: 2,
  },
  /** `marginLeft: auto` mantém o valor encostado à direita mesmo quando ele desce de linha. */
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    marginLeft: 'auto',
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Space.xs + 2,
  },
  /**
   * O rótulo de seção é `Type.meta`, não um `caption` com tracking à mão.
   *
   * `meta` existe no sistema exatamente para isto (etiqueta, metadado, unidade) — 12/600 com
   * `letterSpacing: 0.8` — e estava sendo usado em UM lugar, o rótulo do painel. Aqui, no
   * `SectionHead` e na Notas, três cópias reimplementavam a mesma ideia em peso 400 e tracking
   * 0.6: a etiqueta lia como texto pequeno em vez de ler como etiqueta, e o app perdia o degrau
   * tipográfico que substitui a cor num sistema sem accent colorido.
   */
  sectionTitle: {
    paddingHorizontal: Space.lg,
    ...Type.meta,
  },
  group: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg,
  },
});
