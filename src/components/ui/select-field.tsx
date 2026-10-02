import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, interpolateColor, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Icon, type IconName } from '@/components/ui/icon';
import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { ThemedText } from '@/components/themed-text';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { Elevation, Motion, Radius, Space, Type } from '@/design/tokens';
import { PressableScale } from '@/components/motion/pressable-scale';
import { MudancaSuave, Presenca, usePresencaAtiva } from '@/components/motion/presenca';

export type SelectOption = {
  /** `null` é a opção "nenhum" — ela existe se você a incluir na lista. */
  id: string | null;
  label: string;
  /** Segunda linha: o que DISTINGUE esta opção das outras. */
  meta?: string;
  icon?: IconName;
  /** Cabeçalho que precede esta opção. Repetido em opções seguidas, desenha uma vez. */
  group?: string;
  /**
   * A opção não representa uma entidade (é "nenhum", "todos"): o glifo dela não
   * acende no accent quando escolhida. Sem isso, "Não informar" selecionado
   * vira o elemento mais gritante da tela — e ele é a AUSÊNCIA de escolha.
   */
  neutral?: boolean;
};

/**
 * Escolher UM item de uma lista curta, dentro de um formulário.
 *
 * ## Por que colapsado
 *
 * A primeira versão nascia aberta, e com seis contas ela ocupava meia tela antes
 * de o usuário pedir qualquer coisa — a queixa foi literal: *"ele aberto já logo
 * de cara assim, nao é muito clean"*. Campo de formulário mostra o VALOR; a
 * lista é o que aparece quando você vai trocá-lo.
 *
 * ## Por que abre no lugar, e não num sheet
 *
 * `formSheet` seria o mecanismo natural para "escolha curta" (§8 do design), mas
 * **quatro dos formulários que usam este campo já vivem dentro de um `Sheet`** —
 * recorrentes, dívidas (×3), regras e importação. `Modal` dentro de `Modal` no
 * Android é uma janela dentro de outra, com o teclado e o botão voltar
 * disputando qual delas fecha. Abrir no lugar não tem esse problema e mantém o
 * resto do formulário à vista, que é o que a pessoa está preenchendo.
 *
 * ## Um campo, todas as telas
 *
 * O padrão anterior era `<Row title={x.name}/>` em quatro telas e `<Chip/>` em
 * outras quatro — o mesmo campo com duas caras e oito implementações. Componente
 * novo que precise escolher item de lista curta usa este; não recrie.
 */
export function SelectField({
  options,
  value,
  selectedOption,
  onChange,
  placeholder = 'Escolher uma opção',
}: {
  options: readonly SelectOption[];
  value: string | null;
  /** Identidade preservada no rascunho quando a lista de escolhas foi filtrada. */
  selectedOption?: SelectOption | null;
  onChange: (id: string | null) => void;
  /** O que o campo diz quando nada foi escolhido. */
  placeholder?: string;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const ativo = usePresencaAtiva();
  const [escolha, setEscolha] = useState({ aberto: false, abertura: 0 });
  const { aberto, abertura } = escolha;
  const [confirmacao, setConfirmacao] = useState<{ id: string | null } | null>(null);
  const [presenca, setPresenca] = useState({ ativa: ativo, fechamento: 0, visita: 0 });
  const escolhendo = useRef(false);
  const abertoAtual = useRef(false);
  const ativoAtual = useRef(ativo);
  const aberturaAtual = useRef(0);
  const visitaAtual = useRef(0);
  const vidro = supportsLiquidGlass();

  // Conserve o bloco que sai; ao voltar, preserve o valor e descarte só a UI de escolha.
  if (presenca.ativa !== ativo) {
    setPresenca({ ativa: ativo, fechamento: presenca.fechamento + Number(ativo && aberto), visita: presenca.visita + Number(ativo) });
    if (ativo) { setEscolha({ ...escolha, aberto: false }); setConfirmacao(null); }
  }
  useLayoutEffect(() => {
    ativoAtual.current = ativo;
    abertoAtual.current = ativo && aberto;
    visitaAtual.current = presenca.visita;
    return () => { ativoAtual.current = false; abertoAtual.current = false; };
  }, [ativo, aberto, presenca.visita]);

  const elegivel = options.find((o) => o.id === value);
  const escolhida = elegivel ?? (value !== null && selectedOption?.id === value ? selectedOption : undefined);

  function alternar() {
    if (!ativoAtual.current || visitaAtual.current !== presenca.visita || aberturaAtual.current !== abertura) return;
    escolhendo.current = false;
    setConfirmacao(null);
    Haptics.selectionAsync();
    if (!abertoAtual.current) {
      aberturaAtual.current += 1;
    }
    abertoAtual.current = !abertoAtual.current;
    setEscolha({ aberto: abertoAtual.current, abertura: aberturaAtual.current });
  }

  function escolher(id: string | null) {
    if (!ativoAtual.current || visitaAtual.current !== presenca.visita || !abertoAtual.current || escolhendo.current || aberturaAtual.current !== abertura) return;
    escolhendo.current = true;
    abertoAtual.current = false;
    setConfirmacao(id !== value ? { id } : null);
    if (id !== value) Haptics.selectionAsync();
    onChange(id);
    setEscolha({ ...escolha, aberto: false });
  }

  const ladrilho = (icone: IconName | undefined, aceso: boolean) =>
    icone ? (
      /* O contorno não é enfeite: no escuro `backgroundElement` (#201F21) e
         `surface` (#1B1B1D) distam 5 pontos, e sem o fio o ladrilho não tem onde
         terminar. Mesma razão do contorno de todo card do app. */
      <View
        style={[
          styles.ladrilho,
          {
            backgroundColor: aceso ? theme.tintFill : theme.backgroundElement,
            borderColor: aceso ? 'transparent' : theme.cardBorder,
          },
        ]}>
        <Icon name={icone} size="sm" color={aceso ? 'onTint' : 'textSecondary'} />
      </View>
    ) : null;

  const linha = (o: SelectOption | undefined, cabecalho = false) => {
    const cabecalhoPreservado = cabecalho && !elegivel;
    const marcada = o?.id === value;
    const aceso = marcada && !o?.neutral;
    const confirmada = confirmacao !== null && confirmacao.id === o?.id && marcada;
    const mostrarCheck = marcada && ((aberto && !cabecalhoPreservado) || confirmada);
    const icone = ladrilho(o?.icon ?? (cabecalho ? 'circle' : undefined), aceso);
    const textos = <>
      <ThemedText type={marcada ? 'headline' : 'default'} themeColor={o ? 'text' : 'textSecondary'} style={styles.textoInteiro}>
        {o?.label ?? placeholder}
      </ThemedText>
      {o?.meta ? <ThemedText type="caption" themeColor="textSecondary" style={styles.textoInteiro}>{o.meta}</ThemedText> : null}
    </>;
    const indicador = mostrarCheck ? (
      <View style={[styles.marca, { backgroundColor: theme.tintFill }]}><Icon name="checkmark" size="xs" color="onTint" /></View>
    ) : cabecalho ? <Icon name="chevron.down" size="sm" color="textSecondary" /> : null;
    return (
      <PressableScale scaleTo={1}
        onPress={cabecalho ? aberto && !cabecalhoPreservado ? () => escolher(value) : alternar : () => escolher(o!.id)}
        disabled={!ativo}
        accessibilityRole={aberto && !cabecalhoPreservado ? 'radio' : 'button'}
        accessibilityState={{ selected: aberto && marcada && !cabecalhoPreservado, expanded: cabecalho ? aberto : undefined, disabled: !ativo }}
        accessibilityLabel={o ? o.meta ? `${o.label}, ${o.meta}` : o.label : placeholder}
        accessibilityHint={aberto && cabecalhoPreservado ? 'Toque para fechar as opções' : aberto ? 'Toque para escolher e fechar' : 'Toque para escolher'}>
        {({ pressed }) => <LinhaRealcada pressionada={pressed} confirmar={confirmada}>
          {/* Só o cabeçalho troca conteúdo; alternativas estáveis não precisam de três morphs. */}
          {cabecalho ? <MudancaSuave valor={`${o?.icon}:${aceso}`}>{icone}</MudancaSuave> : <View>{icone}</View>}
          {cabecalho ? <MudancaSuave valor={o?.id} style={styles.textos}>{textos}</MudancaSuave> : <View style={styles.textos}>{textos}</View>}
          {cabecalho ? <MudancaSuave valor={mostrarCheck} style={styles.indicador}>{indicador}</MudancaSuave> : <View style={styles.indicador}>{indicador}</View>}
        </LinhaRealcada>}
      </PressableScale>
    );
  };

  return (
    <View style={[styles.moldura, { backgroundColor: vidro ? 'transparent' : theme.surface,
      borderColor: theme.cardBorder, boxShadow: vidro ? undefined : Elevation[scheme].raised }]}
      accessibilityRole={aberto ? 'radiogroup' : undefined}>
      {vidro ? <GlassBackdrop fallbackColor={theme.surface} radius={Radius.md} /> : null}
      {/* A linha escolhida permanece na mesma posição e vira a primeira opção. Nunca duplica. */}
      {linha(escolhida, true)}
      <Presenca key={presenca.fechamento} visivel={aberto} preparar onSaidaConcluida={() => setConfirmacao(null)}>
        {options.filter((o) => o.id !== value).map((o, i, restantes) => (
          <Fragment key={o.id ?? '__nenhum__'}>
            {o.group && o.group !== restantes[i - 1]?.group ? (
              <View style={styles.cabecalho}><ThemedText type="caption" themeColor="textSecondary" style={styles.etiqueta}>{o.group}</ThemedText></View>
            ) : <View style={[styles.divisor, { backgroundColor: theme.separator }]} />}
            {linha(o)}
          </Fragment>
        ))}
      </Presenca>
    </View>
  );
}

function LinhaRealcada({ pressionada, confirmar, children }: {
  pressionada: boolean; confirmar: boolean; children: ReactNode;
}) {
  const theme = useTheme();
  const reduzir = useReducedMotion();
  const realce = useSharedValue(0);
  useLayoutEffect(() => {
    const config = { easing: Motion.easing.out, reduceMotion: ReduceMotion.System };
    if (reduzir) realce.set(Number(pressionada));
    else if (confirmar) {
      // O flash termina em 180ms; não espera a mola da lista assentar para remover o cinza.
      realce.set(withSequence(
        withTiming(1, { ...config, duration: Motion.duration.fast / 2 }),
        withTiming(0, { ...config, duration: Motion.duration.fast }),
      ));
    } else realce.set(withTiming(Number(pressionada), { ...config, duration: Motion.duration.fast }));
    return () => cancelAnimation(realce);
  }, [pressionada, confirmar, reduzir, realce]);
  const cores = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(realce.get(), [0, 1], ['transparent', theme.backgroundSelected]),
  }));
  return <Animated.View style={[styles.linha, cores]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  moldura: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
  },
  /** Caixa de GEOMETRIA: o ícone não cresce com a fonte, o texto ao lado sim. */
  ladrilho: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // O bloco acompanha o centro do ladrilho, mesmo com título e descrição ou fonte ampliada.
  textos: { flex: 1, minHeight: 36, justifyContent: 'center', gap: Space.half },
  textoInteiro: { flexShrink: 0, includeFontPadding: false, textAlignVertical: 'center' },
  // Seta e check usam a mesma coluna; a largura menor da seta não pode recortar o círculo.
  indicador: {
    width: 24,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marca: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Separa o VALOR da lista: vai de ponta a ponta, porque separa duas coisas diferentes. */
  divisorCheio: { height: StyleSheet.hairlineWidth },
  /** Entre opções: começa depois do ladrilho, para agrupar em vez de fatiar. */
  divisor: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Space.lg + 36 + Space.md,
  },
  cabecalho: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.xs,
  },
  etiqueta: Type.meta,
});
