'use no memo';
// O React Compiler NÃO pode tocar aqui: widget é função crua renderizada fora da árvore do
// app (Android: RemoteViews; iOS: runtime isolado). Compilado, o componente vira hook e quebra
// com "Invalid Hook Call" — medido no emulador em 22/09/2026.

import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  fixedSize,
  font,
  foregroundStyle,
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
 * Pequeno: o número e a frase do dia. Médio: + as três próximas contas. Bloqueio: uma linha
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

  if (env.widgetFamily === 'systemMedium' && !semSessao && p.contas.length > 0) {
    return (
      <HStack spacing={16} modifiers={fundo}>
        {heroi}
        <Spacer />
        <VStack alignment="leading" spacing={8}>
          {p.contas.slice(0, 3).map((c, i) => (
            <VStack key={i} alignment="leading" spacing={0}>
              <Text modifiers={[font({ size: 13, weight: 'medium' }), lineLimit(1), minimumScaleFactor(0.8), foregroundStyle(p.cor.texto)]}>
                {c.titulo}
              </Text>
              {/* Nem o valor nem o "quando" truncam (`fixedSize`): na vistoria de 22/09/2026 saíam
                  "R$ 1.35…" e depois "venceu 1…". Quem cede é o herói, que tem minimumScaleFactor. */}
              <HStack spacing={4}>
                <Text modifiers={[font({ size: 11 }), lineLimit(1), fixedSize({ horizontal: true }), foregroundStyle(c.atrasada ? p.cor.perigo : p.cor.apagado)]}>
                  {c.quando}
                </Text>
                <Spacer minLength={2} />
                <Text modifiers={[font({ size: 11, weight: 'semibold' }), monospacedDigit(), fixedSize({ horizontal: true }), foregroundStyle(c.atrasada ? p.cor.perigo : p.cor.texto)]}>
                  {c.valor}
                </Text>
              </HStack>
            </VStack>
          ))}
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
