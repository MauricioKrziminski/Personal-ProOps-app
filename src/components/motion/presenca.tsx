import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, ReduceMotion, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Motion, Space } from '@/design/tokens';

const PresencaAtiva = createContext(true);

/** Um bloco que está saindo é só visual: não recebe edição nem ajusta valores por efeito. */
export function usePresencaAtiva() {
  return useContext(PresencaAtiva);
}

/** A mola parte do progresso atual; espaço e conteúdo acompanham o mesmo percurso. */
export function usePresenca(visivel: boolean, animarEntradaNaMontagem = false, pronto = true) {
  const reduzir = useReducedMotion();
  const [estado, setEstado] = useState({ visivel, presente: visivel, assentado: !animarEntradaNaMontagem });
  if (estado.visivel !== visivel || (reduzir && !visivel && estado.presente)) {
    setEstado({ visivel, presente: visivel || (!reduzir && estado.presente), assentado: reduzir });
  }
  const presente = visivel || (!reduzir && estado.presente);
  const versao = useRef(0);
  const progresso = useSharedValue(visivel && !animarEntradaNaMontagem ? 1 : 0);
  const estilo = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, progresso.get())) }));

  useLayoutEffect(() => {
    const atual = ++versao.current;
    const assentar = () => {
      if (versao.current === atual) setEstado({ visivel, presente: visivel, assentado: true });
    };
    if (reduzir || (visivel && estado.assentado)) {
      progresso.set(Number(visivel));
    } else if (presente && (!visivel || pronto)) {
      progresso.set(withSpring(Number(visivel), {
        ...Motion.spring.morph,
        reduceMotion: ReduceMotion.System,
      }, (terminou) => {
        if (terminou) runOnJS(assentar)();
      }));
    }
    return () => {
      versao.current += 1;
    };
  }, [visivel, presente, reduzir, progresso, estado.assentado, pronto]);
  useLayoutEffect(() => () => cancelAnimation(progresso), [progresso]);

  return { presente, estilo, reduzir, progresso, assentado: reduzir || estado.assentado };
}

type PropsDePresenca = {
  visivel: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Listas curtas já medem e instalam seu movimento antes do primeiro toque. */
  preparar?: boolean;
  /** Campos interativos aparecem inteiros no render da ação; só o deslocamento é animado. */
  imediata?: boolean;
  /** Confirma o recolhimento real, sem timer nem atraso na ação do usuário. */
  onSaidaConcluida?: () => void;
};

/** Blocos comuns são preguiçosos; seletores podem preparar sua pequena lista oculta. */
export function Presenca(props: PropsDePresenca) {
  const [entrada, setEntrada] = useState({ montada: props.visivel || !!props.preparar, animar: !props.visivel });
  if ((props.visivel || props.preparar) && !entrada.montada) setEntrada({ ...entrada, montada: true });
  if (!entrada.montada) return null;
  if (props.imediata) return <PresencaImediata {...props} animarEntradaNaMontagem={entrada.animar} />;
  return <PresencaAnimada {...props} animarEntradaNaMontagem={entrada.animar} />;
}

/** O estado define geometria e visibilidade; a animação não participa da disponibilidade. */
function PresencaImediata({ visivel, children, style, preparar, onSaidaConcluida, animarEntradaNaMontagem }: PropsDePresenca & {
  animarEntradaNaMontagem: boolean;
}) {
  const paiAtivo = usePresencaAtiva();
  const reduzir = useReducedMotion();
  const deslocamento = useSharedValue(visivel && !animarEntradaNaMontagem ? 0 : Space.xs);
  const movimento = useAnimatedStyle(() => ({ transform: [{ translateY: reduzir ? 0 : deslocamento.get() }] }));
  useLayoutEffect(() => {
    deslocamento.set(visivel ? reduzir ? 0 : withTiming(0, {
      duration: Motion.duration.fast, easing: Motion.easing.out, reduceMotion: ReduceMotion.System,
    }) : Space.xs);
    return () => cancelAnimation(deslocamento);
  }, [visivel, reduzir, deslocamento]);
  const esteveVisivel = useRef(visivel);
  useLayoutEffect(() => {
    const saiu = esteveVisivel.current && !visivel;
    esteveVisivel.current = visivel;
    if (saiu) onSaidaConcluida?.();
  }, [visivel, onSaidaConcluida]);
  if (!visivel && !preparar) return null;
  const ativa = paiAtivo && visivel;
  return (
    <PresencaAtiva.Provider value={ativa}>
      <Animated.View collapsable={false}
        style={[visivel ? styles.natural : styles.recorte, { height: visivel ? 'auto' : 0 }]}
        pointerEvents={ativa ? 'auto' : 'none'} accessibilityElementsHidden={!ativa}
        importantForAccessibility={ativa ? 'auto' : 'no-hide-descendants'}>
        <Animated.View collapsable={false}
          style={[styles.conteudoDePresenca, !visivel ? styles.medicao : undefined, style, { opacity: Number(visivel) }, movimento]}>
          {children}
        </Animated.View>
      </Animated.View>
    </PresencaAtiva.Provider>
  );
}

function PresencaAnimada({ visivel, children, style, preparar, onSaidaConcluida, animarEntradaNaMontagem }: PropsDePresenca & {
  animarEntradaNaMontagem: boolean;
}) {
  const paiAtivo = usePresencaAtiva();
  const [medido, setMedido] = useState(false);
  const vivo = useRef(true);
  useLayoutEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);
  const { presente, estilo, reduzir, progresso, assentado } = usePresenca(visivel, animarEntradaNaMontagem, !preparar || medido);
  const estevePresente = useRef(presente);
  useLayoutEffect(() => {
    const saiu = estevePresente.current && !presente;
    estevePresente.current = presente;
    if (saiu && !visivel) onSaidaConcluida?.();
  }, [presente, visivel, onSaidaConcluida]);
  const [ultimoConteudo, setUltimoConteudo] = useState(children);
  if ((visivel || !presente) && children !== ultimoConteudo) setUltimoConteudo(children);
  const altura = useSharedValue(0);
  const envelope = useAnimatedStyle(() => ({
    // Fabric precisa receber o retorno ao layout natural explicitamente após a altura animada.
    height: !presente ? 0 : assentado || reduzir ? 'auto' : altura.get() * Math.max(0, progresso.get()),
  }));
  if (!presente && !preparar) return null;
  const ativa = paiAtivo && visivel;
  const natural = presente && (assentado || reduzir);
  const medir = (event: LayoutChangeEvent) => {
    if (!vivo.current) return;
    const nova = event.nativeEvent.layout.height;
    if (Number.isFinite(nova) && (nova > 0 || (preparar && nova === 0))) {
      altura.set(nova);
      if (preparar) setMedido(true);
    }
  };
  return (
    <PresencaAtiva.Provider value={ativa}>
      <Animated.View
        collapsable={false}
        style={[natural ? styles.natural : styles.recorte, envelope]}
        pointerEvents={ativa ? 'auto' : 'none'}
        accessibilityElementsHidden={!ativa}
        importantForAccessibility={ativa ? 'auto' : 'no-hide-descendants'}>
        <Animated.View
          collapsable={false}
          onLayout={medir}
          style={[styles.conteudoDePresenca, preparar && !natural ? styles.medicao : undefined, style,
            !presente ? { opacity: 0 } : natural ? styles.parado : estilo]}>
          {visivel || !presente ? children : ultimoConteudo}
        </Animated.View>
      </Animated.View>
    </PresencaAtiva.Provider>
  );
}

type Camada = { estado: string; children: ReactNode; chave: number };

/** Troca em paralelo: o próximo corpo já existe enquanto o anterior sai. Não há quadro vazio. */
export function TrocaSuave({ estado, children, style, preencher = false, deslocamento = Space.sm }: {
  estado: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corpos de tela têm a mesma moldura; os blocos menores transformam a própria altura. */
  preencher?: boolean;
  /** Rótulos sobrepostos ficam alinhados; corpos de tela percorrem uma distância curta. */
  deslocamento?: number;
}) {
  const paiAtivo = usePresencaAtiva();
  const reduzir = useReducedMotion();
  const [camadas, setCamadas] = useState<{ atual: Camada; anterior: Camada | null; versao: number; continua: boolean }>({
    atual: { estado, children, chave: 0 }, anterior: null, versao: 0, continua: false,
  });
  if (camadas.atual.estado !== estado) {
    setCamadas({
      atual: { estado, children, chave: camadas.versao + 1 },
      anterior: reduzir ? null : camadas.anterior ?? camadas.atual,
      versao: camadas.versao + 1,
      continua: Boolean(camadas.anterior) && !reduzir,
    });
  } else if (camadas.atual.children !== children || (reduzir && camadas.anterior)) {
    setCamadas({ ...camadas, atual: { ...camadas.atual, children }, anterior: reduzir ? null : camadas.anterior });
  }
  const progresso = useSharedValue(1);
  const altura = useSharedValue(0);
  const largura = useSharedValue(0);
  const versao = useRef(0);
  const camadaMedida = useRef(camadas.versao);
  const iniciar = useRef<(() => void) | null>(null);
  const trocando = Boolean(camadas.anterior) && !reduzir;
  const entrada = useAnimatedStyle(() => ({
    opacity: trocando ? Math.min(1, Math.max(0, progresso.get())) : 1,
    transform: [{ translateY: trocando && !reduzir ? deslocamento * (1 - progresso.get()) : 0 }],
  }));
  const saida = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, progresso.get())) }));
  const envelope = useAnimatedStyle(() => ({
    height: preencher ? undefined : trocando ? Math.max(0, altura.get()) : 'auto',
    // As duas camadas absolutas não podem retirar a largura intrínseca de ícones/rótulos.
    width: preencher ? undefined : trocando && largura.get() > 0 ? largura.get() : 'auto',
  }));

  useLayoutEffect(() => {
    const atual = ++versao.current;
    camadaMedida.current = camadas.versao;
    if (!trocando) {
      progresso.set(1);
      iniciar.current = null;
    } else {
      // A saída permanece visível até o próximo conteúdo ter layout nativo.
      if (!camadas.continua) progresso.set(0);
      iniciar.current = () => {
        iniciar.current = null;
        const assentar = () => {
          if (versao.current === atual) setCamadas((c) => ({ ...c, anterior: null }));
        };
        progresso.set(withSpring(1, {
          ...Motion.spring.morph, reduceMotion: ReduceMotion.System,
        }, (terminou) => { if (terminou) runOnJS(assentar)(); }));
      };
    }
    return () => {
      versao.current += 1;
      camadaMedida.current = -1;
      iniciar.current = null;
    };
  }, [camadas.versao, camadas.continua, trocando, reduzir, progresso]);
  useLayoutEffect(() => () => {
    cancelAnimation(progresso);
    cancelAnimation(altura);
  }, [progresso, altura]);

  const medir = (event: LayoutChangeEvent) => {
    // Um evento nativo atrasado não pode iniciar nem medir a próxima intenção.
    if (camadaMedida.current !== camadas.versao) return;
    const nova = event.nativeEvent.layout.height;
    if (!trocando && !preencher) largura.set(event.nativeEvent.layout.width);
    if (nova > 0 && !preencher) altura.set(trocando ? withSpring(nova, {
      ...Motion.spring.morph, reduceMotion: ReduceMotion.System,
    }) : nova);
    iniciar.current?.();
  };

  return (
    <Animated.View collapsable={false} style={[preencher ? styles.preencher : trocando ? styles.recorte : styles.natural,
      !preencher && style ? { flex: StyleSheet.flatten(style)?.flex } : undefined, envelope]}>
      {[
        camadas.anterior && !reduzir ? (
          <PresencaAtiva.Provider key={`${camadas.anterior.estado}:${camadas.anterior.chave}`} value={false}>
            <Animated.View collapsable={false} style={[style, styles.medicao, preencher ? styles.preencherCamada : undefined, saida]}
              pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {camadas.anterior.children}
            </Animated.View>
          </PresencaAtiva.Provider>
        ) : null,
        <PresencaAtiva.Provider key={`${camadas.atual.estado}:${camadas.atual.chave}`} value={paiAtivo}>
          <Animated.View collapsable={false} onLayout={medir}
            style={[style, trocando ? styles.medicao : styles.posicaoNatural, preencher ? styles.preencherCamada : undefined, trocando ? entrada : styles.parado]}
            pointerEvents={paiAtivo ? 'auto' : 'none'} accessibilityElementsHidden={!paiAtivo}
            importantForAccessibility={paiAtivo ? 'auto' : 'no-hide-descendants'}>
            {children}
          </Animated.View>
        </PresencaAtiva.Provider>,
      ]}
    </Animated.View>
  );
}

/** Só rótulos e conteúdo discreto usam crossfade; TextInput permanece fora deste componente. */
export function MudancaSuave({ valor, children, style }: {
  valor: string | number | boolean | null | undefined;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <TrocaSuave estado={`${typeof valor}:${valor}`} style={style} deslocamento={0}>{children}</TrocaSuave>;
}

const styles = StyleSheet.create({
  recorte: { overflow: 'hidden' },
  natural: { height: 'auto', width: 'auto' },
  posicaoNatural: { position: 'relative' },
  parado: { opacity: 1, transform: [{ translateY: 0 }] },
  // Medição natural dentro do envelope: o conteúdo não troca de posição absoluta para relativa.
  conteudoDePresenca: { flexShrink: 0 },
  medicao: { position: 'absolute', top: 0, left: 0, right: 0 },
  preencher: { flex: 1 },
  preencherCamada: { flex: 1, height: '100%' },
});
