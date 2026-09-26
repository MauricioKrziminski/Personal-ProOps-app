/**
 * As regras da SÉRIE recorrente, puras (os campos moram em `components/finance/serie-form.tsx`).
 * Aqui fica o que tem conta: a RRULE que o formulário monta, o que ele vale e o que o salvar grava.
 */
import { brToISO, dataLocalDe, ehUltimoDiaDoMes, isValidBRDate, isoToBR, localDateTime, localISODate } from './dates.ts';
import { validRecurringRange } from './finance-form.ts';

export interface SerieForm {
  /**
   * Presente = está EDITANDO uma série que já existe. Todos os campos da criação continuam na tela:
   * mudar a repetição ou o vencimento refaz as ocorrências futuras em aberto.
   */
  id?: string;
  /**
   * A pessoa mexeu em "Repete", "A cada quantos meses" ou no vencimento. Só então a regra vai no
   * salvar: comparar a regra montada com a gravada mudaria o calendário de uma série vinda do
   * WhatsApp que a pessoa nem tocou (a regra de lá nem sempre tem a forma que o app monta).
   */
  agendaMudou?: boolean;
  kind: 'expense' | 'income';
  amountCents: number;
  description: string;
  /** Opcional, como no lançamento: nem toda conta fixa tem um estabelecimento. */
  merchant: string;
  category: string | null;
  accountId: string | null;
  preset: 'monthly' | 'weekly' | 'yearly';
  /** Só no preset mensal: `A cada N meses`. */
  intervalo: string;
  /** dd/mm/aaaa — criando, vira `dtstart` e o `next_run_at`; editando, é o próximo vencimento. */
  inicio: string;
  /** dd/mm/aaaa, opcional: é como se encerra uma assinatura sem apagar o histórico. */
  fim: string;
  autoConfirm: boolean;
}

/** O que a série gravada precisa ter para virar formulário. */
export interface SerieGravada {
  id: string;
  kind: string;
  amount_cents: number;
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  rrule: string;
  next_run_at: string;
  end_date: string | null;
  auto_confirm: boolean;
}

const DIAS_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * A RRULE sai do preset + da data — nunca de um campo de texto livre, que seria um gerador de
 * série quebrada. A frase de volta vem do mesmo `describeRRule` das séries da IA.
 */
export function montaRRule(preset: SerieForm['preset'], inicio: Date, intervalo: number): string {
  if (preset === 'weekly') return `FREQ=WEEKLY;BYDAY=${DIAS_RRULE[inicio.getDay()]}`;
  if (preset === 'yearly') return `FREQ=YEARLY;BYMONTH=${inicio.getMonth() + 1};BYMONTHDAY=${inicio.getDate()}`;
  const passo = intervalo > 1 ? `;INTERVAL=${intervalo}` : '';
  /*
    ⚠️ **A data DIZ se é "todo dia N" ou "todo último dia do mês".** Havia um campo só para
    perguntar isso ("Vence quando: Dia do mês | Último dia"), e ele era um controle que a própria
    data já respondia — quem escolhe 31/10 quer o fim do mês, quem escolhe 05/10 quer o dia 5.

    `-1` não é cosmético ao lado de 31: `BYMONTHDAY=31` PULA fevereiro e os meses de 30 dias.
  */
  return `FREQ=MONTHLY${passo};BYMONTHDAY=${ehUltimoDiaDoMes(inicio) ? -1 : inicio.getDate()}`;
}

/**
 * Uma série existente no formulário: a repetição sai da regra gravada e a data é o PRÓXIMO
 * vencimento, no dia LOCAL (`next_run_at` é timestamp: 05/10 00:00 UTC é 04/10 em Brasília).
 */
export function serieDoRegistro(r: SerieGravada): SerieForm {
  return {
    id: r.id,
    kind: r.kind === 'income' ? 'income' : 'expense',
    amountCents: Number(r.amount_cents),
    description: r.description ?? '',
    merchant: r.merchant ?? '',
    category: r.category,
    accountId: r.account_id,
    preset: r.rrule.includes('FREQ=WEEKLY') ? 'weekly' : r.rrule.includes('FREQ=YEARLY') ? 'yearly' : 'monthly',
    intervalo: /INTERVAL=(\d+)/.exec(r.rrule)?.[1] ?? '1',
    inicio: isoToBR(dataLocalDe(r.next_run_at)),
    fim: r.end_date ? isoToBR(r.end_date) : '',
    autoConfirm: r.auto_confirm,
  };
}

export const SERIE_VAZIA: SerieForm = {
  kind: 'expense',
  amountCents: 0,
  description: '',
  merchant: '',
  category: null,
  accountId: null,
  preset: 'monthly',
  intervalo: '1',
  inicio: isoToBR(localISODate()),
  fim: '',
  autoConfirm: true,
};

/** O que o formulário vale agora: o que falta, o que está errado e a regra que ele monta. */
export function validaSerie(form: SerieForm | null) {
  const inicioDate = form ? localDateTime(form.inicio, '09:00') : null;
  const inicioOk = Boolean(form && isValidBRDate(form.inicio) && inicioDate);
  const fimOk = form
    ? form.fim === '' || (isValidBRDate(form.fim) && inicioOk && brToISO(form.fim) >= brToISO(form.inicio))
    : false;
  /*
    ⚠️ O título ficava de FORA da guarda e a lista caía em "sem descrição" — a série nascia anônima
    e se materializava em uma linha por mês, todas sem nome (15/09/2026).
  */
  const tituloOk = (form?.description.trim().length ?? 0) > 0;
  // Mudando o calendário de uma série, o próximo vencimento é daqui para a frente: o passado fica.
  const agendaNoPassado = Boolean(form?.id && form.agendaMudou && inicioOk && brToISO(form.inicio) < localISODate());
  const calendarioOk = Boolean(
    form && inicioOk && validRecurringRange(brToISO(form.inicio), form.fim ? brToISO(form.fim) : '', form.preset === 'monthly' ? form.intervalo : '1'),
  );
  const basico = Boolean(form && tituloOk && form.amountCents > 0 && fimOk);
  // Editando, o calendário só pesa quando a pessoa mexeu nele (`agendaMudou`).
  const podeSalvar = form?.id
    ? basico && (!form.agendaMudou || (calendarioOk && !agendaNoPassado))
    : basico && calendarioOk;
  const rrulePrevia = form && inicioDate ? montaRRule(form.preset, inicioDate, Number(form.intervalo) || 1) : null;
  return { inicioDate, inicioOk, fimOk, tituloOk, agendaNoPassado, podeSalvar, rrulePrevia };
}

/** A ocorrência aberta no formulário do lançamento. */
export interface OcorrenciaDaSerie {
  amount_cents: number;
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  occurred_at: string;
  due_at: string | null;
  invoice_id: string | null;
}

/**
 * "Esta e as próximas" aberto numa ocorrência: o formulário da série com os valores DESTA linha
 * (é o que a pessoa está vendo) e, como data, o vencimento dela — fora do cartão; no cartão, a data
 * da compra (lá `due_at` é o vencimento da fatura).
 */
export function serieDaOcorrencia(serie: SerieGravada, linha: OcorrenciaDaSerie): SerieForm {
  return {
    ...serieDoRegistro(serie),
    amountCents: linha.amount_cents,
    description: linha.description ?? '',
    merchant: linha.merchant ?? '',
    category: linha.category,
    accountId: linha.account_id,
    inicio: isoToBR(!linha.invoice_id && linha.due_at ? linha.due_at : linha.occurred_at),
  };
}

/**
 * O que salvar "Esta e as próximas" grava, em DUAS partes e nesta ordem:
 *
 * - `linhas` — valor, categoria, título, estabelecimento e conta que MUDARAM em relação a esta
 *   ocorrência. Vão por `update_transaction_scoped` com escopo "future", ancorado NELA: é o
 *   "esta e as próximas" de verdade, e a mesma RPC atualiza a regra da série.
 * - `regra` — tipo, fim e "entra como pago" que mudaram em relação à série, e o calendário (regra
 *   + próximo vencimento) só se a pessoa mexeu nele. Vão por `update_recurring_series`, DEPOIS:
 *   o calendário novo move esta linha de data, e o escopo das linhas é ancorado nela.
 */
export function mudancasDaOcorrencia(form: SerieForm, linha: OcorrenciaDaSerie, serie: SerieGravada) {
  const linhas: {
    amount_cents?: number;
    category?: string | null;
    description?: string;
    merchant?: string | null;
    account_id?: string | null;
  } = {};
  if (form.amountCents !== linha.amount_cents) linhas.amount_cents = form.amountCents;
  if (form.category !== linha.category) linhas.category = form.category;
  const titulo = form.description.trim();
  if (titulo !== (linha.description ?? '')) linhas.description = titulo;
  const merchant = form.merchant.trim() || null;
  if (merchant !== linha.merchant) linhas.merchant = merchant;
  if (form.accountId !== linha.account_id) linhas.account_id = form.accountId;

  const regra: {
    kind?: 'expense' | 'income';
    end_date?: string | null;
    auto_confirm?: boolean;
    rrule?: string;
    next_run_at?: string;
  } = {};
  if (form.kind !== serie.kind) regra.kind = form.kind;
  const fim = form.fim ? brToISO(form.fim) : null;
  if (fim !== serie.end_date) regra.end_date = fim;
  if (form.autoConfirm !== serie.auto_confirm) regra.auto_confirm = form.autoConfirm;
  const { inicioDate, rrulePrevia } = validaSerie(form);
  if (form.agendaMudou && inicioDate && rrulePrevia) {
    regra.rrule = rrulePrevia;
    regra.next_run_at = inicioDate.toISOString();
  }
  return { linhas, regra };
}
