import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Row, Section } from '@/components/ui/row';
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
 * O "1) " que abre cada rótulo é de OUTRO canal.
 *
 * Ele existe para a pessoa poder digitar o número no WhatsApp, onde a lista
 * nativa esconde as opções. Aqui elas são linhas tocáveis, e o número na frente
 * de cada uma é ruído que ainda por cima empurra o texto que distingue as
 * opções para a segunda linha.
 */
const numeroNaFrente = /^\d+\)\s*/;

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
 *
 * ## Escolher entre MUITOS não é a mesma coisa que confirmar
 *
 * ⚠️ Tudo virava `Button block`, e com nove faturas abertas a tela era uma
 * parede de nove pílulas de duas linhas cada, a primeira delas pintada de
 * accent — a queixa foi literal: *"que poluição visual é essa do agente?"*.
 *
 * São duas perguntas diferentes e elas pedem dois controles:
 *
 * - **Confirmar / recusar** (até duas opções) é AÇÃO: pílula preenchida para o
 *   que o agente propôs, contorno para a saída. Continua `Button`.
 * - **"Qual deles?"** (três ou mais) é ESCOLHER ITEM DE UMA LISTA, o mesmo
 *   gesto do `SelectField` e do `AccountPicker` — e por isso usa o mesmo
 *   vocabulário: linhas numa `Section`, título em cima, o que distingue embaixo.
 *   Nenhuma delas é "a proposta": pintar a primeira de accent dizia que o
 *   agente recomendava a fatura mais antiga, que é exatamente o que o `limit 1`
 *   fazia em silêncio antes de virar pergunta.
 *
 * A saída ("Nenhuma dessas") sai da lista e vira botão fantasma embaixo: ela
 * não é um item, é desistir de escolher.
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

  const candidatos = options.filter((o) => o.decision === 'choose');
  const saidas = options.filter((o) => o.decision !== 'choose');

  if (candidatos.length >= 3) {
    return (
      <View style={styles.lista}>
        <Section>
          {candidatos.map((o) => (
            <Row
              key={o.id}
              title={o.label.replace(numeroNaFrente, '')}
              subtitle={o.description}
              chevron={false}
              accessibilityState={{ disabled: inerte }}
              /* `Row` não tem `disabled`: sem `onPress` ela deixa de ser tocável
                 e para de acender o realce — que é o que "inerte" quer dizer. */
              onPress={inerte ? undefined : () => onDecide(o)}
            />
          ))}
        </Section>
        {saidas.map((o) => (
          <Button
            key={o.id}
            label={o.label}
            variant="ghost"
            block
            disabled={inerte}
            onPress={() => onDecide(o)}
          />
        ))}
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
  /* A lista é conteúdo, não um balão: ela usa a largura toda, como as do app. */
  lista: { gap: Space.sm, paddingTop: Space.sm },
});
