import assert from 'node:assert/strict';
import test from 'node:test';

import { caixaDasContas, type SaldoDeConta } from './account-cash.ts';
import { diasDoCiclo, ritmoDoDia } from './today-spend.ts';

const saldo = (p: Partial<SaldoDeConta> & { name: string }): SaldoDeConta => ({
  account_id: p.name,
  type: 'checking',
  balance_cents: 0,
  cleared_cents: 0,
  pending_in_cents: 0,
  pending_out_cents: 0,
  ...p,
});

test('o total é a soma EXATA das linhas mostradas', () => {
  const c = caixaDasContas([
    saldo({ name: 'Nubank', cleared_cents: 120_00 }),
    saldo({ name: 'Cofre', type: 'savings', cleared_cents: 500_00 }),
    saldo({ name: 'Carteira', type: 'cash', cleared_cents: 35_00 }),
  ]);
  assert.equal(c.total, 655_00);
  assert.equal(
    c.linhas.reduce((s, l) => s + l.cents, 0),
    c.total
  );
});

test('cartão e investimento ficam de fora — não são caixa', () => {
  const c = caixaDasContas([
    saldo({ name: 'Conta', cleared_cents: 100_00 }),
    saldo({ name: 'Cartão', type: 'credit_card', cleared_cents: -900_00, balance_cents: -900_00 }),
    saldo({ name: 'CDB', type: 'investment', cleared_cents: 10_000_00 }),
  ]);
  assert.equal(c.total, 100_00);
  assert.deepEqual(
    c.linhas.map((l) => l.nome),
    ['Conta']
  );
});

test('o lançamento SEM conta entra como linha, e por isso o total continua fechando', () => {
  const c = caixaDasContas([
    saldo({ name: 'Conta', cleared_cents: 100_00 }),
    { ...saldo({ name: 'ignorado' }), account_id: null, name: '', type: 'none', cleared_cents: 300_00 },
  ]);
  assert.equal(c.total, 400_00);
  assert.deepEqual(
    c.linhas.map((l) => l.nome),
    ['Sem conta', 'Conta']
  );
});

test('o que ainda vai cair não entra no total — ele vira aReceber', () => {
  const c = caixaDasContas([saldo({ name: 'Conta', cleared_cents: 100_00, pending_in_cents: 4_000_00 })]);
  assert.equal(c.total, 100_00);
  assert.equal(c.aReceber, 4_000_00);
});

test('conta zerada e sem nada a receber não vira linha', () => {
  const c = caixaDasContas([
    saldo({ name: 'Viva', cleared_cents: 10_00 }),
    saldo({ name: 'Morta' }),
    saldo({ name: 'Só a receber', pending_in_cents: 50_00 }),
  ]);
  assert.deepEqual(
    c.linhas.map((l) => l.nome),
    ['Viva', 'Só a receber']
  );
});

test('a média do ritmo EXCLUI hoje — senão o estouro levanta a própria régua', () => {
  // 5 dias decorridos, R$ 400 no ciclo, R$ 200 hoje → os 4 dias anteriores somaram 200 = 50/dia.
  const r = ritmoDoDia({ hojeCents: 200_00, cicloCents: 400_00, diasDecorridos: 5 });
  assert.equal(r.media, 50_00);
  assert.equal(r.acima, true);
  // Se hoje entrasse na conta, a média seria 80 e o dia continuaria "acima" — mas por menos.
  assert.notEqual(r.media, Math.round(400_00 / 5));
});

test('no primeiro dia do ciclo não há com o que comparar', () => {
  const r = ritmoDoDia({ hojeCents: 200_00, cicloCents: 200_00, diasDecorridos: 1 });
  assert.equal(r.media, null);
  assert.equal(r.acima, false);
});

test('dia parado fica abaixo da média, sem virar negativo', () => {
  const r = ritmoDoDia({ hojeCents: 0, cicloCents: 300_00, diasDecorridos: 4 });
  assert.equal(r.media, 100_00);
  assert.equal(r.acima, false);
});

test('diasDoCiclo conta hoje e atravessa mês', () => {
  assert.equal(diasDoCiclo('2026-09-11', '2026-09-11'), 1);
  assert.equal(diasDoCiclo('2026-09-11', '2026-09-17'), 7);
  assert.equal(diasDoCiclo('2026-08-28', '2026-09-02'), 6);
});
