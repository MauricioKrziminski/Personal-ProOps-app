import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Row, Section } from '@/components/ui/row';
import { Sheet } from '@/components/ui/sheet';
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
 * A partir de quantos candidatos a lista sai do balão e vira sheet.
 *
 * Dois cabem como botões e são a resposta inteira à vista. Três já empilham
 * seis linhas de texto dentro da conversa; nove viram uma parede que empurra a
 * própria pergunta para fora da tela.
 */
const CABE_NO_BALAO = 2;

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
 * accent. Trocar as pílulas por linhas de lista deixou mais limpo e **não
 * resolveu**: nove linhas continuam sendo nove linhas dentro de uma conversa.
 * A queixa veio duas vezes, e a segunda trouxe o desenho: *"tem que ter um
 * botão para abrir um menu com a lista, igual no WhatsApp"*.
 *
 * É o mesmo mecanismo que o WhatsApp usa (`ui: "list"`, botão "Escolher") e a
 * mesma régua do §8 do design — **escolha curta é `formSheet`**. A conversa
 * fica com a pergunta e UM botão; as opções aparecem quando a pessoa vai
 * escolher, e somem quando ela escolhe.
 *
 * - **Confirmar / recusar** (até dois) é AÇÃO: pílula preenchida para o que o
 *   agente propôs, contorno para a saída. Continua no balão.
 * - **"Qual deles?"** (três ou mais) é ESCOLHER ITEM DE LISTA: botão no balão,
 *   lista no sheet. Nenhuma opção é "a proposta" — pintar a primeira de accent
 *   dizia que o agente recomendava a fatura mais antiga, que é exatamente o que
 *   o `limit 1` fazia em silêncio antes de virar pergunta.
 */
export const ChatActions = memo(function ChatActions({ payload, busy, onDecide }: Props) {
  const { options } = parseUiActions(payload);
  const [aberto, setAberto] = useState(false);

  const inerte = hitlControlsDisabled(payload, { busy });
  const encerrada = payload.resolved;

  if (options.length === 0) return null;

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

  if (candidatos.length > CABE_NO_BALAO) {
    const escolher = (o: UiOption) => {
      setAberto(false);
      onDecide(o);
    };

    return (
      <View style={styles.bloco}>
        {/* A contagem entra no RÓTULO: "Escolher" sozinho não diz que há nove. */}
        <Button
          label={`Escolher (${candidatos.length})`}
          block
          disabled={inerte}
          onPress={() => setAberto(true)}
        />

        <Sheet visible={aberto} onClose={() => setAberto(false)}>
          <View style={styles.cabecalho}>
            <Button label="Cancelar" variant="ghost" size="sm" onPress={() => setAberto(false)} />
            <ThemedText type="smallBold">Escolher</ThemedText>
            {/* Contrapeso do "Cancelar": sem ele o título não fica centrado. */}
            <View style={styles.contrapeso} />
          </View>

          <View style={styles.corpo}>
            <Section>
              {candidatos.map((o) => (
                <Row
                  key={o.id}
                  title={o.label.replace(numeroNaFrente, '')}
                  subtitle={o.description}
                  chevron={false}
                  onPress={() => escolher(o)}
                />
              ))}
            </Section>

            {saidas.map((o) => (
              <Button
                key={o.id}
                label={o.label}
                variant="ghost"
                block
                onPress={() => escolher(o)}
              />
            ))}
          </View>
        </Sheet>
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
  cabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  contrapeso: { width: 72 },
  corpo: { paddingHorizontal: Space.lg, paddingTop: Space.md, gap: Space.md },
});
