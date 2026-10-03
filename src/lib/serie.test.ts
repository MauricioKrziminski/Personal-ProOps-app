import assert from 'node:assert/strict';
import test from 'node:test';
import { avisoDeDeslize, montaRRule, mudaInicioDaSerie, mudancasDaOcorrencia, regraDoApp, serieDaOcorrencia, serieDoRegistro, validaSerie, type OcorrenciaDaSerie, type SerieGravada } from './serie.ts';
import { diaAmbiguo } from './dates.ts';
import { selectExpenseClassification, UNKNOWN_EXPENSE_CLASSIFICATION } from './expense-classification.ts';

// O Fundacred de produção (26/09/2026): dia 4 no cadastro, vence no último dia do mês.
const fundacred: SerieGravada = {
  id: 's1', kind: 'expense', amount_cents: 119885, description: 'Fundacred', merchant: null, category: 'estudo',
  account_id: null, rrule: 'FREQ=MONTHLY;BYMONTHDAY=4', next_run_at: '2026-10-05T00:00:00Z', end_date: null, auto_confirm: false,
};
const outubro: OcorrenciaDaSerie = {
  amount_cents: 119885, description: 'Fundacred', merchant: null, category: 'estudo', account_id: null,
  occurred_at: '2026-10-04', due_at: '2026-10-04', invoice_id: null,
};

test('F06 série: leitura conserva snapshot do contrato ou ocorrência e legado não vira fixo', () => {
  const contrato = { ...fundacred, expense_pattern: 'fixed' as const, expense_pattern_source: 'category_default' as const,
    expense_necessity: 'essential' as const, expense_necessity_source: 'explicit' as const };
  const ocorrencia = { ...outubro, expense_pattern: 'variable' as const, expense_pattern_source: 'explicit' as const,
    expense_necessity: null, expense_necessity_source: 'explicit' as const };
  assert.deepEqual(serieDoRegistro(contrato).expenseClassification, {
    expense_pattern: 'fixed', expense_pattern_source: 'category_default', expense_necessity: 'essential', expense_necessity_source: 'explicit',
  });
  assert.deepEqual(serieDaOcorrencia(contrato, ocorrencia).expenseClassification, {
    expense_pattern: 'variable', expense_pattern_source: 'explicit', expense_necessity: null, expense_necessity_source: 'explicit',
  });
  assert.deepEqual(serieDoRegistro(fundacred).expenseClassification, UNKNOWN_EXPENSE_CLASSIFICATION);
});

test('F06 série: renomear conserva overrides; uma dimensão alterada publica seu par nas linhas e regra', () => {
  const contrato = { ...fundacred, expense_pattern: 'fixed' as const, expense_pattern_source: 'category_default' as const };
  const ocorrencia = { ...outubro, expense_pattern: 'variable' as const, expense_pattern_source: 'explicit' as const };
  const base = serieDaOcorrencia(contrato, ocorrencia);
  assert.deepEqual(mudancasDaOcorrencia({ ...base, description: 'Título novo' }, ocorrencia, contrato), { linhas: { description: 'Título novo' }, regra: {} });
  const changed = { ...base, expenseClassification: selectExpenseClassification(base.expenseClassification, 'necessity', null) };
  assert.deepEqual(mudancasDaOcorrencia(changed, ocorrencia, contrato), {
    linhas: { expense_necessity: null, expense_necessity_source: 'explicit' },
    regra: { expense_necessity: null, expense_necessity_source: 'explicit' },
  });
});

test('F06 série: mudança de previsibilidade propaga intenção mesmo quando contrato já tem o valor escolhido', () => {
  const contrato = { ...fundacred, expense_pattern: 'fixed' as const, expense_pattern_source: 'explicit' as const };
  const ocorrencia = { ...outubro, expense_pattern: 'variable' as const, expense_pattern_source: 'explicit' as const };
  const base = serieDaOcorrencia(contrato, ocorrencia);
  const changed = { ...base, expenseClassification: selectExpenseClassification(base.expenseClassification, 'pattern', 'fixed') };
  assert.deepEqual(mudancasDaOcorrencia(changed, ocorrencia, contrato), {
    linhas: { expense_pattern: 'fixed', expense_pattern_source: 'explicit' },
    regra: { expense_pattern: 'fixed', expense_pattern_source: 'explicit' },
  });
});

test('F06 série: converter gasto classificado em receita limpa os quatro campos', () => {
  const classified = { expense_pattern: 'fixed' as const, expense_pattern_source: 'explicit' as const,
    expense_necessity: 'essential' as const, expense_necessity_source: 'category_default' as const };
  const base = serieDaOcorrencia({ ...fundacred, ...classified }, { ...outubro, ...classified });
  assert.deepEqual(mudancasDaOcorrencia({ ...base, kind: 'income' }, { ...outubro, ...classified }, { ...fundacred, ...classified }), {
    linhas: { ...UNKNOWN_EXPENSE_CLASSIFICATION }, regra: { kind: 'income', ...UNKNOWN_EXPENSE_CLASSIFICATION },
  });
});

test('F06 série: converter ocorrência legado em receita também limpa snapshot conhecido do contrato', () => {
  const contrato = { ...fundacred, expense_pattern: 'fixed' as const, expense_pattern_source: 'explicit' as const,
    expense_necessity: 'essential' as const, expense_necessity_source: 'explicit' as const };
  const base = serieDaOcorrencia(contrato, outubro);
  assert.deepEqual(mudancasDaOcorrencia({ ...base, kind: 'income' }, outubro, contrato), {
    linhas: { ...UNKNOWN_EXPENSE_CLASSIFICATION }, regra: { kind: 'income', ...UNKNOWN_EXPENSE_CLASSIFICATION },
  });
});

test('Esta e as próximas: valor e vencimento mudados — o valor vai pelas linhas, o calendário pela regra', () => {
  const form = { ...serieDaOcorrencia(fundacred, outubro), amountCents: 120000, inicio: '31/10/2026', agendaMudou: true };
  const { linhas, regra } = mudancasDaOcorrencia(form, outubro, fundacred);
  assert.deepEqual(linhas, { amount_cents: 120000 });
  assert.deepEqual(Object.keys(regra).sort(), ['next_run_at', 'rrule']);
  assert.equal(regra.rrule, 'FREQ=MONTHLY;BYMONTHDAY=31', 'tocar em 31 fixa o número; último dia é uma ação separada');
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

test('30/09 continua dia 30 fixo sem a ação explícita de último dia', () => {
  const trinta = new Date(2026, 8, 30);
  assert.equal(diaAmbiguo(trinta), true);
  assert.equal(diaAmbiguo(new Date(2026, 9, 31)), false, '31 é sempre o último');
  assert.equal(diaAmbiguo(new Date(2026, 9, 30)), false, '30/10 não é o último de outubro');
  assert.equal(diaAmbiguo(new Date(2027, 1, 28)), true);
  assert.equal(montaRRule('monthly', trinta, 1), 'FREQ=MONTHLY;BYMONTHDAY=30');
  assert.equal(montaRRule('monthly', trinta, 1, true), 'FREQ=MONTHLY;BYMONTHDAY=-1');
  assert.equal(montaRRule('monthly', new Date(2026, 9, 31), 1), 'FREQ=MONTHLY;BYMONTHDAY=31');
  const form = { ...serieDoRegistro(fundacred), inicio: '30/09/2026', agendaMudou: true };
  assert.equal(validaSerie(form).rrulePrevia, 'FREQ=MONTHLY;BYMONTHDAY=30');
  assert.equal(serieDoRegistro({ ...fundacred, rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' }).ultimoDia, true);
});

test('calendário escolhe dia fixo até no dia 31; ação própria escolhe fim do mês', () => {
  assert.equal(montaRRule('monthly', new Date(2026, 9, 31), 1), 'FREQ=MONTHLY;BYMONTHDAY=31');
  assert.equal(montaRRule('monthly', new Date(2026, 8, 30), 1, true), 'FREQ=MONTHLY;BYMONTHDAY=-1');
  const anterior = { ...serieDoRegistro({ ...fundacred, rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' }), inicio: '31/10/2026' };
  const fixo = mudaInicioDaSerie(anterior, '30/11/2026', false);
  assert.equal(fixo.ultimoDia, false, 'uma nova escolha no calendário apaga a intenção anterior');
  assert.equal(validaSerie(fixo).rrulePrevia, 'FREQ=MONTHLY;BYMONTHDAY=30');
  const ultimo = mudaInicioDaSerie(fixo, '31/12/2026', true);
  assert.equal(ultimo.ultimoDia, true);
  assert.equal(validaSerie(ultimo).rrulePrevia, 'FREQ=MONTHLY;BYMONTHDAY=-1');
});

test('Esta e as próximas numa ocorrência PAGA parte do próximo vencimento, não da data dela', () => {
  const antes = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    const setembroPago = { ...outubro, occurred_at: '2026-09-04', due_at: '2026-09-04', status: 'cleared' };
    assert.equal(serieDaOcorrencia(fundacred, setembroPago).inicio, '04/10/2026');
    assert.equal(serieDaOcorrencia(fundacred, { ...setembroPago, status: 'pending' }).inicio, '04/09/2026');
  } finally {
    process.env.TZ = antes;
  }
});

test('A data que o banco deslizou vira aviso; a mesma data, nada', () => {
  assert.equal(avisoDeDeslize('2026-09-30', '2026-09-30'), null);
  assert.equal(avisoDeDeslize('2026-09-30', '2026-10-31'), 'Setembro já tinha a cobrança dela: a próxima fica em 31/10/2026.');
});

const detail = '33333333-3333-4333-8333-333333333333';
test('F09 snapshot da ocorrência substitui filho do contrato; patch difere omitido/null e alias', () => {
  const contract = { ...fundacred, subcategory_id: detail };
  const row = { ...outubro, subcategory_id: detail };
  const base = serieDaOcorrencia(contract, row);
  assert.equal(serieDoRegistro(contract).subcategory_id, detail);
  assert.equal(base.subcategory_id, detail);
  assert.equal(serieDaOcorrencia(contract, { ...outubro, subcategory_id: null }).subcategory_id, null);
  assert.equal(Object.hasOwn(serieDaOcorrencia(contract, outubro), 'subcategory_id'), false);
  assert.deepEqual(mudancasDaOcorrencia(base, row, contract), { linhas: {}, regra: {} });
  assert.deepEqual(mudancasDaOcorrencia({ ...base, subcategory_id: null }, row, contract), { linhas: { subcategory_id: null }, regra: { subcategory_id: null } });
  assert.deepEqual(mudancasDaOcorrencia({ ...base, category: 'saúde' }, row, contract), { linhas: { category: 'saúde', subcategory_id: null }, regra: { subcategory_id: null } });
  assert.deepEqual(mudancasDaOcorrencia({ ...base, category: 'ESTUDO' }, row, contract), { linhas: { category: 'ESTUDO' }, regra: {} });
});
