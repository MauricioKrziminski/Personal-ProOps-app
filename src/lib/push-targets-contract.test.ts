/**
 * As duas metades do contrato de push: a `TARGETS` do servidor e a `ALLOWED` do app.
 *
 * ⚠️ **Alvo que existe só de um lado é caminho morto**, e o modo de falha não dá erro. Em
 * 14/09/2026 o app conhecia `transactions` e o servidor não: nenhum ramo de `target_for` devolvia
 * isso, e `send` reescreve para `today` o que não estiver em `TARGETS` — uma rota que o app sabia
 * abrir e ninguém nunca mandou. Na direção contrária é pior: o servidor manda um alvo que o app
 * não conhece, `routeFor` devolve `null` e **tocar na notificação não faz nada**.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const py = readFileSync(new URL('../../agent/app/services/push.py', import.meta.url), 'utf8');
const ts = readFileSync(new URL('./push-routes.ts', import.meta.url), 'utf8');

function alvosDoServidor(): string[] {
  const m = py.match(/^TARGETS = \(([^)]*)\)/m);
  assert.ok(m, 'TARGETS não encontrada em push.py — o formato mudou');
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
}

function alvosDoApp(): string[] {
  const m = ts.match(/const ALLOWED = \{([\s\S]*?)\} as const;/);
  assert.ok(m, 'ALLOWED não encontrada em notifications.ts — o formato mudou');
  return [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]).sort();
}

test('os alvos de push do servidor e do app são exatamente os mesmos', () => {
  assert.deepEqual(alvosDoApp(), alvosDoServidor());
});

test('todo alvo que `target_for` devolve está na allowlist do app', () => {
  // O que o servidor pode PRODUZIR, não só o que ele declara: um `return "x"` novo em
  // `target_for` sem a entrada no app faz o toque na notificação não levar a lugar nenhum.
  const devolvidos = [...py.matchAll(/return "(\w+)"/g)].map((x) => x[1]);
  assert.ok(devolvidos.length >= 4, 'target_for deixou de ter returns literais — revise o teste');
  for (const alvo of devolvidos) {
    assert.ok(alvosDoApp().includes(alvo), `target_for devolve "${alvo}" e o app não conhece`);
  }
});

test('o fechamento de ciclo tem alvo próprio, e ele é `cycle`', () => {
  assert.match(py, /kind\.startswith\("cycle"\)/);
  assert.ok(alvosDoApp().includes('cycle'));
  assert.match(ts, /cycle: '\/finance\/cycle'/);
});

test('o `ref` só vira parâmetro de rota depois de passar por regex de mês', () => {
  // `ref` vem de fora. A allowlist é o `target`; `ref` nunca escolhe PARA ONDE se navega.
  assert.match(ts, /const MES = \/\^\\d\{4\}-\\d\{2\}\(-\\d\{2\}\)\?\$\//);
  assert.match(ts, /MES\.test\(ref\)/);
});
