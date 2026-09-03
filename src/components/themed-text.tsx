import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'subtitle'
    | 'headline'
    | 'small'
    | 'smallBold'
    | 'footnote'
    | 'caption'
    | 'link'
    | 'linkPrimary'
    | 'code'
    | 'ticker'
    | 'meta';
  themeColor?: ThemeColor;
};

/**
 * Texto do app. **Uma escala só.**
 *
 * Antes este arquivo trazia a própria escala (14/16/32/48, tudo em peso 500) — paralela e
 * incompatível com a `Type` de `src/design/tokens.ts`, que é a régua da plataforma e a que os
 * documentos descrevem. O efeito era o "platô": título 16/500 e subtítulo 14/500 ficavam a um
 * passo de distância, nada dominava a tela e tudo lia como o mesmo cinza. É a causa mecânica do
 * "telas muito simples".
 *
 * Agora todo tipo aponta para `Type`. Hierarquia se faz com **peso e cor**, não com 2px de
 * diferença: corpo em 400, número e ação em 600, secundário em `footnote` + `textSecondary`.
 */
export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? (type === 'linkPrimary' ? 'tint' : 'text')] },
        styles[type],
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  /** corpo — título de linha, parágrafo */
  default: Type.body,
  /** display de tela; uma por tela */
  title: Type.largeTitle,
  /** cabeçalho de bloco dentro da tela */
  subtitle: Type.title2,
  /** o que precisa ganhar da vizinhança: dinheiro na linha, rótulo de destaque */
  headline: Type.headline,
  /** secundário legível — o cavalo de batalha (235 usos) */
  small: Type.subhead,
  /** ação: rótulo de botão */
  smallBold: { ...Type.subhead, fontFamily: Fonts.semibold },
  /** metadado — o segundo degrau de verdade, não "quase igual ao corpo" */
  footnote: Type.footnote,
  /** rótulo de seção, contador, unidade */
  caption: Type.caption,
  /**
   * Link é **sublinhado**, não colorido.
   *
   * Com o `tint` monocromático (a cor da marca é preto e branco), link pintado de accent fica
   * exatamente da cor do texto ao redor — ou seja, deixa de existir. A distinção passa a ser
   * sublinhado + peso, que é o que sistemas sem cor de marca usam.
   */
  link: { ...Type.subhead, textDecorationLine: 'underline' },
  /** cor vem de `tint` no componente — nunca hex */
  linkPrimary: { ...Type.subhead, fontFamily: Fonts.semibold, textDecorationLine: 'underline' },
  /** mono: hora, contador, unidade — o segundo tipo do sistema */
  code: Type.code,
  /** mono um degrau acima: dinheiro dentro de card e linha */
  ticker: Type.ticker,
  /** rótulo de seção em caixa alta */
  meta: Type.meta,
});
