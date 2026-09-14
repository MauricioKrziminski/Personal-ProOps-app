/** `node --test`. Fronteira de confiança: o `data` do push é escrito por quem manda. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeFor } from './push-routes.ts';

test('o fechamento abre O CICLO QUE FECHOU, não o corrente', () => {
  // `ref` é a data de FIM do ciclo — um dia do MEIO do mês. Isso só resolve para o ciclo certo
  // porque `mesmoMes`/`primeiroDiaDoMes` normalizam; antes disso a tela abria vazia.
  assert.deepEqual(routeFor({ target: 'cycle', ref: '2026-09-10' }), {
    pathname: '/finance/cycle',
    params: { month: '2026-09-10' },
  });
});

test('`ref` que não é mês é IGNORADO — a rota abre sem parâmetro', () => {
  for (const ref of ['../../etc/passwd', '/finance/plan', '2026', 'setembro', '']) {
    assert.deepEqual(
      routeFor({ target: 'cycle', ref }),
      { pathname: '/finance/cycle' },
      `ref ${JSON.stringify(ref)} não podia virar parâmetro`,
    );
  }
});

test('`ref` nunca escolhe PARA ONDE se navega — só o `target` faz isso', () => {
  // Um `ref` de mês num alvo que não é `cycle` não vira parâmetro de nada.
  assert.deepEqual(routeFor({ target: 'cards', ref: '2026-09-10' }), {
    pathname: '/finance/cards',
  });
});

test('alvo fora da allowlist não navega', () => {
  for (const target of ['/finance/plan', 'toString', 'constructor', '__proto__', 'transactions']) {
    assert.equal(routeFor({ target }), null, `alvo ${target} passou`);
  }
});

test('`toString` não devolve uma FUNÇÃO para o router', () => {
  // `in` anda pela cadeia de protótipos; `Object.hasOwn` não. Sem isso o app crashava ao tocar.
  const r = routeFor({ target: 'toString' });
  assert.equal(r, null);
});

test('data ausente, vazio ou de tipo errado não navega', () => {
  assert.equal(routeFor(null), null);
  assert.equal(routeFor(undefined), null);
  assert.equal(routeFor({}), null);
  assert.equal(routeFor('cycle'), null);
  assert.equal(routeFor({ target: 42 }), null);
});

test('os alvos que o servidor produz hoje todos resolvem', () => {
  for (const target of ['today', 'reminders', 'budgets', 'cards', 'forecast', 'cycle']) {
    assert.ok(routeFor({ target })?.pathname, `${target} não resolveu`);
  }
});
