import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dataDaHipotese, faltaNaHipotese, pendenciaDoAplicar, paramsDoAplicar, registroDaHipotese, resumoDaHipotese, type Hipotese } from './hipotese.ts';
import { isoToBR, localISODate } from './dates.ts';

const base: Hipotese = { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 10000, parcelas: 2, repete: 'monthly', conta: 'c1', data: '2026-10-05' };
const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const nome = (id: string) => ({ c1: 'Nubank Cartão', c2: 'Itaú' } as Record<string, string>)[id] ?? null;

test('uma vez vira lançamento pendente com o título Hipótese', () => {
  const r = registroDaHipotese(base)!;
  assert.equal(r.tipo, 'lancamento');
  assert.deepEqual((r.dados.linhas as unknown[])[0], { kind: 'expense', amount_cents: 10000, category: null, description: 'Hipótese', merchant: null, account_id: 'c1', counterparty_account_id: null, occurred_at: '2026-10-05', status: 'pending', due_at: null, auto_confirm: false, source: 'app' });
});

test('parcelado vira a compra parcelada com 0 pagas; sem conta é incompleto', () => {
  const r = registroDaHipotese({ ...base, forma: 'parcelado', valor_cents: 300000, parcelas: 10 })!;
  assert.equal(r.tipo, 'parcelada');
  assert.equal(r.dados.p_total_cents, 300000);
  assert.equal(r.dados.p_installments, 10);
  assert.equal(r.dados.p_paid_installments, 0);
  assert.equal(r.dados.ultimo_dia, false);
  assert.equal(registroDaHipotese({ ...base, forma: 'parcelado', conta: null }), null);
  assert.equal(faltaNaHipotese({ ...base, forma: 'parcelado', conta: null }), 'Escolha a conta ou o cartão');
});

test('repete vira recorrente com a regra do app', () => {
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'weekly' })!.dados.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'monthly' })!.dados.rrule, 'FREQ=MONTHLY;BYMONTHDAY=5');
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'yearly' })!.dados.rrule, 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=5');
  assert.equal(registroDaHipotese({ ...base, forma: 'repete' })!.dados.dtstart, registroDaHipotese({ ...base, forma: 'repete' })!.dados.next_run_at);
});

test('financiamento: parcela fixa, âncora na data, dia da data', () => {
  const r = registroDaHipotese({ ...base, forma: 'financiamento', valor_cents: 147000, parcelas: 48, conta: 'c2', data: '2026-10-31' })!;
  assert.equal(r.tipo, 'financiamento');
  assert.equal(r.dados.calculation_mode, 'fixed_installments');
  assert.equal(r.dados.installment_cents, 147000);
  assert.equal(r.dados.remaining_cents, 147000 * 48);
  assert.equal(r.dados.first_due_date, '2026-10-31');
  assert.equal(r.dados.due_day, 31);
});

test('dois financiamentos no mesmo rascunho não colidem no nome (a dívida tem nome único no espaço)', () => {
  // Medido no staging (29/09/2026): os dois se chamavam "Hipótese" e o segundo voltava 23505.
  const f = { ...base, forma: 'financiamento' as const, valor_cents: 1000, parcelas: 3 };
  const nomes = [registroDaHipotese(f, 0)!, registroDaHipotese({ ...f, id: 'h2' }, 1)!].map((r) => r.dados.name);
  assert.deepEqual(nomes, ['Financiamento da hipótese 1', 'Financiamento da hipótese 2']);
});

test('o que falta: valor, conta no parcelado e no financiamento, parcelas', () => {
  assert.equal(faltaNaHipotese({ ...base, valor_cents: 0 }), 'Digite o valor');
  assert.equal(faltaNaHipotese({ ...base, forma: 'financiamento', conta: null }), 'Escolha a conta que paga');
  assert.equal(faltaNaHipotese({ ...base, forma: 'parcelado', parcelas: 1 }), 'Parcelado precisa de 2 parcelas ou mais');
  assert.equal(faltaNaHipotese(base), null);
  assert.equal(faltaNaHipotese({ ...base, conta: null }), null, 'uma vez sem conta vale: só muda a visão geral');
});

test('a linha diz forma, conta e data', () => {
  assert.equal(resumoDaHipotese({ ...base, forma: 'parcelado', valor_cents: 300000, parcelas: 10 }, brl, nome), 'Sai R$ 3000.00 em 10× · Nubank Cartão · a partir de 05/10/2026');
  assert.equal(resumoDaHipotese({ ...base, kind: 'income', forma: 'repete', repete: 'monthly', conta: null }, brl, nome), 'Entra R$ 100.00 todo mês · sem conta (só a visão geral) · a partir de 05/10/2026');
  assert.equal(resumoDaHipotese({ ...base, forma: 'financiamento', parcelas: 48, conta: 'c2' }, brl, nome), 'Financiamento de 48× R$ 100.00 · Itaú · 1ª em 05/10/2026');
  assert.equal(resumoDaHipotese({ ...base, conta: 'sumiu' }, brl, nome), 'Sai R$ 100.00 · conta que não existe mais · em 05/10/2026');
});

test('aplicar abre o formulário certo, com tudo', () => {
  assert.deepEqual(paramsDoAplicar(base), { pathname: '/finance/lancar', params: { tipo: 'uma', deHipotese: 'h1', kind: 'expense', amount: '10000', data: '05/10/2026', parcelas: '1', conta: 'c1' } });
  assert.equal(paramsDoAplicar({ ...base, forma: 'parcelado', parcelas: 10 }).params.parcelas, '10');
  assert.deepEqual(paramsDoAplicar({ ...base, forma: 'repete', repete: 'weekly' }), { pathname: '/finance/lancar', params: { tipo: 'recorrente', deHipotese: 'h1', kind: 'expense', amount: '10000', start: '05/10/2026', account: 'c1', repete: 'weekly' } });
  assert.deepEqual(paramsDoAplicar({ ...base, forma: 'financiamento', parcelas: 48 }), { pathname: '/finance/lancar', params: { tipo: 'financiamento', deHipotese: 'h1', parcela: '10000', parcelas: '48', conta: 'c1', data: '05/10/2026' } });
  assert.deepEqual(paramsDoAplicar({ ...base, conta: null }).params, { tipo: 'uma', deHipotese: 'h1', kind: 'expense', amount: '10000', data: '05/10/2026', parcelas: '1' });
});

test('hipótese com data que já passou vale a partir de HOJE: na simulação, na linha e no Aplicar (revisão final)', () => {
  // O rascunho mora no aparelho: "Entra R$ 2.000 em 29/09" ainda está lá em 03/10. Com a data
  // crua, a receita atrasada saía da projeção e a parcela caía numa fatura já fechada, em silêncio.
  const hoje = localISODate();
  const velha = { ...base, data: '2020-01-01' };
  assert.equal(((registroDaHipotese(velha, 0)!.dados.linhas as any[])[0]).occurred_at, hoje);
  assert.equal(registroDaHipotese({ ...velha, forma: 'parcelado', parcelas: 3 }, 0)!.dados.p_occurred_at, hoje);
  assert.equal(paramsDoAplicar(velha).params.data, isoToBR(hoje));
  assert.match(resumoDaHipotese(velha, brl, nome), new RegExp(isoToBR(hoje)));
  assert.equal(dataDaHipotese(velha), hoje);
  assert.equal(dataDaHipotese({ ...base, data: '2099-01-01' }), '2099-01-01');
});

test('Aplicar de uma data futura fora do cartão nasce A PAGAR, como foi simulado (revisão final)', () => {
  // "Sai R$ 800 em 20/10, conta corrente" → Aplicar → Salvar gravava PAGO, e o saldo mexia hoje.
  assert.deepEqual(pendenciaDoAplicar('20/10/2026', 'checking', '2026-09-29'), { pending: true, due_at: '20/10/2026' });
  assert.deepEqual(pendenciaDoAplicar('20/10/2026', null, '2026-09-29'), { pending: true, due_at: '20/10/2026' }, 'sem conta também');
  // no cartão quem decide é a fatura; hoje e no passado é o lançamento comum
  assert.deepEqual(pendenciaDoAplicar('20/10/2026', 'credit_card', '2026-09-29'), { pending: false, due_at: null });
  assert.deepEqual(pendenciaDoAplicar('29/09/2026', 'checking', '2026-09-29'), { pending: false, due_at: null });
  assert.deepEqual(pendenciaDoAplicar(undefined, 'checking', '2026-09-29'), { pending: false, due_at: null });
});
