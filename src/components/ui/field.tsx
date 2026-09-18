import { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Fonts } from '@/constants/theme';
import { HitTarget, Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { maskBRDate } from '@/lib/dates';

/** Duração da transição da borda ao focar. */
const FOCUS_BORDER_MS = 160;

/**
 * O foco do campo, compartilhado entre o `Field` (rótulo) e o input dentro dele.
 *
 * É um `SharedValue` e não estado React: a borda acompanha o foco na thread de UI, sem render.
 * Fora de um `Field` o input usa um valor próprio.
 */
const FocoDoCampo = createContext<SharedValue<number> | null>(null);

interface FieldProps {
  /** Label VISÍVEL. Placeholder não é label — some quando o usuário digita. */
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

/**
 * Envelope de campo: label visível, erro inline junto do campo (não no topo do form) e hint.
 *
 * O rótulo fica parado em cima da caixa, pequeno e em tinta, como nos vídeos de referência —
 * quem conta o foco é a borda da caixa. O foco é compartilhado por contexto com a caixa de dentro.
 *
 * ## Label e hint NÃO podem ter o mesmo estilo
 *
 * Os dois eram `type="small"` + `textSecondary`, byte por byte — em 47 campos. Nada separava "o
 * que é o campo" de "explicação sobre o campo". A distinção anda em DOIS eixos, porque um só não
 * sobrevive a 1,3×: **peso** (500 → 400) e **cor** (`text` → `textSecondary`).
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const foco = useSharedValue(0);

  return (
    <FocoDoCampo.Provider value={foco}>
      <View style={styles.field}>
        {/* O label é IDENTIFICADOR do campo, e por isso vai na cor cheia. */}
        <ThemedText type="footnote" style={styles.rotulo}>
          {label}
        </ThemedText>
        {children}
        {/*
          O erro NÃO apaga o hint. Eles se excluíam por um ternário, e a explicação sumia
          exatamente quando mais importa. Mesma geometria (footnote) nos dois, então a altura não
          pula na validação. Quando o erro É a dica ("Pelo menos 8 caracteres"), só o erro fica —
          a mesma frase duas vezes, uma vermelha e outra cinza, é ruído.
        */}
        {error ? (
          <ThemedText type="footnote" themeColor="danger">
            {error}
          </ThemedText>
        ) : null}
        {hint && hint !== error ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
    </FocoDoCampo.Provider>
  );
}

/** Chaves de estilo que moram na CAIXA do campo, não no texto. */
const DA_CAIXA = new Set([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'borderRadius',
]);

/**
 * Reparte o `style` de quem chama entre a caixa e o input.
 *
 * O input morava sozinho e recebia tudo; agora ele vive dentro de uma caixa (para o traço de
 * foco). Um `flex: 1` que ficasse no input deixaria de esticar o campo numa linha — era o caso
 * do compositor do Agente e da nota rápida. Layout vai para a caixa; texto e altura, para o input.
 */
function repartir(style: StyleProp<TextStyle>): { caixa: ViewStyle; input: TextStyle } {
  const plano = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const caixa: Record<string, unknown> = {};
  const input: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(plano)) (DA_CAIXA.has(k) ? caixa : input)[k] = v;
  return { caixa: caixa as ViewStyle, input: input as TextStyle };
}

/**
 * A caixa do campo: a própria borda muda de cor no foco, sem mudar de largura.
 * O contorno acompanha o raio de cada campo, inclusive o compositor arredondado
 * do Agente, sem desenhar um segundo arco por cima. Com erro, a borda fica
 * vermelha e a caixa treme uma vez.
 */
function useCaixa(invalid: boolean | undefined) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const doField = useContext(FocoDoCampo);
  const proprio = useSharedValue(0);
  const foco = doField ?? proprio;
  const tremor = useSharedValue(0);
  const antes = useRef(invalid);

  useEffect(() => {
    if (invalid && !antes.current && !reduzido) {
      tremor.set(
        withSequence(
          withTiming(-6, { duration: 50 }),
          withTiming(6, { duration: 70 }),
          withTiming(-4, { duration: 60 }),
          withTiming(0, { duration: 60 })
        )
      );
    }
    antes.current = invalid;
  }, [invalid, reduzido, tremor]);

  const estiloCaixa = useAnimatedStyle(() => ({
    borderColor: invalid
      ? theme.danger
      : interpolateColor(foco.get(), [0, 1], [theme.separator, theme.tint]),
    transform: [{ translateX: tremor.get() }],
  }));

  const focar = () =>
    foco.set(withTiming(1, { duration: reduzido ? 0 : FOCUS_BORDER_MS, easing: Motion.easing.out }));
  const desfocar = () =>
    foco.set(withTiming(0, { duration: reduzido ? 0 : Motion.duration.base, easing: Motion.easing.out }));

  const moldura = (conteudo: React.ReactNode, estilo?: StyleProp<ViewStyle>) => {
    const vidro = supportsLiquidGlass();
    const raio = StyleSheet.flatten(estilo)?.borderRadius;
    return (
      <Animated.View
        style={[
          styles.caixa,
          { backgroundColor: vidro ? 'transparent' : theme.surface },
          estilo,
          estiloCaixa,
        ]}>
        {vidro ? (
          <GlassBackdrop
            fallbackColor={theme.surface}
            radius={typeof raio === 'number' ? raio : Radius.sm}
          />
        ) : null}
        {conteudo}
      </Animated.View>
    );
  };

  return { focar, desfocar, moldura };
}

export const TextField = forwardRef<TextInput, TextInputProps & { invalid?: boolean }>(
  function TextField({ invalid, style, onFocus, onBlur, placeholder, ...rest }, ref) {
    const theme = useTheme();
    const { focar, desfocar, moldura } = useCaixa(invalid);
    const { caixa, input } = repartir(style);
    /*
      ⚠️ **No iOS o placeholder entra um quadro DEPOIS da montagem** (medido em 16/09/2026). Na tela
      de login montada depois de sair da conta, o rótulo interno do `UITextField` nascia com o
      layout de outro campo: o "voce@exemplo.com" ficava 16pt abaixo, cortado pela borda, e a
      metade de cima da caixa nem dava foco. Com partida a frio o mesmo campo nascia certo, e nem
      animação nem preenchimento automático mudavam nada (testados um a um). Aplicado no quadro
      seguinte, o placeholder é recalculado com a geometria de agora — e o campo volta a responder
      ao toque na caixa inteira.
    */
    const [marcador, setMarcador] = useState(Platform.OS === 'ios' ? undefined : placeholder);
    useEffect(() => {
      if (Platform.OS !== 'ios') return;
      const id = requestAnimationFrame(() => setMarcador(placeholder));
      return () => cancelAnimationFrame(id);
    }, [placeholder]);

    return moldura(
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        cursorColor={theme.tint}
        selectionColor={theme.tint}
        onFocus={(e) => {
          focar();
          onFocus?.(e);
        }}
        onBlur={(e) => {
          desfocar();
          onBlur?.(e);
        }}
        style={[styles.input, { color: theme.text }, input]}
        placeholder={Platform.OS === 'ios' ? marcador : placeholder}
        {...rest}
      />,
      caixa
    );
  }
);

interface DateFieldProps {
  /** Data em `dd/mm/aaaa`, como o usuário digita. */
  value: string;
  onChangeText: (br: string) => void;
  invalid?: boolean;
  accessibilityLabel?: string;
  placeholder?: string;
}

/**
 * Campo de data em `dd/mm/aaaa` — **com a máscara, que não é detalhe: sem ela o campo não
 * aceita ser digitado no iOS.**
 *
 * ⚠️ O teclado `number-pad` do iOS **não tem a tecla "/"**. Um campo de data que espera o
 * usuário digitar a barra só aceita texto colado — foi a queixa "não consigo mudar a data".
 * `maskBRDate` põe as barras a partir dos DÍGITOS (e por isso o backspace atravessa a barra
 * sozinho), e este componente existe para que nenhuma tela precise lembrar disso.
 *
 * ponytail: teto conhecido — ele pede que a pessoa SAIBA a data. Onde ver o dia da semana
 * importa, o caminho é o `Calendar` inline (`components/finance/calendar.tsx`).
 */
export function DateField({ value, onChangeText, invalid, accessibilityLabel, placeholder }: DateFieldProps) {
  return (
    <TextField
      value={value}
      onChangeText={(texto) => onChangeText(maskBRDate(texto))}
      placeholder={placeholder ?? 'dd/mm/aaaa'}
      keyboardType="number-pad"
      maxLength={10}
      accessibilityLabel={accessibilityLabel}
      invalid={invalid}
    />
  );
}

interface MoneyFieldProps {
  /** Valor em centavos. Nunca float. */
  valueCents: number;
  onChangeCents: (cents: number) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Só leitura: o valor existe mas não é deste formulário (parcela de um plano). */
  readOnly?: boolean;
}

/**
 * Para onde os dígitos rolam: +1 quando o valor cresce (o novo entra por baixo), −1 quando
 * diminui (entra por cima). Um valor de MÓDULO, gravado no handler da tecla antes do render:
 * só um campo de valor é digitado por vez, então compartilhar não mistura nada.
 */
const direcao = makeMutable(1);
const ROLA = 0.62;

/**
 * Uma casa do odômetro: o dígito que sai e o que entra, trocados por `transform`.
 *
 * ⚠️ **Não é animação de layout (`entering`/`exiting`), e isso foi MEDIDO** (16/09/2026). Com uma
 * chave por dígito e `exiting`, o Android nunca terminava a saída: os dígitos velhos ficavam por
 * cima dos novos para sempre ("0,45" com um "0,04" fantasma). Cada posição é uma casa fixa que
 * guarda o dígito anterior e o atual, e a troca é um valor de 0 a 1 — igual nas duas plataformas.
 */
function Digito({ ch, cor, animar }: { ch: string; cor: string; animar: boolean }) {
  const reduzido = useReducedMotion();
  const [atual, setAtual] = useState(ch);
  const [antigo, setAntigo] = useState<string | null>(animar ? '' : null);
  // Estado derivado da prop, ajustado no render (o padrão do React para "valor anterior").
  if (ch !== atual) {
    setAntigo(atual);
    setAtual(ch);
  }
  const t = useSharedValue(animar && !reduzido ? 0 : 1);
  useEffect(() => {
    if (antigo === null || reduzido) {
      t.set(1);
      return;
    }
    t.set(0);
    t.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [atual, antigo, reduzido, t]);

  const altura = Type.money.lineHeight;
  const entra = useAnimatedStyle(() => ({
    opacity: t.get(),
    transform: [{ translateY: (1 - t.get()) * direcao.value * altura * ROLA }],
  }));
  const sai = useAnimatedStyle(() => ({
    opacity: 1 - t.get(),
    transform: [{ translateY: -t.get() * direcao.value * altura * ROLA }],
  }));
  const estilo = [Type.money, tabular, styles.digito, { color: cor }];

  return (
    <View style={styles.casa}>
      {/*
        O dígito que entra fica NO FLUXO e dá a largura da casa; só o que sai flutua por cima.
        Com uma terceira camada invisível só para medir, o Android desenhava as duas deslocadas —
        "0,00" dobrado logo no primeiro quadro.
      */}
      <Animated.Text style={[estilo, entra]}>{atual}</Animated.Text>
      {antigo ? (
        <Animated.Text style={[estilo, styles.sobre, sai]}>{antigo}</Animated.Text>
      ) : null}
    </View>
  );
}

/**
 * Entrada de dinheiro: digita da direita para a esquerda, em centavos. **Caminho ÚNICO.**
 * Teto em R$ 999.999.999,99 para não estourar `bigint` por dedo pesado.
 *
 * ## O odômetro
 *
 * O número que se vê não é o texto do `TextInput`: é uma fileira de casas, uma por POSIÇÃO a
 * partir da direita (a vírgula e o ponto caem sempre na mesma posição). Quando uma tecla muda o
 * dígito de uma casa, o velho sai rolando e o novo entra — por baixo se o valor cresceu, por cima
 * se diminuiu —, e as casas que não mudaram ficam paradas. Casa nova (o número ganhou um dígito)
 * entra rolando; as do primeiro render, não. O `TextInput` continua por cima, transparente, e é ele que recebe teclado,
 * acessibilidade e foco.
 *
 * ⚠️ **O cursor é VISÍVEL e fica no fim.** A queixa de 15/09/2026 foi literal: *"não tem o cursor
 * que fica piscando para eu saber aonde eu tô digitando e o que estou apagando"*. O caret nativo
 * ficaria desalinhado dos dígitos desenhados, então o campo desenha o próprio — uma barra azul
 * piscando logo depois do último dígito. A seleção do input continua presa no fim: com ela no meio
 * de `0,00`, o backspace não muda texto nenhum e o campo trava sem erro.
 */
export function MoneyField({ valueCents, onChangeCents, autoFocus, invalid, readOnly }: MoneyFieldProps) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const { focar, desfocar, moldura } = useCaixa(invalid);
  const [focado, setFocado] = useState(false);
  /** Casas que nascem depois do primeiro render entram rolando; as iniciais, não. */
  const [iniciais] = useState(() =>
    (valueCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }).length
  );
  const reais = (valueCents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const caracteres = reais.split('');

  const piscar = useSharedValue(1);
  useEffect(() => {
    if (!focado || reduzido) {
      cancelAnimation(piscar);
      piscar.set(1);
      return;
    }
    piscar.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(1, { duration: 520 }),
          withTiming(0, { duration: 0 }),
          withTiming(0, { duration: 420 })
        ),
        -1
      )
    );
    return () => cancelAnimation(piscar);
  }, [focado, reduzido, piscar]);
  const cursor = useAnimatedStyle(() => ({ opacity: piscar.get() }));

  const cor = readOnly ? theme.textSecondary : theme.text;

  return moldura(
    <View style={styles.valor}>
      <ThemedText themeColor="textSecondary" style={[Type.title2, styles.moeda]}>
        R$
      </ThemedText>
      <View style={styles.digitos} pointerEvents="none">
        {caracteres.map((c, i) => {
          const posicao = caracteres.length - 1 - i;
          return <Digito key={posicao} ch={c} cor={cor} animar={posicao >= iniciais} />;
        })}
        {focado && !readOnly ? (
          <Animated.View style={[styles.cursor, { backgroundColor: theme.tintFill }, cursor]} />
        ) : null}
      </View>
      <TextInput
        value={reais}
        selection={{ start: reais.length, end: reais.length }}
        onChangeText={(text) => {
          const novo = Number(text.replace(/\D/g, '').slice(0, 11) || 0);
          // Grava a direção ANTES do render que troca os dígitos: é ela que as animações leem.
          direcao.value = novo >= valueCents ? 1 : -1;
          onChangeCents(novo);
        }}
        onFocus={() => {
          setFocado(true);
          focar();
        }}
        onBlur={() => {
          setFocado(false);
          desfocar();
        }}
        keyboardType="number-pad"
        autoFocus={autoFocus}
        editable={!readOnly}
        caretHidden
        contextMenuHidden
        accessibilityLabel="Valor em reais"
        style={styles.captura}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Space.sm,
  },
  rotulo: { fontFamily: Fonts.medium },
  /*
    ⚠️ A borda da caixa é de 1dp, não `hairlineWidth` (15/09/2026). `hairlineWidth` é 1 pixel
    FÍSICO e não sobrevive a escala: na janela reduzida do emulador as arestas somem e restam
    quatro cantinhos vermelhos soltos — a queixa literal *"o vermelho em volta do input ta ficando
    sobreposto"*. Indicador de erro não pode depender de um pixel sobreviver. A largura é
    CONSTANTE nos dois estados, então trocar de cor não desloca o conteúdo.
  */
  caixa: {
    minHeight: HitTarget + 8,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: 1,
    justifyContent: 'center',
  },
  input: {
    minHeight: HitTarget + 6,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    fontFamily: Type.body.fontFamily,
    fontSize: Type.body.fontSize,
  },
  valor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 64,
    paddingHorizontal: Space.lg,
  },
  moeda: { flexShrink: 0 },
  digitos: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    height: Type.money.lineHeight,
    overflow: 'hidden',
  },
  digito: { flexShrink: 0 },
  casa: { flexShrink: 0 },
  sobre: { position: 'absolute', left: 0, top: 0 },
  cursor: {
    width: 2,
    height: Type.money.fontSize * 0.8,
    marginLeft: 3,
    borderRadius: 1,
  },
  /**
   * O input de verdade: cobre a caixa inteira, invisível, e é ele que recebe o toque.
   *
   * ⚠️ A invisibilidade é por OPACIDADE, e diferente por plataforma — a mesma régua do
   * `OtpInput`. `color: 'transparent'` não esconde o texto no Android (o "0,00" do input saía por
   * cima dos dígitos, em outra fonte), e opacidade 0 lá faz o input perder o toque; 0,01 mantém a
   * área ativa sem nada visível.
   */
  captura: {
    ...StyleSheet.absoluteFill,
    color: 'transparent',
    textAlign: 'right',
    fontSize: Type.money.fontSize,
    opacity: Platform.OS === 'android' ? 0.01 : 0,
  },
});
