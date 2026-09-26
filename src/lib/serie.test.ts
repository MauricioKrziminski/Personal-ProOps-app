import assert from 'node:assert/strict';
import test from 'node:test';
import { montaRRule, mudancasDaOcorrencia, regraDoApp, serieDaOcorrencia, serieDoRegistro, type OcorrenciaDaSerie, type SerieGravada } from './serie.ts';

// O Fundacred de produção (26/09/2026): dia 4 no cadastro, vence no último dia do mês.
const fundacred: SerieGravada = {
  id: 's1', kind: 'expense', amount_cents: 119885, description: 'Fundacred', merchant: null, category: 'estudo',
  account_id: null, rrule: 'FREQ=MONTHLY;BYMONTHDAY=4', next_run_at: '2026-10-05T00:00:00Z', end_date: null, auto_confirm: false,
};
const outubro: OcorrenciaDaSerie = {
  amount_cents: 119885, description: 'Fundacred', merchant: null, category: 'estudo', account_id: null,
  occurred_at: '2026-10-04', due_at: '2026-10-04', invoice_id: null,
};

test('Esta e as próximas: valor e vencimento mudados — o valor vai pelas linhas, o calendário pela regra', () => {
  const form = { ...serieDaOcorrencia(fundacred, outubro), amountCents: 120000, inicio: '31/10/2026', agendaMudou: true };
  const { linhas, regra } = mudancasDaOcorrencia(form, outubro, fundacred);
  assert.deepEqual(linhas, { amount_cents: 120000 });
  assert.deepEqual(Object.keys(regra).sort(), ['next_run_at', 'rrule']);
  assert.equal(regra.rrule, 'FREQ=MONTHLY;BYMONTHDAY=-1', '31/10 é o último dia: todo último dia');
  const d = new Date(regra.next_run_at!);
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 10, 31]);
});

test('Esta e as próximas sem mexer em nada não grava nada — nem o calendário vindo do WhatsApp', () => {
  assert.deepEqual(mudancasDaOcorrencia(serieDaOcorrencia(fundacred, outubro), outubro, fundacred), { linhas: {}, regra: {} });
});

test('Tipo, fim e "entra como pago" são da série; título e estabelecimento, das linhas', () => {
  const form = { ...serieDaOcorrencia(fundacred, outubro), kind: 'income' as const, fim: '31/12/2027', autoConfirm: true, merchant: 'Fundacred SA ', description: ' Fundacred ' };
  const { linhas, regra } = mudancasDaOcorrencia(form, outubro, fundacred);
  assert.deepEqual(linhas, { merchant: 'Fundacred SA' }, 'o título só com espaço a mais não mudou');
  assert.deepEqual(regra, { kind: 'income', end_date: '2027-12-31', auto_confirm: true });
});

test('A data do formulário é o vencimento da linha fora do cartão, e a compra no cartão', () => {
  assert.equal(serieDaOcorrencia(fundacred, { ...outubro, occurred_at: '2026-09-04', due_at: '2026-09-30' }).inicio, '30/09/2026');
  assert.equal(serieDaOcorrencia(fundacred, { ...outubro, occurred_at: '2026-09-20', due_at: '2026-10-10', invoice_id: 'f1' }).inicio, '20/09/2026');
});

test('A série no formulário: o próximo é o dia LOCAL, e a repetição sai da regra', () => {
  const antes = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const form = serieDoRegistro(fundacred);
    assert.equal(form.inicio, '04/10/2026', '05/10 00:00 UTC é 04/10 em Brasília — o card dizia 05/10');
    assert.equal(form.preset, 'monthly');
    assert.equal(serieDoRegistro({ ...fundacred, rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=4' }).intervalo, '3');
  } finally {
    process.env.TZ = antes;
  }
});

test('regra que o app não desenha fica própria: o formulário não a reescreve', () => {
  // "todo dia" e "dias 5 e 20" vêm do WhatsApp; mostrar "Mensal" para elas mentiria.
  const base = { id: 's1', kind: 'expense', amount_cents: 100, description: 'X', merchant: null, category: null, account_id: null, next_run_at: '2026-10-05T12:00:00Z', end_date: null, auto_confirm: true };
  assert.equal(serieDoRegistro({ ...base, rrule: 'FREQ=DAILY' }).regraPropria, 'FREQ=DAILY');
  assert.equal(serieDoRegistro({ ...base, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5,20' }).regraPropria, 'FREQ=MONTHLY;BYMONTHDAY=5,20');
  assert.equal(serieDoRegistro({ ...base, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5' }).regraPropria, undefined);
  assert.equal(serieDoRegistro({ ...base, rrule: 'FREQ=WEEKLY;BYDAY=MO' }).regraPropria, undefined);
  // o que o app monta é sempre do app
  for (const d of [new Date(2026, 9, 5), new Date(2026, 9, 31), new Date(2026, 1, 28)]) {
    for (const preset of ['monthly', 'weekly', 'yearly'] as const) assert.ok(regraDoApp(montaRRule(preset, d, 3)), preset);
  }
});
