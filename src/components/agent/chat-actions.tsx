import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Space } from '@/design/tokens';
import type { AgentUiPayload } from '@/lib/agent-api';
import { hitlControlsDisabled, parseUiActions, type UiOption } from '@/lib/agent-chat';

interface Props {
  payload: AgentUiPayload;
  /** Outro turno está rodando: tocar agora voltaria 409. */
  busy?: boolean;
  onDecide: (option: UiOption) => void;
}

/** O que dizer quando a pergunta já não aceita resposta. */
const ENCERRADA: Record<string, string> = {
  approve: 'Confirmado',
  reject: 'Cancelado',
  choose: 'Respondido',
  expired: 'Expirada',
};

/**
 * Os botões de uma pergunta do agente (HITL).
 *
 * O resumo NÃO é redesenhado aqui — ele é o texto do próprio balão. O que este
 * componente acrescenta são as opções, e elas saem inteiras do payload que o
 * servidor gravou: nenhum id é montado na tela, e o servidor ainda revalida o
 * candidato contra a lista congelada da pergunta. Duas cercas, porque o toque
 * que chega aqui decide se um lançamento é apagado.
 *
 * Respondida ou expirada, os botões SOMEM e sobra uma etiqueta. Deixá-los
 * visíveis e cinzas convida ao toque que já sabemos que vai falhar; o resumo
 * fica, porque quem reabre a conversa amanhã precisa ver o que foi perguntado.
 */
export const ChatActions = memo(function ChatActions({ payload, busy, onDecide }: Props) {
  const { options } = parseUiActions(payload);
  if (options.length === 0) return null;

  const inerte = hitlControlsDisabled(payload, { busy });
  const encerrada = payload.resolved;

  if (encerrada) {
    return (
      <View style={styles.bloco}>
        <ThemedText type="meta" themeColor="textSecondary">
          {ENCERRADA[encerrada] ?? 'Respondido'}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.bloco}>
      {options.map((o, i) => (
        <Button
          key={o.id}
          // A descrição da linha (a data do lançamento, por exemplo) entra no
          // rótulo: sem ela duas opções "Mercado R$ 45" ficam indistinguíveis, e
          // o botão do design system não tem segunda linha.
          label={o.description ? `${o.label} · ${o.description}` : o.label}
          // A primeira opção é a que o agente propôs; as outras são saídas.
          variant={i === 0 ? 'primary' : 'secondary'}
          block
          disabled={inerte}
          onPress={() => onDecide(o)}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bloco: { gap: Space.sm, paddingTop: Space.sm, maxWidth: '86%' },
});
