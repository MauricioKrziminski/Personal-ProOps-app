import assert from 'node:assert/strict';
import test from 'node:test';
import { linhaDaRecorrente } from './escrita.ts';
import { mudancasDaOcorrencia, pisoDoInicio, serieDaOcorrencia, serieDoRegistro, validaSerie, type OcorrenciaDaSerie, type SerieGravada } from './serie.ts';

const assinatura: SerieGravada = {
  id: 's', kind: 'expense', amount_cents: 5000, description: 'ChatGPT', merchant: null, category: 'assinaturas',
  account_id: 'a', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', next_run_at: '2026-11-15T12:00:00Z',
  dtstart: '2026-01-15T12:00:00Z', end_date: null, auto_confirm: true,
};
const linha: OcorrenciaDaSerie = {
  amount_cents: 5000, description: 'ChatGPT', merchant: null, category: null, account_id: 'a',
  occurred_at: '2026-11-15', due_at: '2026-11-15', invoice_id: null,
};

test('F18 transferência: o patch só leva o destino; o tipo nunca vira patch', () => {
  const contrato: SerieGravada = { ...assinatura, kind: 'transfer', category: null, account_id: 'a', counterparty_account_id: 'b' };
  const base = serieDaOcorrencia(contrato, linha);
  assert.equal(base.kind, 'transfer');
  assert.deepEqual(mudancasDaOcorrencia(base, linha, contrato), { linhas: {}, regra: {} });
  assert.deepEqual(mudancasDaOcorrencia({ ...base, counterpartyId: 'c' }, linha, contrato).regra, { counterparty_account_id: 'c' });
  // gasto -> transferência pelo formulário não vira patch: é conversão (`converter_registro`)
  const gasto = serieDoRegistro(assinatura);
  const regra = mudancasDaOcorrencia({ ...gasto, kind: 'transfer' }, { ...linha, category: 'assinaturas' }, assinatura).regra;
  assert.equal('kind' in regra, false);
});

test('F18 transferência: a linha da série sai sem categoria, estabelecimento e forma de pagamento', () => {
  const entrada = {
    kind: 'transfer' as const, amount_cents: 20000, description: 'Reserva', merchant: 'x', category: 'casa', account_id: 'a',
    counterparty_account_id: 'b', payment_method: 'pix' as const, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5',
    next_run_at: '2026-11-05T12:00:00.000Z', end_date: null, auto_confirm: true,
  };
  const saida = linhaDaRecorrente(entrada);
  assert.equal(saida.category, null);
  assert.equal(saida.merchant, null);
  assert.equal('payment_method' in saida, false);
  assert.equal(saida.counterparty_account_id, 'b');
  assert.throws(() => linhaDaRecorrente({ ...entrada, counterparty_account_id: 'a' }), /duas contas diferentes/);
  assert.throws(() => linhaDaRecorrente({ ...entrada, counterparty_account_id: null }), /duas contas diferentes/);
});

test('F18 piso do "Termina em": o calendário reescreve o dtstart, então vale a primeira ocorrência', () => {
  assert.equal(pisoDoInicio('10/10/2026', '2026-07-01'), '01/07/2026');
  assert.equal(pisoDoInicio('10/10/2026', '2026-11-01'), '10/10/2026');
  assert.equal(pisoDoInicio('10/10/2026', null), '10/10/2026');
  assert.equal(pisoDoInicio(undefined, '2026-07-01'), '01/07/2026');
  const form = { ...serieDoRegistro({ ...assinatura, dtstart: '2026-10-10T12:00:00Z' }), fim: '05/09/2026' };
  assert.equal(validaSerie(form).fimOk, false, 'sem a primeira ocorrência o fim antes do dtstart é recusado');
  assert.equal(validaSerie({ ...form, inicioOriginal: pisoDoInicio(form.inicioOriginal, '2026-07-01') }).fimOk, true);
});
