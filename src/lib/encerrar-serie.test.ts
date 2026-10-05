import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBRL } from './dates.ts';
import { fraseDoEncerramento as frase, ultimaCobrancaPadrao, type PreviaDoEncerramento } from './encerrar-serie.ts';
import { serieDoRegistro, validaSerie, type SerieGravada } from './serie.ts';

const fraseDoEncerramento = (p: PreviaDoEncerramento) => frase(p, formatBRL);

const previa: PreviaDoEncerramento = {
  removed_count: 2, removed_cents: 10000, kept_locked_count: 0, kept_paid_count: 3,
  kept_overdue_count: 1, kept_upcoming_count: 0, end_date: '2026-10-05',
};

const assinatura: SerieGravada = {
  id: 's', kind: 'expense', amount_cents: 5000, description: 'ChatGPT', merchant: null, category: 'assinaturas',
  account_id: 'a', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', next_run_at: '2026-11-15T12:00:00Z',
  dtstart: '2026-01-15T12:00:00Z', end_date: null, auto_confirm: true,
};

test('F18 encerrar: a frase diz o que fica, o que sai e para onde a série vai', () => {
  assert.equal(
    fraseDoEncerramento(previa).replace(/\u00a0/g, ' '),
    'Ficam 3 pagas e 1 atrasada. Saem 2 cobranças futuras (R$ 100,00). A série vai para Encerradas.',
  );
  assert.match(fraseDoEncerramento({ ...previa, removed_count: 0, removed_cents: 0 }), /Nenhuma cobrança futura sai\./);
  assert.match(fraseDoEncerramento({ ...previa, removed_count: 1, removed_cents: 5000 }), /Saem 1 cobrança futura \(R\$\s50,00\)\./);
  assert.match(fraseDoEncerramento({ ...previa, kept_locked_count: 1 }), /1 cobrança fica porque a fatura dela já foi paga, adiada ou paga em parte\./);
  assert.match(fraseDoEncerramento({ ...previa, kept_upcoming_count: 2 }), /2 ainda vencem até 05\/10\/2026\./);
});

test('F18 encerrar: a última cobrança padrão é a mais recente que já venceu, nunca antes do início', () => {
  assert.equal(ultimaCobrancaPadrao(['2026-08-15', '2026-09-15', '2026-11-15'], '2026-10-05', '2026-01-15'), '2026-09-15');
  assert.equal(ultimaCobrancaPadrao([], '2026-10-05', '2026-01-15'), '2026-10-05');
  assert.equal(ultimaCobrancaPadrao([], '2026-10-05', '2026-12-01'), '2026-12-01');
});

test('F18 série: o piso do "Termina em" é o início ORIGINAL, não o próximo vencimento', () => {
  const form = serieDoRegistro(assinatura);
  assert.equal(form.inicio, '15/11/2026');
  assert.equal(form.inicioOriginal, '15/01/2026');
  // encerrar hoje uma assinatura cujo próximo vencimento é no mês seguinte
  const hoje = { ...form, fim: '05/10/2026' };
  const v = validaSerie(hoje);
  assert.equal(v.fimOk, true);
  assert.equal(v.fimEncerra, true, 'fim antes do próximo vencimento é encerramento');
  assert.equal(v.podeSalvar, true);
  // antes do início original continua inválido
  assert.equal(validaSerie({ ...form, fim: '10/01/2026' }).fimOk, false);
  // fim depois do próximo vencimento não é encerramento
  assert.equal(validaSerie({ ...form, fim: '15/12/2026' }).fimEncerra, false);
  // série nova: o piso segue sendo o início
  assert.equal(validaSerie({ ...form, id: undefined, inicioOriginal: undefined, fim: '05/10/2026' }).fimOk, false);
});

test('F18 transferência: origem e destino, diferentes, para salvar', () => {
  const base = { ...serieDoRegistro({ ...assinatura, kind: 'transfer', account_id: 'a', counterparty_account_id: 'b' }) };
  assert.equal(base.kind, 'transfer');
  assert.equal(base.counterpartyId, 'b');
  assert.equal(validaSerie(base).podeSalvar, true);
  assert.equal(validaSerie({ ...base, counterpartyId: null }).transferenciaOk, false);
  assert.equal(validaSerie({ ...base, counterpartyId: 'a' }).podeSalvar, false);
  assert.equal(validaSerie({ ...base, accountId: null }).podeSalvar, false);
});
