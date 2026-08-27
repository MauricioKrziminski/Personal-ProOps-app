/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ENTITLEMENT_ID, STORE_PRODUCTS, TRIAL_DAYS, planForProduct } from './billing.ts';

/** Extrai os ids literais de `export const STORE_PRODUCTS = [...]`. */
function parseProdutosDe(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/export const STORE_PRODUCTS[^=]*= \[([\s\S]*?)\n\];/);
  assert.ok(match, `não achei STORE_PRODUCTS em ${path}`);
  return [...match[1].matchAll(/id:\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

test('a Edge Function usa exatamente os mesmos produtos do app', () => {
  // Duplicação inevitável (Deno não importa de src/) — este teste é a trava.
  // Divergir aqui = compra aprovada pela loja que o webhook não sabe traduzir.
  const naFunction = parseProdutosDe('supabase/functions/_shared/billing.ts');
  assert.deepEqual(naFunction, STORE_PRODUCTS.map((p) => p.id));
});

test('entitlement e trial batem entre app e function', () => {
  const source = readFileSync('supabase/functions/_shared/billing.ts', 'utf8');
  assert.ok(
    source.includes(`ENTITLEMENT_ID = "${ENTITLEMENT_ID}"`),
    'ENTITLEMENT_ID divergiu da Edge Function',
  );
  assert.ok(
    source.includes(`TRIAL_DAYS = ${TRIAL_DAYS}`),
    'TRIAL_DAYS divergiu da Edge Function',
  );
});

test('produto desconhecido nunca vira plano pago', () => {
  // O caso que importa: id errado no App Store Connect não pode conceder nada.
  assert.equal(planForProduct('proops.personal.pro.mensal'), null);
  assert.equal(planForProduct(''), null);
  assert.equal(planForProduct(null), null);
  assert.equal(planForProduct(undefined), null);
});

test('cada produto mapeia para o plano certo', () => {
  assert.equal(planForProduct('proops.personal.pro.monthly'), 'pro');
  assert.equal(planForProduct('proops.personal.pro.annual'), 'pro');
  assert.equal(planForProduct('proops.personal.family.monthly'), 'family');
  assert.equal(planForProduct('proops.personal.family.annual'), 'family');
});

test('ids são únicos e existe mensal e anual para cada plano', () => {
  const ids = STORE_PRODUCTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id de produto repetido');

  for (const plan of ['pro', 'family'] as const) {
    const doPlano = STORE_PRODUCTS.filter((p) => p.plan === plan);
    assert.ok(
      doPlano.some((p) => p.period === 'monthly'),
      `${plan} sem produto mensal`,
    );
    assert.ok(
      doPlano.some((p) => p.period === 'annual'),
      `${plan} sem produto anual`,
    );
  }
});
