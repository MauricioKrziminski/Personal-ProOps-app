import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ondeMuda, type CartaoNoHorizonte, type ContaNoHorizonte, type MudancaNaConta, type MudancaNoCartao } from './onde-muda.ts';

const conta = (id: string | null, fim: number, neg: string | null = null, tipo: string | null = 'checking'): ContaNoHorizonte =>
  ({ account_id: id, nome: id ?? 'Sem conta', tipo, saldo_hoje: 1000, menor: Math.min(1000, fim), dia_do_menor: '2026-10-10', saldo_fim: fim, negativa_em: neg });
const cartao = (id: string, limite: number | null, livre: number | null, faturas: [string, number][]): CartaoNoHorizonte =>
  ({ account_id: id, nome: id, limite, livre, faturas: faturas.map(([v, t]) => ({ invoice_id: v, vencimento: v, total: t, aberto: t })) });

test('conta que muda aparece; conta igual e "sem conta" não', () => {
  const r = ondeMuda({ contas: [conta('a', 500), conta('b', 900), conta(null, 0)], cartoes: [] },
                     { contas: [conta('a', 300), conta('b', 900), conta(null, -100)], cartoes: [] });
  assert.deepEqual(r.map((m) => m.account_id), ['a']);
});

test('fica negativa: quando passa a ficar, ou fica MAIS CEDO', () => {
  const [a] = ondeMuda({ contas: [conta('a', 500)], cartoes: [] }, { contas: [conta('a', -100, '2026-11-02')], cartoes: [] }) as MudancaNaConta[];
  assert.equal(a.ficaNegativaEm, '2026-11-02');
  const [b] = ondeMuda({ contas: [conta('a', -50, '2026-12-01')], cartoes: [] }, { contas: [conta('a', -100, '2026-11-02')], cartoes: [] }) as MudancaNaConta[];
  assert.equal(b.ficaNegativaEm, '2026-11-02');
  const [c] = ondeMuda({ contas: [conta('a', -50, '2026-11-01')], cartoes: [] }, { contas: [conta('a', -100, '2026-11-01')], cartoes: [] }) as MudancaNaConta[];
  assert.equal(c.ficaNegativaEm, null, 'já ficava negativa no mesmo dia: não é aviso novo');
});

test('conta que só existe no depois (recebe a primeira movimentação) aparece com antes nulo', () => {
  const [m] = ondeMuda({ contas: [], cartoes: [] }, { contas: [conta('nova', 700)], cartoes: [] }) as MudancaNaConta[];
  assert.equal(m.antes, null);
});

test('cartão: faturas antes → depois pelo vencimento, fatura nova conta do zero', () => {
  const [m] = ondeMuda({ contas: [], cartoes: [cartao('nu', 500000, 200000, [['2026-10-10', 135000]])] },
                       { contas: [], cartoes: [cartao('nu', 500000, 170000, [['2026-10-10', 165000], ['2026-11-10', 30000]])] }) as MudancaNoCartao[];
  assert.deepEqual(m.faturas, [{ vencimento: '2026-10-10', antes: 135000, depois: 165000 }, { vencimento: '2026-11-10', antes: 0, depois: 30000 }]);
  assert.equal(m.livreAntes, 200000);
  assert.equal(m.livreDepois, 170000);
  assert.equal(m.passaDoLimiteEm, null);
  assert.equal(m.semLimite, false);
});

test('passa do limite: quanto; sem limite: nunca "passa", diz que não tem', () => {
  const [p] = ondeMuda({ contas: [], cartoes: [cartao('nu', 100000, 20000, [])] }, { contas: [], cartoes: [cartao('nu', 100000, -30000, [['2026-10-10', 130000]])] }) as MudancaNoCartao[];
  assert.equal(p.passaDoLimiteEm, 30000);
  const [s] = ondeMuda({ contas: [], cartoes: [cartao('d', null, null, [])] }, { contas: [], cartoes: [cartao('d', null, null, [['2026-10-10', 5000]])] }) as MudancaNoCartao[];
  assert.equal(s.semLimite, true);
  assert.equal(s.passaDoLimiteEm, null);
});

test('cartão que não muda não aparece; conta do tipo cartão no horizonte de contas não aparece', () => {
  assert.deepEqual(ondeMuda({ contas: [conta('nu', 0, null, 'credit_card')], cartoes: [cartao('nu', 1, 1, [['2026-10-10', 1]])] },
                            { contas: [conta('nu', -9, null, 'credit_card')], cartoes: [cartao('nu', 1, 1, [['2026-10-10', 1]])] }), []);
});

test('contas antes dos cartões, na ordem em que vieram', () => {
  const r = ondeMuda({ contas: [conta('b', 1), conta('a', 1)], cartoes: [cartao('nu', null, null, [])] },
                     { contas: [conta('b', 2), conta('a', 2)], cartoes: [cartao('nu', null, null, [['2026-10-10', 1]])] });
  assert.deepEqual(r.map((m) => [m.tipo, m.account_id]), [['conta', 'b'], ['conta', 'a'], ['cartao', 'nu']]);
});
