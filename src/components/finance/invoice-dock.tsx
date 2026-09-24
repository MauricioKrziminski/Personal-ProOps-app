import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CardFace, tintasDoCartao } from '@/components/finance/card-face';
import { useFlightAnchor, useFlightHidden } from '@/components/motion/flight-layer';
import { ThemedText } from '@/components/themed-text';
import { CountUpMoney } from '@/components/ui/count-up-money';
import { Motion, Space, tabular } from '@/design/tokens';
import { usarDica } from '@/hooks/use-dicas';
import { invoiceQuery, type CardInvoice, type Transaction } from '@/hooks/use-finance';
import { formatDateBR, localISODate } from '@/hooks/use-items';
import { STATUS_DA_FATURA, contagemDeLancamentos } from '@/lib/card-status';

export type ResumoDaFatura = {
  status: string;
  /** Venceu e não foi paga nem adiada — a mesma régua da tela da fatura. */
  atrasada: boolean;
  contagem: number;
  totalCents: number;
  fecha: string;
  vence: string;
};

/** O que a doca mostra de uma fatura — a mesma conta da tela, para o clone do voo usar também. */
export function resumoDaFatura(data: { invoice: CardInvoice; transactions: Transaction[] }): ResumoDaFatura {
  return {
    status: STATUS_DA_FATURA[data.invoice.status] ?? data.invoice.status,
    atrasada:
      data.invoice.due_date < localISODate() && !['paid', 'rolled'].includes(data.invoice.status),
    contagem: data.transactions.length,
    totalCents: data.transactions
      .filter((t) => t.kind === 'expense')
      .reduce((soma, t) => soma + t.amount_cents, 0),
    fecha: data.invoice.closing_date,
    vence: data.invoice.due_date,
  };
}

/** A base do cartão ancorado: estado · contagem, o total e as duas datas. */
export function BaseDaDoca({ nome, resumo }: { nome: string; resumo: ResumoDaFatura }) {
  const t = tintasDoCartao(nome);
  return (
    <View style={styles.base}>
      <ThemedText type="meta" themeColor={t.suave} style={tabular}>
        {resumo.status} · {contagemDeLancamentos(resumo.contagem)}
      </ThemedText>
      <CountUpMoney cents={resumo.totalCents} variant="money" tone={t.tinta} />
      <ThemedText type="meta" themeColor={t.suave} style={tabular}>
        fecha {formatDateBR(resumo.fecha)} · vence {formatDateBR(resumo.vence)}
      </ThemedText>
    </View>
  );
}

/** Quanto arrastar (ou com que velocidade) para trocar de fatura. */
const LIMIAR = 60;
const LIMIAR_DE_VELOCIDADE = 700;

/**
 * O cartão ANCORADO no topo da fatura — o "Confirm order" do vídeo de referência.
 *
 * Ele é o destaque da tela (§1 do design: um por tela) e carrega o que o card de total
 * carregava: estado, contagem, total, fecha · vence; o nome do cartão está na própria face. As
 * linhas que explicam o total ("Inclui X com data à frente", "Paga em", "Pago X · falta Y")
 * ficam logo abaixo dele (`children`).
 *
 * Deslizar a face troca de fatura pelo MESMO caminho das setas do `InvoicePager` (`onChange`),
 * que continua ali para quem não descobre o gesto. A face vira no eixo Y na direção da troca, e
 * o total conta até o valor novo.
 *
 * É a âncora `doca` do voo: vindo da Carteira, o cartão pousa aqui.
 */
export function InvoiceDock({
  nome,
  resumo,
  faturas,
  atualId,
  onChange,
  children,
}: {
  nome: string;
  resumo: ResumoDaFatura;
  /** As faturas do cartão, da mais nova para a mais antiga (a ordem de `useCardInvoices`). */
  faturas: { id: string }[];
  atualId: string;
  onChange: (invoiceId: string) => void;
  children?: React.ReactNode;
}) {
  const [largura, setLargura] = useState(0);
  const reduzir = useReducedMotion();
  const { prender, aoPosicionar } = useFlightAnchor('doca');
  const oculto = useFlightHidden('doca');
  const dx = useSharedValue(0);
  const virada = useSharedValue(0);

  const indice = faturas.findIndex((f) => f.id === atualId);
  const anterior = indice >= 0 ? faturas[indice + 1]?.id : undefined;
  const proxima = indice > 0 ? faturas[indice - 1]?.id : undefined;

  // As vizinhas já carregadas: deslizar troca o cartão na hora, em vez de passar por esqueleto.
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const vizinha of [anterior, proxima]) {
      if (vizinha) queryClient.prefetchQuery(invoiceQuery(vizinha));
    }
  }, [anterior, proxima, queryClient]);

  // A virada acontece quando a fatura MUDA — pelo deslize ou pelas setas —, na direção da troca.
  const ultima = useRef({ id: atualId, indice });
  useEffect(() => {
    const antes = ultima.current;
    ultima.current = { id: atualId, indice };
    if (antes.id === atualId || reduzir) return;
    // A lista vem da mais nova para a mais antiga: índice menor é uma fatura mais nova.
    const lado = indice < antes.indice ? 1 : -1;
    virada.set(
      withSequence(
        withTiming(lado * 70, { duration: 0 }),
        withSpring(0, Motion.spring.encaixe)
      )
    );
  }, [atualId, indice, reduzir, virada]);

  const trocar = (destino: string) => {
    Haptics.selectionAsync();
    // Deslizar o cartão é o que a dica da fatura ensina (`fatura-cartao`).
    usarDica('fatura-cartao');
    onChange(destino);
  };

  const deslize = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      // Sem fatura naquele lado, o cartão resiste: anda um terço e volta.
      const temLado = e.translationX < 0 ? Boolean(proxima) : Boolean(anterior);
      dx.set(e.translationX * (temLado ? 0.5 : 0.18));
    })
    .onEnd((e) => {
      dx.set(withSpring(0, Motion.spring.encaixe));
      const praEsquerda = e.translationX < -LIMIAR || e.velocityX < -LIMIAR_DE_VELOCIDADE;
      const praDireita = e.translationX > LIMIAR || e.velocityX > LIMIAR_DE_VELOCIDADE;
      if (praEsquerda && proxima) runOnJS(trocar)(proxima);
      else if (praDireita && anterior) runOnJS(trocar)(anterior);
    });

  const medir = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setLargura((previous) => previous === measured ? previous : measured);
  };
  const movimento = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateX: dx.get() },
      { rotateY: `${(reduzir ? 0 : -dx.get() / Math.max(1, largura)) * 25 + virada.get()}deg` },
    ],
  }));

  return (
    <View style={styles.bloco} onLayout={medir}>
      {largura > 0 ? (
        <GestureDetector gesture={deslize}>
          <Animated.View style={movimento}>
            <Animated.View ref={prender} onLayout={aoPosicionar} style={oculto}>
              <CardFace nome={nome} largura={largura} atrasada={resumo.atrasada}>
                <BaseDaDoca nome={nome} resumo={resumo} />
              </CardFace>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { gap: Space.md },
  base: { gap: Space.half },
});
