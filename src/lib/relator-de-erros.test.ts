/** `node --test`: fila de relato de erros — dedupe, erro esperado, lote, crash imediato e nunca em laço. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chaveLocal, criarRelator, descrever, ehEsperado, MAX_POR_LOTE, type Relato } from './relator-de-erros.ts';

function montar(extra: { ligado?: boolean; falhar?: boolean } = {}) {
  const lotes: Relato[][] = [];
  const agendados: (() => void)[] = [];
  let t = 1_000_000;
  const estado = { ligado: extra.ligado ?? true, falhar: extra.falhar ?? false, tentativas: 0 };
  const r = criarRelator({
    ligado: () => estado.ligado,
    meta: () => ({ platform: 'ios', app_version: '1.4.0', route: '/hoje' }),
    enviar: async (lote) => {
      estado.tentativas++;
      if (estado.falhar) throw new Error('rede');
      lotes.push(lote);
    },
    agora: () => t,
    agendar: (fn) => agendados.push(fn),
  });
  return { r, lotes, agendados, estado, avancar: (ms: number) => (t += ms), disparar: async () => { agendados.splice(0).forEach((f) => f()); await r.esvaziar(); } };
}

test('desligado não enfileira nada', async () => {
  const m = montar({ ligado: false });
  m.r.relatar(new Error('x'));
  assert.equal(m.r.tamanhoDaFila(), 0);
  assert.equal(m.agendados.length, 0);
});

test('erro esperado (rede, 4xx de regra, PT402, sessão) não é relatado', () => {
  for (const e of [
    { name: 'AgentApiError', status: 0, message: 'Sem conexão com o agente.' },
    { name: 'AgentApiError', status: 422, message: 'regra' },
    { code: 'PT402', message: 'assinatura' },
    { code: 'PT409', message: 'revisão velha' },
    { name: 'AgentAuthExpiredError', message: 'expirou' },
    new Error('Network request failed'),
  ]) assert.equal(ehEsperado(e), true, JSON.stringify(e));
  assert.equal(ehEsperado(new TypeError('x é undefined')), false);
  assert.equal(ehEsperado({ name: 'AgentApiError', status: 500, message: 'boom' }), false);
  assert.equal(ehEsperado(null), false);
});

test('dedupe: o mesmo erro (mesmo com outra linha/coluna) entra uma vez na janela e volta depois', async () => {
  const m = montar();
  const com = (linha: number) => Object.assign(new Error('x é undefined'), { stack: `Error: x\n    at f (a.js:${linha}:9)` });
  m.r.relatar(com(10));
  m.r.relatar(com(99));
  assert.equal(m.r.tamanhoDaFila(), 1);
  m.avancar(61_000);
  m.r.relatar(com(10));
  assert.equal(m.r.tamanhoDaFila(), 2);
  await m.disparar();
  assert.equal(m.lotes.flat().length, 2);
  assert.deepEqual(m.lotes[0][0].platform, 'ios');
  assert.equal(m.lotes[0][0].route, '/hoje');
});

test('envia em lote de no máximo 20 e agenda UM envio para vários relatos', async () => {
  const m = montar();
  for (let i = 0; i < 45; i++) m.r.relatar({ name: `Erro${'z'.repeat(i)}`, message: 'm' });
  assert.equal(m.agendados.length, 1);
  await m.disparar();
  assert.ok(m.lotes.every((l) => l.length <= MAX_POR_LOTE));
  assert.equal(m.lotes.flat().length, 45);
});

test('crash sai na hora, sem esperar a folga', async () => {
  const m = montar();
  m.r.relatar(new Error('morreu'), 'crash');
  await new Promise((r) => setImmediate(r));
  assert.equal(m.lotes.flat().length, 1);
  assert.equal(m.lotes[0][0].kind, 'crash');
});

test('falha de envio não é relatada, não reenfileira e pausa a fila (nunca em laço)', async () => {
  const m = montar({ falhar: true });
  m.r.relatar(new Error('a'));
  await m.disparar();
  assert.equal(m.estado.tentativas, 1);
  assert.equal(m.r.tamanhoDaFila(), 0, 'o lote falho é descartado, não volta');
  m.r.relatar(new Error('b'));
  await m.disparar();
  assert.equal(m.estado.tentativas, 1, 'pausado: não bate de novo no servidor');
  m.avancar(31_000);
  m.estado.falhar = false;
  await m.disparar();
  assert.equal(m.lotes.flat().length, 1);
  assert.equal(m.lotes[0][0].message, 'b');
});

test('relatar nunca lança, nem com meta quebrado ou valor estranho', () => {
  const r = criarRelator({
    ligado: () => true,
    meta: () => { throw new Error('meta'); },
    enviar: async () => undefined,
  });
  assert.doesNotThrow(() => r.relatar(undefined));
  assert.doesNotThrow(() => r.relatar({ toJSON() { throw new Error('x'); } }));
});

test('descrever e chaveLocal', () => {
  assert.deepEqual(descrever('solto'), { name: 'NonErrorThrown', message: 'solto', stack: null });
  assert.equal(descrever(new RangeError('r')).name, 'RangeError');
  assert.equal(
    chaveLocal('error', 'E', 'falhou 12', null),
    chaveLocal('error', 'E', 'falhou 9', null),
  );
});
