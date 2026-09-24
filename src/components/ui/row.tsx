import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type AccessibilityState } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { BlockHeader } from '@/components/ui/block-header';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

type RowBadgeTone = 'warning' | 'danger' | 'success' | 'textSecondary';

interface RowProps {
  title: string;
  subtitle?: string;
  icon?: SymbolViewProps['name'];
  /** Valor, badge ou qualquer coisa à direita. Chevron é automático quando há `onPress`. */
  trailing?: ReactNode;
  /**
   * O ESTADO da linha, em pílula — "previsto", "atrasado", "pago".
   *
   * ⚠️ **Estado emendado no `subtitle` não se lê.** O subtítulo é uma frase cinza única
   * (`previsto · vence 08/10/2026 · assinaturas · Nubank · Cartão · recorrente`) onde a palavra
   * que diz se aquilo ACONTECEU tem exatamente o mesmo peso do nome do cartão. Quem abre o app
   * pela primeira vez não tem como saber qual das seis palavras importa.
   *
   * A pílula é o mesmo desenho que a Hoje já usava para "venceu 10/07" — só que lá estava
   * escrita à mão dentro da tela, então nenhuma outra lista podia usá-la.
   */
  badge?: { label: string; tone?: RowBadgeTone };
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
  /**
   * Linha de EXTRATO: o valor sobe para a linha do título e a legenda ocupa a largura inteira
   * embaixo, como no extrato do banco. Com o valor numa coluna à direita, a 384dp × fonte 1,3 a
   * legenda longa de um lançamento ("previsto · na fatura de 10/10 · casa · Nubank Cartão") se
   * espremia em cinco linhas ao lado dele. Título longo continua quebrando entre palavras, e o
   * valor desce para baixo dele quando não cabe.
   */
  inlineValue?: boolean;
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
  badge,
  onPress,
  onLongPress,
  destructive = false,
  chevron,
  accessibilityState,
  accessibilityLabel,
  indent = 0,
  inlineValue = false,
}: RowProps) {
  const theme = useTheme();
  const valor =
    trailing || (chevron ?? !!onPress) ? (
      <View style={styles.trailing}>
        {trailing}
        {(chevron ?? !!onPress) ? (
          <Icon name="chevron.right" size="sm" color="textSecondary" />
        ) : null}
      </View>
    ) : null;

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
        {inlineValue ? (
          <View style={styles.tituloComValor}>
            <ThemedText type="default" themeColor={destructive ? 'danger' : 'text'} style={styles.tituloDoExtrato}>
              {title}
            </ThemedText>
            {valor}
          </View>
        ) : (
          <ThemedText type="default" themeColor={destructive ? 'danger' : 'text'}>
            {title}
          </ThemedText>
        )}
        {badge || subtitle ? (
          /*
            `flexWrap` e não `numberOfLines`: a pílula fica ao lado do subtítulo quando cabe e
            sobe para a própria linha quando não — identificador não trunca (§7).
          */
          <View style={styles.meta}>
            {badge ? (
              <View style={[styles.badge, { backgroundColor: fundoDoBadge(theme, badge.tone) }]}>
                <ThemedText type="caption" themeColor={badge.tone ?? 'textSecondary'}>
                  {badge.label}
                </ThemedText>
              </View>
            ) : null}
            {subtitle ? (
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.subtitle}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </View>
      {/*
        Valor e chevron andam JUNTOS: com `flexWrap` na linha eles poderiam cair em linhas
        diferentes, e um chevron sozinho numa terceira linha não é ponteiro de nada.
      */}
      {inlineValue ? null : valor}
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
 * O fundo da pílula de estado.
 *
 * ⚠️ Não dá para derivar de `${tone}Soft`: o neutro não tem par — existem `dangerSoft`,
 * `successSoft` e `warningSoft`, mas `textSecondarySoft` nunca existiu, e a chave montada por
 * template devolveria `undefined` (pílula transparente) sem erro nenhum.
 */
function fundoDoBadge(theme: ReturnType<typeof useTheme>, tone: RowBadgeTone | undefined) {
  if (tone === 'danger') return theme.dangerSoft;
  if (tone === 'success') return theme.successSoft;
  if (tone === 'warning') return theme.warningSoft;
  return theme.backgroundElement;
}

/**
 * Agrupa `Row`s com hairline entre elas — o container de lista agrupada do iOS.
 * O separador começa depois do ícone, como no sistema.
 */
export function Section({
  title,
  heading = 'small',
  children,
}: {
  title?: string;
  /** `block`: o cabeçalho das raízes (`BlockHeader`). `small`: o título das telas empurradas. */
  heading?: 'small' | 'block';
  children: ReactNode;
}) {
  const theme = useTheme();
  const items = Children.toArray(children);

  return (
    <View style={styles.section}>
      {title ? (
        heading === 'block' ? (
          <BlockHeader title={title} />
        ) : (
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            {title}
          </ThemedText>
        )
      ) : null}
      {/* Mesma superfície do `Card`: chapada, com o fio de 1px fazendo a borda do grupo. */}
      <View
        style={[
          styles.group,
          { backgroundColor: theme.surface, borderColor: theme.cardBorder },
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
    "Ferramenta / s". Palavra partida ao meio é pior que reticências, que é o problema que a
    remoção das truncagens veio resolver.

    O gatilho é o `minWidth` de `labels`. **Ele valia 180 e foi MEDIDO em 384dp em 09/09/2026**,
    porque 180 era o número do emulador de 448dp e nenhum celular real tem essa largura: a
    conta é `384 − 32 (calha) − 32 (padding) − 38 (chip) − 12 − 12 = 270` para título + valor,
    e um `−R$ 1.280,00` com a seta deixa **131** para o título. Com 180 a linha quebrava
    SEMPRE — todo extrato ficava com o valor pendurado sozinho numa terceira linha, em toda
    linha da lista. Era a queixa do dono do produto, e as duas tentativas de arrumar isso pelo
    `trailing` das telas só trocaram a FORMA da quebra, porque a causa estava aqui.

    134 é a largura medida de "Estacionamentoo" (15 letras a 17px ≈ 8,9dp por letra), o maior
    título de uma palavra que este app produz. Abaixo disso a palavra parte; acima, o extrato
    inteiro quebra à toa. Não é escolha de gosto — é o ponto onde os dois defeitos se tocam, e
    trocar o número exige repetir a medição (plantar um título de 15 letras e olhar a 384dp).

    Não precisa de `fontScale`: com fonte grande o VALOR cresce e o espaço do título encolhe
    sozinho, então a válvula dispara na hora certa. Medido a 1,3× — a linha quebra, a palavra
    fica inteira.
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
    minWidth: 134,
    gap: 2,
  },
  // A pílula fica ao lado do subtítulo quando cabe e sobe para a própria linha quando não.
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Space.xs, rowGap: 2 },
  subtitle: { flexShrink: 1 },
  badge: {
    paddingHorizontal: Space.xs + 2,
    paddingVertical: 1,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  /**
   * `marginLeft: auto` mantém o valor encostado à direita mesmo quando ele desce de linha.
   *
   * O respiro entre valor e seta é `xs`, não `md`: a seta pertence ao valor (o iOS usa ~6pt),
   * e os 8dp que isso devolve são o que faz um título de 15 letras caber ao lado de um valor
   * de quatro dígitos em 384dp. Quem separa o par do texto é o `gap` da própria linha.
   */
  // Linha de extrato: título e valor lado a lado; o valor desce quando o título não deixa espaço.
  tituloComValor: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: Space.md,
  },
  // `flexBasis: 0` + `flexGrow`: o título ocupa a sobra e empurra o valor para a borda. O piso é
  // o MESMO do título da `Row` (134, medido para "Estacionamentoo"): com 96, "Financiamento"
  // partia ao meio a 384dp × 1,3. Abaixo dele o valor desce para baixo do título.
  tituloDoExtrato: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 134 },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginLeft: 'auto',
  },
  /** O chip do ícone é um círculo suave, como nas listas dos vídeos de referência. */
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Título → grupo a `Space.md`, a mesma medida entre cards irmãos (era 6; `anti-slop.test.ts`). */
  section: {
    gap: Space.md,
  },
  /** O título do grupo: tinta, 14/600, caixa normal — o mesmo do `SectionHead`. */
  sectionTitle: {
    paddingHorizontal: Space.lg,
    letterSpacing: Type.headline.letterSpacing,
  },
  group: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg,
  },
});
