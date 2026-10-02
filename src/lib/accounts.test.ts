import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountSelectOptions, accountLabel, inicialParaOSaldo, saldoDaConta } from './accounts.ts';

test('o cartão diz que é cartão — foi o que custou R$ 4.000 em produção', () => {
  // As quatro contas reais de 09/09/2026, na ordem em que apareciam no seletor.
  assert.equal(accountLabel({ name: 'Conta corrente', type: 'checking' }), 'Conta corrente');
  assert.equal(accountLabel({ name: 'Conta corrente BB', type: 'checking' }), 'Conta corrente BB');
  assert.equal(accountLabel({ name: 'BB', type: 'credit_card' }), 'BB · Cartão');
  assert.equal(accountLabel({ name: 'Nubank', type: 'credit_card' }), 'Nubank · Cartão');
});

test('nome que já diz o tipo não repete', () => {
  // Repetir ensina o usuário a ignorar o sufixo, que é onde a informação mora.
  assert.equal(accountLabel({ name: 'Cartão Nubank', type: 'credit_card' }), 'Cartão Nubank');
  assert.equal(accountLabel({ name: 'cartao inter', type: 'credit_card' }), 'cartao inter');
  assert.equal(accountLabel({ name: 'Poupança', type: 'savings' }), 'Poupança');
});

test('os outros tipos também aparecem — a regra não é só sobre cartão', () => {
  assert.equal(accountLabel({ name: 'Nubank', type: 'savings' }), 'Nubank · Poupança');
  assert.equal(accountLabel({ name: 'Carteira', type: 'cash' }), 'Carteira · Dinheiro');
  assert.equal(accountLabel({ name: 'XP', type: 'investment' }), 'XP · Investimento');
});

test('sem conta e tipo desconhecido não quebram a tela', () => {
  assert.equal(accountLabel(null), 'Sem conta');
  assert.equal(accountLabel(undefined), 'Sem conta');
  assert.equal(accountLabel({ name: 'Alguma', type: null }), 'Alguma');
  assert.equal(accountLabel({ name: 'Alguma', type: 'coisa_nova' }), 'Alguma');
});

test('O saldo de UMA conta: dinheiro mostra o confirmado; cartão, o total (24/09/2026)', () => {
  // "meu pai… como acessar saldo de uma conta específica": o extrato da conta mostrava só os
  // totais do período. A régua é a mesma da tela Contas — uma função, as duas telas.
  const corrente = { type: 'checking', balance_cents: 50000, cleared_cents: 30000, pending_in_cents: 20000, pending_out_cents: 0 };
  assert.deepEqual(saldoDaConta(corrente), { cents: 30000, previsto: 20000, rotulo: 'Saldo', previstoTexto: 'a receber' });
  const cartao = { type: 'credit_card', balance_cents: -90000, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 60000 };
  assert.deepEqual(saldoDaConta(cartao), { cents: -90000, previsto: 60000, rotulo: 'Saldo do cartão', previstoTexto: 'a vencer' });
});

test('editar o saldo atual anda o inicial pela diferença, e sem mexer não muda nada', () => {
  // O Nubank de produção (28/09/2026): inicial 867,86, a lista mostra 162,51.
  assert.equal(inicialParaOSaldo(16251, 16251, 86786), 86786);
  // A pessoa corrige para o que o banco mostra (200,00): o atual vira 200,00.
  const inicial = inicialParaOSaldo(20000, 16251, 86786);
  assert.equal(inicial, 90535);
  assert.equal(inicial + (16251 - 86786), 20000, 'inicial + lançamentos = o digitado');
  // Pode ficar negativo (conta no cheque especial).
  assert.equal(inicialParaOSaldo(-5000, 16251, 86786), 86786 - 21251);
});


test('filtros e formulários distinguem cartão, conta histórica e ausência com o mesmo seletor', () => {
  const options = accountSelectOptions([
    { id: 'card', name: 'Nubank', type: 'credit_card', closing_day: 10 },
    { id: 'bank', name: 'Nubank', type: 'checking', archived: true },
  ], 'Sem conta', 'none');
  assert.deepEqual(options.map(o => o.id), ['none', 'bank', 'card']);
  assert.equal(options[0].neutral, true);
  assert.equal(options[1].meta, 'Corrente · arquivada');
  assert.equal(options[1].group, 'CONTAS');
  assert.equal(options[2].meta, 'Cartão · fecha dia 10');
  assert.equal(options[2].group, 'CARTÕES');
  assert.equal(options[2].icon, 'creditcard');
  assert.equal(accountSelectOptions([{ id: 'cash', name: 'Carteira', type: 'cash' }])[0].group, undefined);
});


test('F02: confirma origem por UUID e compatibilidade atual, sem adotar por nome', async () => {
  const lib = await import('./accounts.ts');
  const card = { id: 'created-card', availability: 'active', account: { id: 'created-card', type: 'credit_card', archived: false } };
  assert.equal(lib.createdAccountSelection(card, ['credit_card']), 'created-card');
  assert.equal(lib.createdAccountSelection(card, ['checking', 'savings']), null, 'método mudou para débito enquanto o cadastro respondia');
});

test('F02: resultado tardio, arquivado, apagado ou com identidade divergente não sobrescreve origem', async () => {
  const lib = await import('./accounts.ts');
  const result = { id: 'created', availability: 'active', account: { id: 'created', type: 'checking', archived: false } };
  assert.equal(lib.createdAccountSelection(result, ['checking'], false), null);
  assert.equal(lib.createdAccountSelection({ ...result, availability: 'archived' }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, availability: 'unavailable', account: null }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, account: { ...result.account, archived: true } }, ['checking']), null);
  assert.equal(lib.createdAccountSelection({ ...result, account: { ...result.account, id: 'other' } }, ['checking']), null);
});


const f03Accounts = [
  { id: 'bank', name: 'Corrente teste', type: 'checking' },
  { id: 'card', name: 'Cartão teste', type: 'credit_card', closing_day: 28, credit_limit_cents: 100000 },
];
const f03Balance = { account_id: 'bank', cleared_cents: -1250, balance_cents: 48750, pending_in_cents: 50000, pending_out_cents: 0 };
const f03Card = { account_id: 'card', credit_limit_cents: 100000, available_limit_cents: 19400, invoice_total_cents: 30000, limit_status: 'available' };
const f03Query = (data: any[], other: any = {}) => ({ data, isPending: false, isError: false, isFetching: false, isPaused: false, ...other });
function f03Options(other: any = {}, accounts: any[] = f03Accounts) {
  return (accountSelectOptions as any)(accounts, 'Sem conta', null, {
    balances: f03Query([f03Balance]), cards: f03Query([f03Card]),
    format: (cents: number) => `${cents} centavos`, concealed: false, ...other,
  });
}

test('F03: saldo é confirmado com sinal; limite vem de todas as obrigações, não da fatura visível', () => {
  const options = f03Options();
  assert.equal(options[0].detail, undefined, 'Sem conta não representa saldo zero');
  assert.equal(options[1].detail, 'Saldo no ProOps −1250 centavos');
  assert.equal(options[2].detail, 'Limite disponível 19400 centavos');
  assert.equal(options[2].meta, 'Cartão · fecha dia 28');
});

test('F03: zero explícito é um valor; limite ausente não é zero nem ilimitado', () => {
  assert.equal(f03Options({ balances: f03Query([{ ...f03Balance, cleared_cents: 0 }]) })[1].detail, 'Saldo no ProOps 0 centavos');
  assert.equal(f03Options({ cards: f03Query([{ ...f03Card, credit_limit_cents: 0, available_limit_cents: 0 }]) })[2].detail, 'Limite disponível 0 centavos');
  assert.equal(f03Options({}, [f03Accounts[0], { ...f03Accounts[1], credit_limit_cents: null }])[2].detail, 'Limite não cadastrado');
  assert.equal(f03Options({ cards: f03Query([{ ...f03Card, credit_limit_cents: null, available_limit_cents: 0 }]) })[2].detail, 'Limite não cadastrado');
});

test('F03: carregamento, erro e pausa conservam opções sem inventar dinheiro', () => {
  const cases = [
    [{ data: undefined, isPending: true }, 'Carregando saldo…'],
    [{ isError: true }, 'Saldo indisponível'],
    [{ isPaused: true }, 'Saldo aguardando conexão'],
    [{ data: [] }, 'Saldo indisponível'],
  ];
  for (const [state, detail] of cases) {
    const option = f03Options({ balances: f03Query([f03Balance], state) })[1];
    assert.equal(option.detail, detail);
    assert.equal(option.id, 'bank');
    assert.equal(option.disabled, undefined);
  }
  assert.equal(f03Options({ cards: f03Query([f03Card], { isPending: true, data: undefined }) })[2].detail, 'Carregando limite…');
  assert.equal(f03Options({ cards: f03Query([f03Card], { isError: true }) })[2].detail, 'Limite indisponível');
});

test('F03: refetch tem valor sinalizado; erro posterior não apresenta cache antigo como atual', () => {
  assert.equal(f03Options({ balances: f03Query([f03Balance], { isFetching: true }) })[1].detail, 'Saldo no ProOps −1250 centavos · atualizando');
  assert.equal(f03Options({ balances: f03Query([f03Balance], { isFetching: true, isError: true }) })[1].detail, 'Saldo indisponível');
});

test('F03: inteiro seguro é obrigatório; strings SQL inteiras são aceitas sem perda', () => {
  for (const bad of [null, undefined, '', '1.2', 'abc', NaN, Infinity, 1.5, 9007199254740992, '9007199254740993']) {
    assert.equal(f03Options({ balances: f03Query([{ ...f03Balance, cleared_cents: bad }]) })[1].detail, 'Saldo indisponível');
    assert.equal(f03Options({ cards: f03Query([{ ...f03Card, available_limit_cents: bad }]) })[2].detail, 'Limite indisponível');
  }
  assert.equal(f03Options({ balances: f03Query([{ ...f03Balance, cleared_cents: '-1250' }]) })[1].detail, 'Saldo no ProOps −1250 centavos');
});

test('F03: ocultação fixa protege saldo, sinal e limite sem chamar o formatador', () => {
  const options = f03Options({ concealed: true, format() { throw new Error('Não deve formatar valor oculto'); } });
  assert.equal(options[1].detail, 'Saldo no ProOps ••••••');
  assert.equal(options[2].detail, 'Limite disponível ••••••');
  assert.ok(!JSON.stringify(options).includes('1250'));
  assert.ok(!JSON.stringify(options).includes('19400'));
});

test('F03: conta arquivada não recebe número atual e consulta por ID distingue nomes iguais', () => {
  assert.equal(f03Options({}, [{ ...f03Accounts[0], archived: true }])[1].detail, undefined);
  const options = f03Options({ balances: f03Query([f03Balance, { ...f03Balance, account_id: 'other', cleared_cents: 42 }]) },
    [f03Accounts[0], { ...f03Accounts[0], id: 'other' }]);
  assert.equal(options[1].detail, 'Saldo no ProOps −1250 centavos');
  assert.equal(options[2].detail, 'Saldo no ProOps 42 centavos');
});


test('F03: exposição legada incompleta não anuncia limite disponível canônico', () => {
  const options = f03Options({ cards: f03Query([{ ...f03Card, limit_status: 'needs_review', available_limit_cents: null }]) });
  assert.equal(options[2].detail, 'Limite precisa de conferência');
  assert.equal(options[2].detailUnavailable, undefined, 'Refetch não resolve uma ambiguidade contábil');
});


test('F03: contrato de qualidade inválido não apresenta número como confirmado', () => {
  for (const limit_status of [undefined, null, 'unexpected']) {
    assert.equal(f03Options({ cards: f03Query([{ ...f03Card, limit_status }]) })[2].detail, 'Limite indisponível');
  }
});
