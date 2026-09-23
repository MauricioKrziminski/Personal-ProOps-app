'use no memo';
// O React Compiler NÃO pode tocar aqui: widget é função crua renderizada fora da árvore do
// app (Android: RemoteViews; iOS: runtime isolado). Compilado, o componente vira hook e quebra
// com "Invalid Hook Call" — medido no emulador em 22/09/2026.

import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  containerBackground,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { PropsDoWidget } from '@/widgets/props';

/**
 * "O que vence" — o total, o atrasado como UMA faixa e as próximas contas com um selo de data.
 *
 * Desenho de 22/09/2026 (retrato v2): a versão anterior listava cada atrasada numa linha vermelha
 * com "venceu dd/mm" embaixo, e o widget virava uma parede de texto vermelho. Agora o olho acha
 * três coisas, nesta ordem: quanto sai, quanto já está atrasado, o que vem a seguir.
 *
 * Médio: o total na linha do título + faixa + 2 contas. Grande: o total em destaque + faixa +
 * até 6 contas + "+N". ⚠️ Runtime isolado (`'widget'`): ver `livre.tsx`.
 */
// A diretiva 'widget' vira STRING no Babel (`babel-preset-expo`, plugin do expo-widgets), e o preset só
// liga o plugin se o pacote existia quando o Metro subiu: Metro antigo = createWidget recebe a função
// e quebra com "2nd argument cannot be cast to String". Depois de instalar, `expo start --clear`.
function Vence(p: PropsDoWidget, env: WidgetEnvironment) {
  'widget';
  // Sem retrato AINDA (widget adicionado antes de o app publicar, ou a galeria pedindo a prévia):
  // o expo-widgets chama com props VAZIAS. Ler `p.cor` aqui quebrava o layout, e o erro saía sem
  // fundo — o iPhone mostrava "Please adopt containerBackground API" (22/09/2026). Cores por NOME
  // porque não há paleta sem retrato (e hex fora do tema é barrado).
  if (!p || !p.cor) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[containerBackground('black', 'widget')]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle('white')]}>ProOps</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle('gray')]}>Abra o app para ver o seu dia</Text>
      </VStack>
    );
  }
  const grande = env.widgetFamily === 'systemLarge';
  const fundo = [containerBackground(p.cor.fundo, 'widget')];

  if (p.estado !== 'ok') {
    return (
      <VStack alignment="leading" spacing={6} modifiers={fundo}>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(p.cor.texto)]}>O que vence</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13 }), foregroundStyle(p.cor.apagado)]}>{p.veredito.texto}</Text>
      </VStack>
    );
  }

  // As linhas que CABEM (medido no simulador): a faixa do atrasado ocupa o lugar de uma conta.
  const cabem = (grande ? 6 : 3) - (p.atrasado ? 1 : 0);
  const lista = p.proximas.slice(0, cabem);
  const resto = p.proximas.length + p.maisProximas - lista.length;

  return (
    <VStack alignment="leading" spacing={grande ? 12 : 7} modifiers={fundo}>
      {grande ? (
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(p.cor.apagado)]}>O que vence</Text>
          <Text
            modifiers={[
              font({ size: 30, weight: 'semibold' }),
              monospacedDigit(),
              minimumScaleFactor(0.6),
              lineLimit(1),
              foregroundStyle(p.cor.texto),
            ]}>
            {p.totalContas}
          </Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(p.cor.apagado)]}>
            {`${p.qtdContas} ${p.qtdContas === 1 ? 'conta' : 'contas'} nos próximos 30 dias`}
          </Text>
        </VStack>
      ) : (
        <HStack>
          <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(p.cor.apagado)]}>O que vence</Text>
          <Spacer minLength={8} />
          <Text modifiers={[font({ size: 15, weight: 'semibold' }), monospacedDigit(), fixedSize({ horizontal: true }), foregroundStyle(p.cor.texto)]}>
            {p.totalContas}
          </Text>
        </HStack>
      )}

      {p.atrasado ? (
        <HStack
          spacing={6}
          modifiers={[padding({ horizontal: 10, vertical: 4 }), background(p.cor.faixa, shapes.capsule())]}>
          <Image systemName="exclamationmark.circle.fill" size={12} color={p.cor.perigo} />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), lineLimit(1), foregroundStyle(p.cor.perigo)]}>
            {`${p.atrasado.qtd} ${p.atrasado.qtd === 1 ? 'atrasada' : 'atrasadas'}`}
          </Text>
          <Spacer minLength={6} />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), monospacedDigit(), fixedSize({ horizontal: true }), foregroundStyle(p.cor.perigo)]}>
            {p.atrasado.valor}
          </Text>
        </HStack>
      ) : null}

      {lista.length === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(p.cor.apagado)]}>Nada mais vence nos próximos 30 dias.</Text>
      ) : (
        <VStack alignment="leading" spacing={grande ? 10 : 6} modifiers={[fixedSize({ horizontal: false, vertical: true })]}>
          {lista.map((c, i) => (
            <HStack key={i} spacing={10}>
              {/* O selo de data: o dia é o que se procura numa lista de contas. Hoje inverte. */}
              <VStack
                spacing={-2}
                modifiers={[
                  frame({ width: 30, height: 30 }),
                  background(c.hoje ? p.cor.texto : p.cor.faixa, shapes.roundedRectangle({ cornerRadius: 8, roundedCornerStyle: 'continuous' })),
                ]}>
                <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), foregroundStyle(c.hoje ? p.cor.fundo : p.cor.texto)]}>
                  {c.dia}
                </Text>
                <Text modifiers={[font({ size: 9, weight: 'medium' }), foregroundStyle(c.hoje ? p.cor.fundo : p.cor.apagado)]}>
                  {c.mes}
                </Text>
              </VStack>
              {/* O nome QUEBRA em até 2 linhas em vez de cortar ("Parcela Financiamento…" na vistoria).
                  `minimumScaleFactor` foi medido e devolvido: no WidgetKit ele encolhia TODOS os nomes. */}
              <Text modifiers={[font({ size: 14, weight: 'medium' }), lineLimit(2), fixedSize({ horizontal: false, vertical: true }), frame({ maxWidth: Infinity, alignment: 'leading' }), foregroundStyle(p.cor.texto)]}>
                {c.titulo}
              </Text>
              <Text modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit(), fixedSize({ horizontal: true }), foregroundStyle(p.cor.texto)]}>
                {c.valor}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}

      <Spacer minLength={0} />
      {grande && resto > 0 ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(p.cor.apagado)]}>{`+${resto} a vencer`}</Text>
      ) : null}
    </VStack>
  );
}

export default createWidget('Vence', Vence);
