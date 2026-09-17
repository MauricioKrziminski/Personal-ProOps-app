import { horaBR, localISODate, rotuloDoDia } from './dates.ts';

/**
 * As linhas de `public.agent_activity` viradas pares "o que a pessoa disse → o que virou".
 *
 * ⚠️ **O texto é o que o banco devolveu, e só.** Sem frase (foto sem legenda, histórico sem
 * texto), `texto` é nulo e a tela escreve o TIPO da entrada ("foto"), nunca uma frase atribuída
 * à pessoa.
 *
 * ⚠️ **"Apagado depois" só para o que sabemos ler.** O RPC resume oito tabelas; uma regra de
 * categoria ou um orçamento voltam sem registro mesmo existindo. Para esses, o card diz o verbo
 * ("Regra salva") e não afirma sumiço nenhum.
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

export type Destino = { pathname: string; params?: Record<string, string> };

export type CardDaFala = {
  chave: string;
  verbo: 'criou' | 'alterou' | 'apagou';
  rotulo: string;
  registro: RegistroResumido | null;
  destino: Destino | null;
};

export type ParDaConversa = {
  chave: string;
  quando: string;
  dia: string;
  hora: string;
  canal: 'whatsapp' | 'app';
  entrada: 'text' | 'audio' | 'image' | 'document' | 'click';
  texto: string | null;
  sessao: string | null;
  cards: CardDaFala[];
};

const APAGA = new Set(['delete_transaction', 'undo_last', 'delete_note', 'delete_reminder', 'resource_delete']);
const ALTERA = new Set([
  'update_transaction', 'append_note', 'update_asset_value', 'resource_update',
  'mark_paid', 'pay_invoice', 'goal_deposit', 'resource_pay', 'resource_roll',
]);

/** Ações cujo registro o RPC SABE ler: sem ele, a linha realmente não existe mais. */
const SUMIU_SE_NULO: Record<string, string> = {
  create_expense: 'Gasto apagado depois',
  create_income: 'Receita apagada depois',
  create_transfer: 'Transferência apagada depois',
  update_transaction: 'Lançamento apagado depois',
  create_installment_purchase: 'Compra parcelada apagada depois',
  create_goal: 'Meta apagada depois',
  create_note: 'Nota apagada depois',
  append_note: 'Nota apagada depois',
  create_reminder: 'Lembrete apagado depois',
};

/** O que dizer quando não há registro para mostrar e não dá para afirmar sumiço. */
const ROTULO_SEM_REGISTRO: Record<string, string> = {
  delete_transaction: 'Lançamento apagado',
  undo_last: 'Lançamento desfeito',
  delete_note: 'Nota apagada',
  delete_reminder: 'Lembrete apagado',
  resource_delete: 'Cadastro apagado',
  resource_create: 'Cadastro criado',
  resource_update: 'Cadastro atualizado',
  resource_pay: 'Pagamento registrado',
  resource_roll: 'Fatura adiada',
  set_rule: 'Regra salva',
  mark_paid: 'Baixa registrada',
  pay_invoice: 'Fatura paga',
  goal_deposit: 'Aporte na meta',
  update_asset_value: 'Patrimônio atualizado',
};

function destinoDe(r: RegistroResumido): Destino {
  switch (r.kind) {
    case 'transaction':
      return { pathname: '/finance/[txId]', params: { txId: r.id } };
    case 'installment_plan':
      return { pathname: '/finance/installments' };
    case 'recurring':
      return { pathname: '/finance/recurring' };
    case 'reminder':
      return { pathname: '/reminder-form', params: { id: r.id } };
    case 'note':
      return { pathname: '/notes/[id]', params: { id: r.id } };
    case 'account':
      return { pathname: '/finance/accounts' };
    case 'goal':
      return { pathname: '/finance/goals' };
    case 'debt':
      return { pathname: '/finance/debts' };
  }
}

function card(l: LinhaDaAtividade): CardDaFala {
  const verbo = APAGA.has(l.action_type) ? 'apagou' : ALTERA.has(l.action_type) ? 'alterou' : 'criou';
  const rotulo = l.record
    ? l.record.title
    : SUMIU_SE_NULO[l.action_type] ?? ROTULO_SEM_REGISTRO[l.action_type] ?? 'Feito';
  return {
    chave: `${l.source_message_id}#${l.action_index}`,
    verbo,
    rotulo,
    registro: l.record,
    destino: l.record ? destinoDe(l.record) : null,
  };
}

const ENTRADAS = new Set(['text', 'audio', 'image', 'document', 'click']);

export function paresDaConversa(linhas: readonly LinhaDaAtividade[], hoje: string = localISODate()): ParDaConversa[] {
  const grupos = new Map<string, LinhaDaAtividade[]>();
  for (const l of linhas) grupos.set(l.source_message_id, [...(grupos.get(l.source_message_id) ?? []), l]);

  return [...grupos.entries()]
    .map(([chave, lista]) => {
      const ordenada = [...lista].sort((a, b) => a.action_index - b.action_index);
      const quando = ordenada.reduce((max, l) => (l.executed_at > max ? l.executed_at : max), ordenada[0].executed_at);
      const primeira = ordenada[0];
      const texto = primeira.origin_text?.trim() || null;
      return {
        chave,
        quando,
        dia: rotuloDoDia(localISODate(new Date(quando)), hoje),
        hora: horaBR(quando),
        canal: primeira.channel === 'whatsapp' ? ('whatsapp' as const) : ('app' as const),
        entrada: (ENTRADAS.has(primeira.input_kind) ? primeira.input_kind : 'text') as ParDaConversa['entrada'],
        texto,
        sessao: primeira.session_id,
        cards: ordenada.map(card),
      };
    })
    .sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
}
