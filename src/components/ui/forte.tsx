import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Fonts } from '@/constants/theme';
import { parseInlineBold } from '@/lib/agent-chat';

/**
 * O nome citado dentro de uma frase, em negrito — o lugar que era das « » (25/09/2026, pedido do
 * dono do produto: *"trocar por negrito a palavra que ficava dentro"*). Recebe o DADO como filho,
 * nunca um texto com `*` para interpretar: nome de pasta, busca e descrição de extrato são do
 * usuário, e "IFD*IFOOD" partiria ao meio. Mora dentro de um `ThemedText`, que dá cor e tamanho.
 */
export function Forte({ children }: { children: ReactNode }) {
  return <Text style={styles.forte}>{children}</Text>;
}

/**
 * Texto ESCRITO POR NÓS com os trechos `*assim*` em negrito (dica de vazio, frase do servidor) — o
 * mesmo leitor do chat do agente. Dado do usuário não passa por aqui: ele usa `Forte`.
 */
export function ComNegrito({ texto }: { texto: string }) {
  return parseInlineBold(texto).map((t, i) => (
    <Text key={i} style={t.bold ? styles.markdown : undefined}>
      {t.text}
    </Text>
  ));
}

const styles = StyleSheet.create({
  // Peso é FAMÍLIA (§3): `fontWeight` no Android cai no regular com negrito sintético. O nome vai
  // um degrau acima do semibold para destacar também dentro de título (`headline` já é 600).
  forte: { fontFamily: Fonts.bold },
  markdown: { fontFamily: Fonts.semibold },
});
