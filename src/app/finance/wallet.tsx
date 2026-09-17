import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorCard } from '@/components/error-card';
import { BaseDaPilha, FaceEmVoo } from '@/components/finance/card-face';
import { BaseDaDoca, resumoDaFatura } from '@/components/finance/invoice-dock';
import { WalletCarousel, useGeometriaDaVitrine } from '@/components/finance/wallet-carousel';
import { useFlight, useFlightAnchor } from '@/components/motion/flight-layer';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useBRL } from '@/components/ui/conceal';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { DragScrollView } from '@/components/ui/drag-scroll';
import { EmptyState } from '@/components/ui/empty-state';
import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/ui/sparkline';
import { TaskHeader } from '@/components/ui/task-header';
import type { ThemeColor } from '@/constants/theme';
import { distanciaDoItem } from '@/design/carousel-math';
import { caixaArrastada, type Caixa } from '@/design/flight-math';
import { Motion, Radius, Space, tabular } from '@/design/tokens';
import { escolherCartao, useCartaoEscolhido } from '@/hooks/use-cartao-escolhido';
import { invoiceQuery, useCardSummary, type CardSummary } from '@/hooks/use-finance';
import { formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import { cartaoDaPilha, estadoDaFatura, prazoLabel } from '@/lib/card-status';

/** Quanto arrastar para baixo (ou com que velocidade) para fechar. */
const LIMIAR_DE_FECHAR = 120;
const VELOCIDADE_DE_FECHAR = 800;

/**
 * A Carteira — os cartões em pé, um de cada vez, e tudo que é do cartão num lugar só.
 *
 * Chega-se aqui tocando na pilha do Financeiro ou na miniatura de Cartões: o cartão levanta,
 * gira e pousa no centro do carrossel (`flight-layer.tsx`). Fechar faz o caminho de volta — pelo
 * ✕, pelo voltar do Android e pelo arraste para baixo, que caem todos no mesmo `beforeRemove`.
 *
 * ## O que agrupa
 *
 * A área do cartão, sem destino novo: a fatura (ou a lista de cartões, sem fatura aberta), as
 * faturas anteriores DAQUELE cartão, todos os cartões. Os números do cartão da frente — fatura
 * atual, fechamento, vencimento, limite, disponível, atraso — ficam legíveis embaixo do cartão,
 * que em pé mostra só o nome (como no vídeo).
 *
 * Trocar de cartão grava a escolha (`escolherCartao`): a pilha do Financeiro, montada por baixo,
 * se reordena, e o cartão volta voando para a frente dela.
 *
 * ⚠️ **É um `push` com `fade`, não um modal transparente** — ver o plano da fase 4. O custo: atrás
 * de um `push` o iOS não desenha a tela de baixo, então o arraste esmaece o CONTEÚDO, não o fundo.
 */
export default function WalletScreen() {
  const { card, origem } = useLocalSearchParams<{ card?: string; origem?: string }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { voar, temAncora } = useFlight();
  const moldura = useFlightAnchor('vitrine');
  const g = useGeometriaDaVitrine();

  const cards = useCardSummary();
  const lista = useMemo(() => (cards.isError ? [] : (cards.data ?? [])), [cards.data, cards.isError]);
  const escolhido = useCartaoEscolhido();
  const [ativoId, setAtivoId] = useState<string | null>(card ?? null);
  const idAtivo = ativoId ?? escolhido ?? null;
  const indice = Math.max(0, lista.findIndex((c) => c.account_id === idAtivo));
  const ativo: CardSummary | undefined = lista[indice];
  // Aberta por link, sem cartão no endereço: espera a escolha gravada antes de posicionar.
  const pronto = lista.length > 0 && (ativoId !== null || escolhido !== undefined);

  const x = useSharedValue(indice * g.passo);
  const arrasto = useSharedValue(0);

  // A fatura do cartão da frente, já carregada: o cartão pousa na fatura com o total, sem esqueleto.
  const invoiceId = ativo?.invoice_id;
  useEffect(() => {
    if (invoiceId) queryClient.prefetchQuery(invoiceQuery(invoiceId));
  }, [invoiceId, queryClient]);

  // Abrir a Carteira num cartão é escolhê-lo: a pilha de baixo precisa mostrar o mesmo cartão
  // para onde ele vai voltar voando (vale também para quem chega pela miniatura de Cartões).
  useEffect(() => {
    if (card) escolherCartao(card);
  }, [card]);

  const trocar = (i: number) => {
    const id = lista[i]?.account_id;
    if (!id) return;
    setAtivoId(id);
    escolherCartao(id);
  };

  /*
    O voo de volta. Todas as saídas passam por aqui (✕, voltar do Android, arraste), e a tela sai
    AO MESMO TEMPO que o cartão voa — o `fade` nativo e a mola do voo correm juntos.
  */
  const ativoAgora = useRef(ativo);
  // A caixa de onde o voo de volta sai quando o cartão foi arrastado (senão, a moldura).
  const saida = useSharedValue<Caixa | null>(null);
  useEffect(() => {
    ativoAgora.current = ativo;
  }, [ativo]);
  const saindo = useRef(false);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        const c = ativoAgora.current;
        if (saindo.current || !c) return;
        const id = c.account_id;
        const para = origem === 'pilha' ? 'pilha' : origem === 'miniatura' ? `miniatura:${id}` : null;
        if (!para || !temAncora(para)) return;
        // A tela só sai depois que o cartão decolou — ver `voar` em `flight-layer.tsx`.
        e.preventDefault();
        saindo.current = true;
        void voar({
          de: saida.get() ?? 'vitrine',
          poseDe: 'em-pe',
          esconderDe: `vitrine:${id}`,
          para,
          posePara: 'deitado',
          esconderPara: origem === 'pilha' ? `pilha:${id}` : para,
          desenho: (progresso) => (
            <FaceEmVoo
              nome={c.name}
              atrasada={Number(c.overdue_count ?? 0) > 0}
              progresso={progresso}
              basePara={origem === 'pilha' ? <BaseDaPilha card={cartaoDaPilha(c)} /> : undefined}
            />
          ),
        }).then(() => navigation.dispatch(e.data.action));
      }),
    [navigation, origem, temAncora, voar, saida]
  );

  // Aberta por link, sem nada atrás, "voltar" não tem destino: cai no Financeiro, a casa dela.
  const fechar = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/finance');
  }, []);

  const medirMoldura = moldura.medir;
  const fecharArrastado = useCallback(
    async (dy: number) => {
      const caixa = await medirMoldura();
      saida.set(caixa ? caixaArrastada(caixa, dy, 1 - Math.min(dy / 900, 0.25)) : null);
      fechar();
    },
    [medirMoldura, saida, fechar]
  );

  const verFatura = () => {
    const c = ativo;
    if (!c) return;
    if (!c.invoice_id) {
      router.push('/finance/cards');
      return;
    }
    const dados = queryClient.getQueryData<Awaited<ReturnType<ReturnType<typeof invoiceQuery>['queryFn']>>>(
      invoiceQuery(c.invoice_id).queryKey
    );
    const resumo = dados ? resumoDaFatura(dados) : null;
    void voar({
      de: 'vitrine',
      poseDe: 'em-pe',
      esconderDe: `vitrine:${c.account_id}`,
      para: 'doca',
      posePara: 'deitado',
      esconderPara: 'doca',
      desenho: (progresso) => (
        <FaceEmVoo
          nome={c.name}
          atrasada={resumo ? resumo.atrasada : Number(c.overdue_count ?? 0) > 0}
          progresso={progresso}
          basePara={resumo ? <BaseDaDoca nome={c.name} resumo={resumo} /> : undefined}
        />
      ),
    }).then(
      (ok) =>
        ok && router.push({ pathname: '/finance/invoice/[id]', params: { id: c.invoice_id!, via: 'carteira' } })
    );
  };

  // A página e o quanto ela rolou: o arraste para fechar só vale com ela no topo.
  const pagina = useAnimatedRef<Animated.ScrollView>();
  const topoDaPagina = useSharedValue(0);
  const aoRolarPagina = useAnimatedScrollHandler((e) => {
    topoDaPagina.set(e.contentOffset.y);
  });

  const esmaece = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(arrasto.get() / 240, 1) * 0.9,
  }));

  let corpo: React.ReactNode;
  if (cards.isError) {
    corpo = (
      <View style={styles.aviso}>
        <ErrorCard onRetry={cards.refetch} />
      </View>
    );
  } else if (cards.isLoading || (lista.length > 0 && !pronto)) {
    corpo = (
      <View style={styles.esqueleto}>
        <Skeleton height={g.deitado} width={g.emPe} radius={Radius.md} />
      </View>
    );
  } else if (!ativo) {
    corpo = (
      <View style={styles.aviso}>
        <EmptyState
          icon="creditcard"
          title="Nenhum cartão cadastrado"
          hint="Cadastre o cartão com o dia que fecha e o dia que vence."
          action={{ label: 'Cadastrar cartão', onPress: () => router.push('/finance/accounts') }}
        />
      </View>
    );
  } else {
    corpo = (
      <DragScrollView
        ref={pagina}
        style={styles.flex}
        onScroll={aoRolarPagina}
        scrollEventThrottle={16}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.conteudo, { paddingBottom: insets.bottom + Space.lg }]}>
        <Animated.View style={[styles.titulos, esmaece]}>
          {lista.map((c, i) => (
            <Titulo key={c.account_id} card={c} indice={i} x={x} passo={g.passo} emFluxo={i === indice} />
          ))}
        </Animated.View>

        <ArrasteParaFechar
          pagina={pagina}
          topoDaPagina={topoDaPagina}
          arrasto={arrasto}
          onFechar={fecharArrastado}>
          <WalletCarousel
            cards={lista}
            indiceInicial={indice}
            onIndice={trocar}
            x={x}
            arrasto={arrasto}
            prenderMoldura={moldura.prender}
            molduraPosicionada={moldura.aoPosicionar}
          />
        </ArrasteParaFechar>

        <Animated.View style={[styles.miolo, esmaece]}>
          {lista.length > 1 ? <Pontos total={lista.length} x={x} passo={g.passo} /> : null}
          <Detalhes card={ativo} />
        </Animated.View>

        <Animated.View style={[styles.acoes, esmaece]}>
          <Button block size="lg" label={ativo.invoice_id ? 'Ver fatura' : 'Ver cartões'} onPress={verFatura} />
          <Section>
            <Row
              icon="calendar"
              title="Faturas anteriores"
              onPress={() =>
                router.push({ pathname: '/finance/invoices', params: { account: ativo.account_id } })
              }
            />
            <Row icon="creditcard" title="Todos os cartões" onPress={() => router.push('/finance/cards')} />
          </Section>
        </Animated.View>
      </DragScrollView>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={styles.flex}>
        <TaskHeader title="Carteira" onClose={fechar} telaCheia />
        {corpo}
      </View>
    </Screen>
  );
}

/**
 * O arraste para baixo que fecha a Carteira, em volta do carrossel.
 *
 * ⚠️ **Ele convive com a rolagem da página, e três coisas fazem isso funcionar nos dois sistemas:**
 *
 * - A página é o `ScrollView` do gesture-handler (`DragScrollView`) e a relação é declarada
 *   (`simultaneousWithExternalGesture`). Com o `ScrollView` comum, o Android rouba o toque no
 *   meio do arraste: o cartão ficava parado no meio do caminho, sem fechar nem voltar. E
 *   embrulhar o `DragScrollView` num `Gesture.Native()` parava a rolagem no Android.
 * - A ativação é MANUAL: só com a página no topo e o dedo descendo; subindo, ou com a página
 *   rolada, o gesto falha e a rolagem segue sozinha.
 * - A volta do cartão mora no `onFinalize`, que roda também quando o gesto é cancelado.
 *
 * Mora num componente próprio porque recebe a `ref` da página como prop (é assim que o
 * `Reorderable` faz): lida no render da tela, o compilador do React a recusa.
 */
function ArrasteParaFechar({
  pagina,
  topoDaPagina,
  arrasto,
  onFechar,
  children,
}: {
  pagina: AnimatedRef<Animated.ScrollView>;
  topoDaPagina: SharedValue<number>;
  arrasto: SharedValue<number>;
  onFechar: (dy: number) => void;
  children: React.ReactNode;
}) {
  const inicio = useSharedValue({ x: 0, y: 0 });
  const fechando = useSharedValue(false);

  const gesto = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .simultaneousWithExternalGesture(pagina as unknown as React.RefObject<React.ComponentType>)
        .onTouchesDown((e) => {
          const t = e.allTouches[0];
          if (t) inicio.set({ x: t.absoluteX, y: t.absoluteY });
        })
        .onTouchesMove((e, estado) => {
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.absoluteX - inicio.get().x;
          const dy = t.absoluteY - inicio.get().y;
          if (Math.abs(dx) > 12 || dy < -8) estado.fail();
          else if (dy > 14) {
            if (topoDaPagina.get() <= 1) estado.activate();
            else estado.fail();
          }
        })
        .onUpdate((e) => {
          arrasto.set(Math.max(0, e.translationY));
        })
        .onEnd((e) => {
          if (e.translationY > LIMIAR_DE_FECHAR || e.velocityY > VELOCIDADE_DE_FECHAR) {
            fechando.set(true);
            runOnJS(onFechar)(Math.max(0, e.translationY));
          }
        })
        .onFinalize(() => {
          if (!fechando.get()) arrasto.set(withSpring(0, Motion.spring.encaixe));
        }),
    [pagina, inicio, topoDaPagina, arrasto, fechando, onFechar]
  );

  return (
    <GestureDetector gesture={gesto}>
      <View>{children}</View>
    </GestureDetector>
  );
}

/** O estado embaixo do nome, numa palavra — as datas estão nos números logo abaixo. */
function linhaDeEstado(card: CardSummary): { texto: string; cor: ThemeColor } {
  const estado = estadoDaFatura(card);
  if (!estado) return { texto: 'Sem fatura aberta', cor: 'textSecondary' };
  return { texto: `Fatura ${estado.toLowerCase()}`, cor: estado === 'Atrasada' ? 'danger' : 'textSecondary' };
}

/**
 * O nome do cartão, com paralaxe: cada título anda um pouco com o deslize e esmaece com a
 * distância. O do cartão da frente fica no FLUXO (é ele que dá a altura, e ele quebra linha se
 * precisar — identificador não trunca); os outros ficam sobrepostos.
 */
function Titulo({
  card,
  indice,
  x,
  passo,
  emFluxo,
}: {
  card: CardSummary;
  indice: number;
  x: SharedValue<number>;
  passo: number;
  emFluxo: boolean;
}) {
  const estilo = useAnimatedStyle(() => {
    const d = distanciaDoItem(x.get(), passo, indice);
    return {
      opacity: 1 - Math.min(1, Math.abs(d)),
      transform: [{ translateX: -d * 64 }],
    };
  });
  const estado = linhaDeEstado(card);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden={!emFluxo}
      importantForAccessibility={emFluxo ? 'auto' : 'no-hide-descendants'}
      style={[styles.titulo, emFluxo ? null : styles.sobreposto, estilo]}>
      <ThemedText type="title" style={styles.centro}>
        {card.name}
      </ThemedText>
      <ThemedText type="footnote" themeColor={estado.cor} style={[styles.centro, tabular]}>
        {estado.texto}
      </ThemedText>
    </Animated.View>
  );
}

/** Um ponto por cartão; o da frente estica numa barra. Só `scaleX` e opacidade (§5). */
function Pontos({ total, x, passo }: { total: number; x: SharedValue<number>; passo: number }) {
  return (
    <View style={styles.pontos} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <Ponto key={i} indice={i} x={x} passo={passo} />
      ))}
    </View>
  );
}

const PONTO = 6;
const BARRA = 20;

function Ponto({ indice, x, passo }: { indice: number; x: SharedValue<number>; passo: number }) {
  const theme = useTheme();
  const estilo = useAnimatedStyle(() => {
    const perto = 1 - Math.min(1, Math.abs(distanciaDoItem(x.get(), passo, indice)));
    return {
      opacity: 0.25 + 0.75 * perto,
      transform: [{ scaleX: 1 + perto * (BARRA / PONTO - 1) }],
    };
  });
  return <Animated.View style={[styles.ponto, { backgroundColor: theme.tintFill }, estilo]} />;
}

/** Os números do cartão da frente. */
function Detalhes({ card }: { card: CardSummary }) {
  const brl = useBRL();
  const limite = Number(card.credit_limit_cents ?? 0);
  const naoPago = Number(card.unpaid_total_cents ?? 0);
  const livre = Number(card.available_limit_cents ?? 0);
  const pct = limite > 0 ? naoPago / limite : 0;
  const atrasadas = Number(card.overdue_count ?? 0);

  return (
    <View style={styles.detalhes}>
      <Card style={styles.numeros}>
        <ThemedText type="footnote" themeColor="textSecondary">
          Fatura atual
        </ThemedText>
        <CountUpMoney cents={Number(card.invoice_total_cents ?? 0)} variant="money" tone="text" />
        <ThemedText type="footnote" themeColor="textSecondary" style={tabular}>
          {card.invoice_id && card.closing_date && card.due_date
            ? `${prazoLabel(card.closing_date, 'fecha')} · vence ${formatDateBR(card.due_date)}`
            : 'Nenhuma compra neste ciclo'}
        </ThemedText>
        {limite > 0 ? (
          <>
            <ProgressBar value={naoPago} max={limite} tone={pct >= 0.9 ? 'danger' : 'tint'} />
            <ThemedText
              type="footnote"
              themeColor={livre < 0 ? 'danger' : 'textSecondary'}
              style={tabular}>
              {livre < 0
                ? `${brl(-livre)} acima do limite de ${brl(limite)}`
                : `${brl(livre)} livre de ${brl(limite)}`}
            </ThemedText>
          </>
        ) : null}
      </Card>
      {atrasadas > 0 && card.oldest_overdue_invoice_id ? (
        <Section>
          <Row
            icon="exclamationmark.triangle.fill"
            destructive
            title={atrasadas === 1 ? 'Fatura atrasada' : `${atrasadas} faturas atrasadas`}
            subtitle={brl(Number(card.overdue_total_cents ?? 0))}
            onPress={() =>
              router.push({
                pathname: '/finance/invoice/[id]',
                params: { id: card.oldest_overdue_invoice_id! },
              })
            }
          />
        </Section>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  aviso: { padding: Space.lg },
  esqueleto: { alignItems: 'center', paddingTop: Space.xxl },
  conteudo: { flexGrow: 1, gap: Space.md, paddingTop: Space.sm },
  titulos: { paddingHorizontal: Space.lg },
  titulo: { gap: Space.half, alignItems: 'center' },
  sobreposto: { position: 'absolute', top: 0, left: Space.lg, right: Space.lg },
  centro: { textAlign: 'center', flexShrink: 0, maxWidth: '100%' },
  miolo: { gap: Space.lg, paddingHorizontal: Space.lg },
  pontos: { flexDirection: 'row', justifyContent: 'center', gap: Space.md + Space.half },
  ponto: { width: PONTO, height: PONTO, borderRadius: Radius.pill },
  detalhes: { gap: Space.md },
  numeros: { gap: Space.sm },
  // O fim do conteúdo, encostado na base quando sobra tela (§1 do design: ação não fica ancorada).
  acoes: { marginTop: 'auto', flexShrink: 0, gap: Space.md, paddingHorizontal: Space.lg, paddingTop: Space.lg },
});
