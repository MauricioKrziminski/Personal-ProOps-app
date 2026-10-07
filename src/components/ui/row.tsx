import { Children, Fragment, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type AccessibilityState } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { BlockHeader } from '@/components/ui/block-header';
import { Icon } from '@/components/ui/icon';
import { DinheiroEncolhe } from '@/components/ui/money';
import type { NoteColorName } from '@/constants/theme';
import { noteInk } from '@/design/note-colors';
import { superficieDaNota } from '@/design/note-surface';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';

type RowBadgeTone = 'warning' | 'danger' | 'success' | 'textSecondary';

interface RowProps {
  title: string;
  /** Texto, ou texto com o nome citado em `<Forte>`. Nó não entra no rótulo de acessibilidade. */
  subtitle?: ReactNode;
  icon?: SymbolViewProps['name'];
  /**
   * A cor da CATEGORIA (`useAparencia`): o disco do ícone ganha o fundo tingido e o glifo a tinta
   * cheia, a mesma régua das notas coloridas (`design.md` §2b). Sem ela, o disco neutro. Linha
   * `destructive` ignora — estado vence decoração.
   */
  tinta?: NoteColorName | null;
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
  /**
   * A linha que a pessoa tocou em OUTRA tela (a compra da Hoje que abre a fatura): o fundo de
   * "pressionada" acende e some devagar quando volta a `false`. Quem controla o tempo é a tela.
   */
  destacado?: boolean;
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
  tinta,
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
  destacado = false,
}: RowProps) {
  const theme = useTheme();
  // O brilho só monta na linha que já foi destacada: as outras não pagam animação nenhuma.
  const [brilhou, setBrilhou] = useState(destacado);
  if (destacado && !brilhou) setBrilhou(true);
  const scheme = useScheme();
  const tintaCheia = tinta && !destructive ? noteInk(tinta, scheme) : null;
  const disco = tintaCheia
    ? superficieDaNota(tintaCheia, scheme, { surface: theme.backgroundElement, text: theme.text }).fundo
    : null;
  const { width } = useWindowDimensions();
  const [larguraDaLinha, setLarguraDaLinha] = useState(0);
  const larguraUtil = Math.max(0, (larguraDaLinha || width) - Space.lg * (2 + Math.max(0, indent)));
  const pisoDoTitulo = usePisoDoTitulo(larguraUtil);
  // Se duas colunas com o piso tipográfico não cabem, o extrato dá a linha inteira ao valor.
  // Largura explícita impede o ajuste de fonte durante uma medida estreita ao lado do título.
  const valorEmLinhaInteira = inlineValue && pisoDoTitulo.minWidth * 2 > larguraUtil - (icon ? styles.iconChip.width + Space.md : 0);
  // No iPhone o texto que encolheu (`adjustsFontSizeToFit`) numa medida estreita NUNCA volta a
  // crescer — nem com a linha mais larga, nem desligando o ajuste: o "−R$ 1.202,67" do
  // Fundacred ficou ilegível numa busca (05/10/2026). Por isso: nada encolhe antes de a linha ser
  // MEDIDA, e o valor remonta quando o modo ou a largura mudam, zerando a escala nativa.
  // Só a linha de extrato com o valor em linha inteira encolhe (largura explícita). Na coluna ao
  // lado do título o valor NÃO encolhe: a coluna é medida estreita num primeiro passe e o iPhone
  // deixava "R$ 550,00" minúsculo para sempre no Detalhe do ciclo (06/10/2026).
  const encolhe = larguraDaLinha > 0 && valorEmLinhaInteira;
  const valor =
    trailing || (chevron ?? !!onPress) ? (
      <View style={[styles.trailing, valorEmLinhaInteira && { width: larguraUtil }]}>
        {trailing ? <View key={encolhe ? `e${Math.round(larguraUtil)}` : 'n'} style={encolhe ? styles.valor : styles.valorRigido}>
          {/* Ajuste na coluna fixa, ou sobre a linha inteira reservada ao valor. O extrato
              normal quebra sem ajustar na medida transitória ao lado do título. */}
          <DinheiroEncolhe.Provider value={encolhe}>{trailing}</DinheiroEncolhe.Provider>
        </View> : null}
        {(chevron ?? !!onPress) ? (
          <Icon name="chevron.right" size="sm" color="textSecondary" />
        ) : null}
      </View>
    ) : null;

  const content = (pressed: boolean) => (
    <View
      onLayout={({ nativeEvent }) => setLarguraDaLinha(nativeEvent.layout.width)}
      style={[
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
        indent > 0 && { paddingLeft: Space.lg + indent * Space.lg },
      ]}>
      {brilhou ? <Brilho aceso={destacado} cor={theme.backgroundSelected} /> : null}
      {/*
        O ícone mora num CHIP redondo, como no desenho: um glifo solto ao lado do texto flutua e
        as linhas perdem a coluna da esquerda. O chip dá a âncora e o alvo visual.
      */}
      {icon ? (
        <View
          style={[
            styles.iconChip,
            { backgroundColor: destructive ? theme.dangerSoft : (disco ?? theme.backgroundElement) },
          ]}>
          <Icon name={icon} size="md" color={destructive ? 'danger' : 'text'} tint={tintaCheia ?? undefined} />
        </View>
      ) : null}
      {/*
        ⚠️ **Nada aqui trunca.** Título e subtítulo tinham `` e a linha virava
        "Avisos financeiros no c…" / "Trocar número do WhatsA…" num aparelho com fonte grande —
        reticências onde estava a informação. A regra passou a ser: o texto QUEBRA e a linha
        cresce (`minHeight`, não `height`, e sem `overflow: 'hidden'` no grupo do texto).
        Ver `design.md` §7.
      */}
      <View style={[styles.labels, pisoDoTitulo]}>
        {inlineValue ? (
          <View style={styles.tituloComValor}>
            <ThemedText type="default" themeColor={destructive ? 'danger' : 'text'} style={[styles.tituloDoExtrato, pisoDoTitulo]}>
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
      accessibilityLabel={accessibilityLabel ?? [title, typeof subtitle === 'string' ? subtitle : null].filter(Boolean).join(', ')}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}

/** Fundo de "pressionada" que some devagar quando `aceso` vira `false` (de uma vez, sem movimento). */
function Brilho({ aceso, cor }: { aceso: boolean; cor: string }) {
  const reduzido = useReducedMotion();
  const opacidade = useSharedValue(aceso ? 1 : 0);
  useEffect(() => {
    opacidade.value = aceso ? 1 : reduzido ? 0 : withTiming(0, { duration: 700 });
  }, [aceso, reduzido, opacidade]);
  const estilo = useAnimatedStyle(() => ({ opacity: opacidade.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: cor }, estilo]} />;
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
  trailing,
  children,
}: {
  title?: string;
  /** Ao lado do título (o (i) `Explica`); só existe com título. */
  trailing?: ReactNode;
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
          <BlockHeader title={title} trailing={trailing} />
        ) : trailing ? (
          <View style={styles.tituloComAcao}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              {title}
            </ThemedText>
            {trailing}
          </View>
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

/** O piso do título antes de o valor descer de linha — ver `row` abaixo. */
const MIN_TITULO = 134;

/**
 * O piso do título de toda linha de duas colunas (`Row`, a linha de extrato e o "Seu dia"), no
 * tamanho de fonte em que ela está sendo desenhada. Uma função, três lugares: um número copiado
 * em cada um divergia (era o `anti-slop.test.ts` que os mantinha iguais à mão).
 */
export function usePisoDoTitulo(larguraDisponivel = Infinity) {
  const { fontScale } = useWindowDimensions();
  // Na fonte máxima o piso escalado pode exceder até a linha inteira. O painel real é o teto.
  return { minWidth: Math.min(MIN_TITULO * Math.max(1, fontScale), larguraDisponivel) };
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

    **E o piso cresce com a fonte** (28/09/2026). A 1,3× bastava o valor crescer e o título
    encolher; no tamanho de acessibilidade do iPhone uma palavra só passa dos 134 e partia no meio
    ("Orçament / o", no histórico de alertas) com o valor ainda ao lado. `134 × fontScale` é a
    mesma palavra de 15 letras medida no tamanho em que ela está sendo desenhada.
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
  tituloDoExtrato: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginLeft: 'auto',
    maxWidth: '100%',
    justifyContent: 'flex-end',
  },
  valor: { flexShrink: 1, minWidth: 0 },
  valorRigido: { flexShrink: 0 },
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
  tituloComAcao: { flexDirection: 'row', alignItems: 'center', paddingRight: Space.sm },
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
