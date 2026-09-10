/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { STORE_PRODUCTS, planForProduct } from './billing.ts';

/**
 * Os ids de produto do lado do SERVIDOR, lidos do dicionário Python.
 *
 * ⚠️ **O alvo mudou em 09/09/2026, e a proteção continua a mesma.** Isto lia
 * `supabase/functions/_shared/billing.ts` — a cópia Deno, que foi apagada quando o corte
 * Strangler terminou. Quem recebe o webhook da RevenueCat hoje é `/hooks/billing` no agente, e
 * é `plan_for_product()` de `agent/app/domain/billing.py` que traduz id de produto em plano.
 *
 * Deletar o teste junto com a cópia teria sido o erro fácil: o que ele protege não era "o Deno
 * está igual", era **"a loja aprova uma compra que o servidor não sabe traduzir"** — e esse
 * risco não mudou de forma nenhuma, só de arquivo.
 */
function parseProdutosDoAgente(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/STORE_PRODUCTS[^=]*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, `não achei STORE_PRODUCTS em ${path}`);
  return [...match[1].matchAll(/["']([^"']+)["']\s*:/g)].map((m) => m[1]);
}

test('o agente Python usa exatamente os mesmos produtos do app', () => {
  // Duplicação inevitável (Python não importa de src/) — este teste é a trava.
  const noAgente = parseProdutosDoAgente('agent/app/domain/billing.py');
  assert.deepEqual(noAgente, STORE_PRODUCTS.map((p) => p.id));
});

/*
  ⚠️ **`ENTITLEMENT_ID` e `TRIAL_DAYS` perderam o par, e isso é correto — não é buraco.**

  A Edge Function comparava os dois porque ela reimplementava a regra. O agente não: o trial sai
  do `period_type == "TRIAL"` do próprio evento da RevenueCat, e o entitlement é resolvido dentro
  de `public._apply_entitlement`, no banco. Do lado do servidor esses dois nomes não existem mais.

  No app eles continuam sendo configuração do SDK da RevenueCat, e um teste de igualdade contra
  um lado que não tem o conceito seria teatro: passaria sempre, sem proteger nada.
*/

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
