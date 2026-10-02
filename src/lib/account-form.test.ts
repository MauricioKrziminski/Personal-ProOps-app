import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccountForm, accountFormFromAccount, accountFormErrors, accountFormPayload, accountFormErrorMessage } from './account-form.ts';

test('shared account defaults are fresh, zero-valued and respect the chosen type', () => {
  assert.equal(emptyAccountForm('credit_card').type, 'credit_card');
  const first = emptyAccountForm(); first.name = 'Changed';
  assert.equal(emptyAccountForm().name, '');
  assert.equal(emptyAccountForm().saldoCents, 0);
});

test('account editing initializes current balance and preserves the existing initial adjustment', () => {
  const form = accountFormFromAccount({ id: 'a', name: 'Nubank', type: 'checking', initial_balance_cents: 86786 }, 16251);
  assert.equal(form.saldoCents, 16251);
  assert.equal(accountFormPayload(form).initial_balance_cents, 86786);
  assert.equal(accountFormPayload({ ...form, saldoCents: 20000 }).initial_balance_cents, 90535);
  assert.equal(accountFormPayload({ ...form, negativo: true, saldoCents: 5000 }).initial_balance_cents, 65535);
});

test('account validation rejects fractional unsafe or negative money and unsafe adjustment', () => {
  const valid = { ...emptyAccountForm(), name: ' Conta ' };
  assert.deepEqual(accountFormErrors(valid), {});
  for (const saldoCents of [1.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(accountFormErrors({ ...valid, saldoCents }).saldoCents);
    assert.throws(() => accountFormPayload({ ...valid, saldoCents }));
  }
  assert.ok(accountFormErrors({ ...valid, saldoCents: 1, base: { atual: -1, inicial: Number.MAX_SAFE_INTEGER } }).saldoCents);
  assert.ok(accountFormErrors({ ...valid, name: '   ' }).name);
});

test('card days are integers 1 through 31, limit safe nonnegative and rate a percentage', () => {
  const card = { ...emptyAccountForm('credit_card'), name: 'Cartão', closingDay: '31', dueDay: '1', rotativoRate: '15,5' };
  assert.deepEqual(accountFormErrors(card), {});
  assert.equal(accountFormPayload(card).rotativo_rate_monthly, 0.155);
  for (const closingDay of ['0', '32', '1.5', '1e1', '']) assert.ok(accountFormErrors({ ...card, closingDay }).closingDay);
  for (const rotativoRate of ['-1', '101', 'NaN', '1,2,3', '1e1']) assert.ok(accountFormErrors({ ...card, rotativoRate }).rotativoRate);
  assert.ok(accountFormErrors({ ...card, limitCents: -1 }).limitCents);
  assert.equal(accountFormPayload({ ...card, rotativoRate: '100' }).rotativo_rate_monthly, 1);
  assert.equal(accountFormPayload({ ...card, rotativoRate: '' }).rotativo_rate_monthly, null);
});

test('noncard payload clears card fields and only checking uses a negative sign', () => {
  const form = { ...emptyAccountForm('savings'), name: ' Banco ', saldoCents: 500, negativo: true, closingDay: 'bad', dueDay: '32', limitCents: 2000, rotativoAuto: true, fechamentoInclusivo: true, payerId: 'payer', rotativoRate: 'bad' };
  const payload = accountFormPayload(form);
  assert.equal(payload.name, 'Banco');
  assert.equal(payload.initial_balance_cents, 500);
  assert.equal(payload.closing_day, null);
  assert.equal(payload.due_day, null);
  assert.equal(payload.credit_limit_cents, null);
  assert.equal(payload.payment_account_id, null);
  assert.equal(payload.rotativo_auto, false);
  assert.equal(payload.closing_day_inclusive, false);
  assert.equal(payload.rotativo_rate_monthly, null);
});

test('duplicate name error differs from network and preserves intentional domain errors', () => {
  assert.match(accountFormErrorMessage({ code: '23505' }), /Já existe uma conta com esse nome/);
  assert.equal(accountFormErrorMessage(new Error('offline')), 'Não deu para salvar a conta. Tente de novo.');
  assert.equal(accountFormErrorMessage({ code: 'P0001', message: 'Escolha uma conta ativa' }), 'Escolha uma conta ativa');
});


test('new cards discard hidden bank balances and card edits preserve their seed despite debt', () => {
  assert.equal(accountFormPayload({ ...emptyAccountForm('credit_card'), name: 'Card', closingDay: '3', dueDay: '10', saldoCents: 90000 }).initial_balance_cents, 0);
  for (const initial_balance_cents of [0, -1000, 2000]) {
    const form = accountFormFromAccount({ id: 'c', name: 'Card', type: 'credit_card', initial_balance_cents, closing_day: 3, due_day: 10 }, -45000);
    assert.equal(accountFormPayload(form).initial_balance_cents, initial_balance_cents);
  }
});


test('bank to card without transactions preserves the existing signed seed instead of discarding cash', () => {
  // tg_accounts_tipo allows this family change only without transactions. account_balances
  // sums the same signed seed for either type: changing it to zero would erase the balance.
  for (const initial_balance_cents of [-1000, 0, 25000]) {
    for (const current of [initial_balance_cents, undefined]) {
      const bank = accountFormFromAccount({ id: 'bank', name: 'Bank', type: 'checking', initial_balance_cents }, current);
      const card = accountFormPayload({ ...bank, type: 'credit_card', closingDay: '3', dueDay: '10' });
      assert.equal(card.id, 'bank');
      assert.equal(card.initial_balance_cents, initial_balance_cents);
      // A hidden prior balance edit cannot invent a card seed.
      assert.equal(accountFormPayload({ ...bank, type: 'credit_card', closingDay: '3', dueDay: '10', saldoCents: 90000 }).initial_balance_cents, initial_balance_cents);
    }
  }
});

test('card to checking without transactions preserves signed balance and clears card-specific fields', () => {
  for (const initial_balance_cents of [-1000, 0, 25000]) {
    for (const current of [initial_balance_cents, undefined]) {
      const card = accountFormFromAccount({ id: 'card', name: 'Card', type: 'credit_card', initial_balance_cents, closing_day: 3, due_day: 10, credit_limit_cents: 100000, payment_account_id: 'payer', closing_day_inclusive: true, rotativo_auto: true, rotativo_rate_monthly: 0.1 }, current);
      const bank = accountFormPayload({ ...card, type: 'checking' });
      assert.equal(bank.id, 'card');
      assert.equal(bank.initial_balance_cents, initial_balance_cents);
      assert.equal(bank.closing_day, null);
      assert.equal(bank.due_day, null);
      assert.equal(bank.credit_limit_cents, null);
      assert.equal(bank.payment_account_id, null);
      assert.equal(bank.closing_day_inclusive, false);
      assert.equal(bank.rotativo_auto, false);
      assert.equal(bank.rotativo_rate_monthly, null);
    }
  }
});

test('editing a negative account cannot silently flip its sign by selecting an unsigned type', () => {
  const bank = accountFormFromAccount({ id: 'bank', name: 'Bank', type: 'checking', initial_balance_cents: -1000 }, -1000);
  const card = accountFormFromAccount({ id: 'card', name: 'Card', type: 'credit_card', initial_balance_cents: -1000, closing_day: 3, due_day: 10 }, -1000);
  for (const original of [bank, card]) {
    for (const type of ['cash', 'savings', 'investment'] as const) {
      const changed = { ...original, type };
      assert.equal(accountFormErrors(changed).saldoCents, 'A conta está no vermelho. Use Corrente ou ajuste o saldo antes de mudar o tipo.');
      assert.throws(() => accountFormPayload(changed), /A conta está no vermelho/);
      // Checking's explicit Positive choice clears the sign before switching types.
      const corrected = accountFormPayload({ ...changed, saldoCents: 2000, negativo: false });
      assert.equal(corrected.initial_balance_cents, 2000);
    }
  }
  // New drafts still use unsigned amount intentionally when selecting these types.
  assert.equal(accountFormPayload({ ...emptyAccountForm('cash'), name: 'Cash', negativo: true, saldoCents: 1000 }).initial_balance_cents, 1000);
});
