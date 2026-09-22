'use no memo';
// O React Compiler NÃO pode tocar aqui: widget é função crua renderizada fora da árvore do
// app (Android: RemoteViews; iOS: runtime isolado). Compilado, o componente vira hook e quebra
// com "Invalid Hook Call" — medido no emulador em 22/09/2026.

import { HStack, Rectangle, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { PropsDoWidget } from '@/widgets/props';

/**
 * "Livre" — o herói da Hoje na tela de início e na de bloqueio.
 *
 * ⚠️ Roda num runtime ISOLADO (`'widget'`): nada de hook, de constante de módulo nem de conta. Tudo
 * chega pronto nas props (`lib/widget-snapshot.ts` + `widgets/props.ts`), inclusive as cores.
 *
 * Pequeno: o número e a frase do dia. Médio: + compromissos e a próxima conta. Bloqueio: uma linha
 * (inline) ou três (retangular), sem cor própria — lá o sistema pinta (`vibrant`).
 */
// A diretiva 'widget' vira STRING no Babel (`babel-preset-expo`, plugin do expo-widgets), e o preset só
// liga o plugin se o pacote existia quando o Metro subiu: Metro antigo = createWidget recebe a função
// e quebra com "2nd argument cannot be cast to String". Depois de instalar, `expo start --clear`.
function Livre(p: PropsDoWidget, env: WidgetEnvironment) {
  'widget';
  const semSessao = p.estado !== 'ok';

  if (env.widgetFamily === 'accessoryInline') {
    return <Text>{semSessao ? 'ProOps' : `Livre ${p.livre}`}</Text>;
  }
  if (env.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[font({ textStyle: 'caption' })]}>{p.rotulo}</Text>
        <Text modifiers={[font({ textStyle: 'headline', weight: 'semibold' }), monospacedDigit(), minimumScaleFactor(0.6), lineLimit(1)]}>
          {semSessao ? 'Entre no app' : p.livre}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2' }), lineLimit(1)]}>{p.veredito.texto}</Text>
      </VStack>
    );
  }

  const heroi = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(p.cor.apagado)]}>{p.rotulo}</Text>
      <Spacer minLength={4} />
      <Text
        modifiers={[
          font({ size: 32, weight: 'semibold' }),
          monospacedDigit(),
          minimumScaleFactor(0.5),
          lineLimit(1),
          foregroundStyle(p.livreNegativo ? p.cor.perigo : p.cor.texto),
        ]}>
        {semSessao ? 'ProOps' : p.livre}
      </Text>
      <Text
        modifiers={[
          font({ size: 12, weight: 'medium' }),
          lineLimit(2),
          foregroundStyle(p.veredito.tom === 'perigo' ? p.cor.perigo : p.cor.apagado),
        ]}>
        {p.veredito.texto}
      </Text>
      <Spacer minLength={4} />
      {semSessao ? null : (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(p.cor.apagado)]}>{`atualizado às ${p.atualizado}`}</Text>
      )}
    </VStack>
  );

  const fundo = [containerBackground(p.cor.fundo, 'widget')];

  // Médio: o herói + DOIS números à direita, não uma lista (a lista é o "O que vence"). O que
  // pesa até a próxima entrada e a próxima conta — o suficiente para decidir sem abrir o app.
  const proxima = p.proximas[0];
  if (env.widgetFamily === 'systemMedium' && !semSessao && (p.compromissos || proxima)) {
    return (
      <HStack spacing={14} modifiers={fundo}>
        {heroi}
        <Spacer minLength={0} />
        <Rectangle modifiers={[frame({ width: 1 }), foregroundStyle(p.cor.faixa)]} />
        <VStack alignment="leading" spacing={12} modifiers={[frame({ width: 140, alignment: 'leading' })]}>
          {p.compromissos ? (
            <VStack alignment="leading" spacing={1}>
              <Text modifiers={[font({ size: 11 }), lineLimit(1), foregroundStyle(p.cor.apagado)]}>
                {`Compromissos ${p.compromissos.ate}`}
              </Text>
              <Text modifiers={[font({ size: 17, weight: 'semibold' }), monospacedDigit(), minimumScaleFactor(0.7), lineLimit(1), foregroundStyle(p.cor.texto)]}>
                {p.compromissos.valor}
              </Text>
            </VStack>
          ) : null}
          {proxima ? (
            <VStack alignment="leading" spacing={1}>
              <Text modifiers={[font({ size: 11 }), foregroundStyle(p.cor.apagado)]}>
                {proxima.hoje ? 'Vence hoje' : `Próxima · ${proxima.dia} ${proxima.mes}`}
              </Text>
              <Text modifiers={[font({ size: 14, weight: 'medium' }), lineLimit(2), foregroundStyle(p.cor.texto)]}>
                {proxima.titulo}
              </Text>
              <Text modifiers={[font({ size: 12, weight: 'semibold' }), monospacedDigit(), foregroundStyle(proxima.hoje ? p.cor.perigo : p.cor.apagado)]}>
                {proxima.valor}
              </Text>
            </VStack>
          ) : null}
        </VStack>
      </HStack>
    );
  }

  return (
    <HStack modifiers={fundo}>
      {heroi}
      <Spacer />
    </HStack>
  );
}

export default createWidget('Livre', Livre);
