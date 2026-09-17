/**
 * O contrato de `public.agent_activity` — o que o agente escreveu e a frase que o originou.
 *
 * ⚠️ **Isto virou SÓ tipo em 17/09/2026.** A "Conversa" da Hoje (balões devolvendo o texto que a
 * pessoa acabou de mandar) foi removida por decisão do dono do produto, e com ela
 * `paresDaConversa`, `metaDoRegistro`, `destinoDe` e os quatro componentes de `components/feed/`
 * que só ela usava. Sobreviveu o uso que INFORMA: o Financeiro põe a frase original como citação
 * na linha do lançamento, para dar para conferir o que o agente entendeu sem sair da lista.
 *
 * ⚠️ **O texto é o que o banco devolveu, e só.** Sem frase (foto sem legenda, histórico sem
 * texto), `origin_text` é nulo e a tela não inventa uma frase atribuída à pessoa.
 */
export type RegistroResumido = {
  kind: 'transaction' | 'installment_plan' | 'recurring' | 'reminder' | 'note' | 'account' | 'goal' | 'debt';
  id: string;
  title: string;
  amount_cents?: number;
  tx_kind?: string;
  category?: string | null;
  occurred_at?: string;
  account?: string | null;
  installments?: number;
  next_run_at?: string;
  account_type?: string;
};

export type LinhaDaAtividade = {
  source_message_id: string;
  executed_at: string;
  channel: string;
  input_kind: string;
  origin_text: string | null;
  session_id: string | null;
  action_index: number;
  action_type: string;
  result_id: string | null;
  record: RegistroResumido | null;
};
