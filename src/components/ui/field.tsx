import { createContext, forwardRef, useContext, useEffect, useRef, useState } from 'react';
import {
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
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Motion, Radius, Space, Type, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { maskBRDate } from '@/lib/dates';

/** Quanto tempo o traço de foco leva para se desenhar. */
const TRACO_MS = 280;

/**
 * O foco do campo, compartilhado entre o `Field` (rótulo) e o input dentro dele.
 *
 * É um `SharedValue` e não estado React: o rótulo acompanha o foco na thread de UI, sem render.
 * Fora de um `Field` o input usa um valor próprio e só o traço anima.
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
 * ## O foco
 *
 * Focado, o rótulo passa para o azul e anda para a direita, abrindo lugar para um azulejo de 6pt
 * que surge girando — a mesma peça do resto do app, dizendo "é aqui". Tudo em `transform`, sem
 * mexer no layout.
 *
 * ## Label e hint NÃO podem ter o mesmo estilo
 *
 * Os dois eram `type="small"` + `textSecondary`, byte por byte — em 47 campos. Nada separava "o
 * que é o campo" de "explicação sobre o campo", e um formulário com quatro ou cinco hints virava
 * uma parede de cinza de 15px. A distinção anda em DOIS eixos, porque um só não sobrevive a
 * 1,3×: **tamanho** (15 → 13) e **cor** (`text` → `textSecondary`).
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const theme = useTheme();
  const foco = useSharedValue(0);
  const corTexto = theme.text;
  const corFoco = theme.tint;

  const rotulo = useAnimatedStyle(() => ({
    color: interpolateColor(foco.get(), [0, 1], [corTexto, corFoco]),
    transform: [{ translateX: foco.get() * 12 }],
  }));
  const marca = useAnimatedStyle(() => ({
    opacity: foco.get(),
    transform: [{ scale: foco.get() }, { rotate: `${(1 - foco.get()) * -90}deg` }],
  }));

  return (
    <FocoDoCampo.Provider value={foco}>
      <View style={styles.field}>
        <View style={styles.cabeca}>
          <Animated.View
            pointerEvents="none"
            style={[styles.marca, { backgroundColor: theme.tintFill }, marca]}
          />
          {/* O label é IDENTIFICADOR do campo, e por isso vai na cor cheia. */}
          <Animated.Text
            android_hyphenationFrequency="none"
            style={[Type.subhead, styles.rotulo, rotulo]}>
            {label}
          </Animated.Text>
        </View>
        {children}
        {/*
          O erro NÃO apaga o hint. Eles se excluíam por um ternário, e a explicação sumia
          exatamente quando mais importa. Mesma geometria (footnote) nos dois, então a altura não
          pula na validação.
        */}
        {error ? (
          <ThemedText type="footnote" themeColor="danger">
            {error}
          </ThemedText>
        ) : null}
        {hint ? (
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
 * A caixa do Concreto: superfície de tecla com fio de 1px, e um TRAÇO azul de 2px que se desenha
 * da esquerda para a direita no foco. Com erro, o fio e o traço ficam vermelhos e a caixa treme
 * uma vez — no momento em que o erro aparece, não a cada render.
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

  const estiloCaixa = useAnimatedStyle(() => ({ transform: [{ translateX: tremor.get() }] }));
  const estiloTraco = useAnimatedStyle(() => ({ transform: [{ scaleX: invalid ? 1 : foco.get() }] }));

  const focar = () =>
    foco.set(withTiming(1, { duration: reduzido ? 0 : TRACO_MS, easing: Motion.easing.out }));
  const desfocar = () =>
    foco.set(withTiming(0, { duration: reduzido ? 0 : Motion.duration.base, easing: Motion.easing.out }));

  const moldura = (conteudo: React.ReactNode, estilo?: StyleProp<ViewStyle>) => (
    <Animated.View
      style={[
        styles.caixa,
        { backgroundColor: theme.keyFace, borderColor: invalid ? theme.danger : theme.cardBorder },
        estilo,
        estiloCaixa,
      ]}>
      {conteudo}
      <Animated.View
        pointerEvents="none"
        style={[styles.traco, { backgroundColor: invalid ? theme.danger : theme.tintFill }, estiloTraco]}
      />
    </Animated.View>
  );

  return { focar, desfocar, moldura };
}

export const TextField = forwardRef<TextInput, TextInputProps & { invalid?: boolean }>(
  function TextField({ invalid, style, onFocus, onBlur, ...rest }, ref) {
    const theme = useTheme();
    const { focar, desfocar, moldura } = useCaixa(invalid);
    const { caixa, input } = repartir(style);

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
 * diminui (entra por cima).
 *
 * ⚠️ É um valor de MÓDULO, e não prop, de propósito: a animação de saída é escolhida quando o
 * dígito velho desmonta, e ele desmonta com as props do render ANTERIOR — a direção que ele
 * conhece é a da tecla que o criou. Lida aqui, dentro do worklet, ela é a da tecla de agora. Só
 * um campo de valor é digitado por vez, então compartilhar não mistura nada.
 */
const direcao = makeMutable(1);
const ROLA = 0.62;

function entraDigito(valores: EntryAnimationsValues) {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: direcao.value * valores.targetHeight * ROLA }] },
    animations: {
      opacity: withTiming(1, { duration: 160 }),
      transform: [{ translateY: withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) }) }],
    },
  };
}

function saiDigito(valores: ExitAnimationsValues) {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, { duration: 140 }),
      transform: [
        {
          translateY: withTiming(-direcao.value * valores.currentHeight * ROLA, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
          }),
        },
      ],
    },
  };
}

/**
 * Entrada de dinheiro: digita da direita para a esquerda, em centavos. **Caminho ÚNICO.**
 * Teto em R$ 999.999.999,99 para não estourar `bigint` por dedo pesado.
 *
 * ## O odômetro
 *
 * O número que se vê não é o texto do `TextInput`: é uma fileira de dígitos, cada um identificado
 * pela POSIÇÃO a partir da direita e pelo próprio valor. Quando uma tecla muda um dígito, o velho
 * sai rolando e o novo entra — por baixo se o valor cresceu, por cima se diminuiu —, e os que não
 * mudaram ficam parados. O `TextInput` continua por cima, transparente, e é ele que recebe teclado,
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
          return (
            <Animated.Text
              key={`${posicao}:${c}`}
              entering={reduzido ? undefined : entraDigito}
              exiting={reduzido ? undefined : saiDigito}
              style={[Type.money, tabular, styles.digito, { color: cor }]}>
              {c}
            </Animated.Text>
          );
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
  cabeca: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rotulo: { flexShrink: 1 },
  /** O azulejo do foco: nasce no lugar onde o rótulo estava. */
  marca: {
    position: 'absolute',
    left: 0,
    width: 6,
    height: 6,
    borderTopRightRadius: 6,
  },
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
    overflow: 'hidden',
    justifyContent: 'center',
  },
  /** O traço de foco: 2px na base, desenhado da esquerda. */
  traco: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    transformOrigin: 'left',
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
  cursor: {
    width: 2,
    height: Type.money.fontSize * 0.8,
    marginLeft: 3,
    borderRadius: 1,
  },
  /** O input de verdade: cobre a caixa inteira, invisível, e é ele que recebe o toque. */
  captura: {
    ...StyleSheet.absoluteFill,
    color: 'transparent',
    textAlign: 'right',
    fontSize: Type.money.fontSize,
  },
});
