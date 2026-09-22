'use no memo';
// O React Compiler NÃO pode tocar aqui: widget é função crua renderizada fora da árvore do
// app (Android: RemoteViews; iOS: runtime isolado). Compilado, o componente vira hook e quebra
// com "Invalid Hook Call" — medido no emulador em 22/09/2026.

import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { PropsDoWidget } from '@/widgets/props';

/**
 * "O que vence" — as próximas contas, atrasadas primeiro, com o total embaixo do título.
 * Médio: 3 linhas. Grande: 6. Tocar abre o ciclo, que é onde a lista inteira mora.
 *
 * ⚠️ Runtime isolado (`'widget'`): ver `livre.tsx`.
 */
// A diretiva 'widget' vira STRING no Babel (`babel-preset-expo`, plugin do expo-widgets), e o preset só
// liga o plugin se o pacote existia quando o Metro subiu: Metro antigo = createWidget recebe a função
// e quebra com "2nd argument cannot be cast to String". Depois de instalar, `expo start --clear`.
function Vence(p: PropsDoWidget, env: WidgetEnvironment) {
  'widget';
  // O "+N no ciclo" ocupa a linha de uma conta: no médio, 3 contas + ele transbordavam e cortavam
  // o cabeçalho e o rodapé (vistoria no simulador, 22/09/2026). Com resto, cabe uma conta a menos.
  const cabem = env.widgetFamily === 'systemLarge' ? 7 : 3;
  const total = p.contas.length + p.maisContas;
  const contas = p.contas.slice(0, total > cabem ? cabem - 1 : cabem);
  const resto = total - contas.length;

  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[containerBackground(p.cor.fundo, 'widget')]}>
      <HStack>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(p.cor.texto)]}>O que vence</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13, weight: 'medium' }), monospacedDigit(), foregroundStyle(p.cor.apagado)]}>
          {p.totalContas}
        </Text>
      </HStack>
      {p.estado !== 'ok' ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(p.cor.apagado)]}>{p.veredito.texto}</Text>
      ) : contas.length === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(p.cor.apagado)]}>Nada vencendo nos próximos 30 dias.</Text>
      ) : (
        contas.map((c, i) => (
          <HStack key={i} spacing={8}>
            <VStack alignment="leading" spacing={0}>
              <Text modifiers={[font({ size: 14, weight: 'medium' }), lineLimit(1), foregroundStyle(p.cor.texto)]}>
                {c.titulo}
              </Text>
              <Text modifiers={[font({ size: 11 }), foregroundStyle(c.atrasada ? p.cor.perigo : p.cor.apagado)]}>
                {c.quando}
              </Text>
            </VStack>
            <Spacer />
            <Text modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit(), foregroundStyle(c.atrasada ? p.cor.perigo : p.cor.texto)]}>
              {c.valor}
            </Text>
          </HStack>
        ))
      )}
      <Spacer minLength={0} />
      {resto > 0 ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(p.cor.apagado)]}>{`+${resto} no ciclo`}</Text>
      ) : null}
    </VStack>
  );
}

export default createWidget('Vence', Vence);
