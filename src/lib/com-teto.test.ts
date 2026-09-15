import assert from 'node:assert/strict';
import { test } from 'node:test';

import { comTeto } from './com-teto.ts';

/**
 * O caso que este arquivo prende é o que não dá erro nenhum: uma promessa que nunca termina.
 * Sem o teto ela vira esqueleto eterno na tela, e nada no log diz o que houve.
 */

test('promessa que nunca termina vira rejeição depois do teto', async () => {
  const nunca = new Promise<string>(() => {});
  await assert.rejects(() => comTeto(nunca, 10, 'Tempo esgotado'), {
    message: 'Tempo esgotado',
  });
});

test('promessa que resolve a tempo devolve o valor', async () => {
  const rapida = new Promise<string>((ok) => setTimeout(() => ok('conteúdo'), 1));
  assert.equal(await comTeto(rapida, 200, 'Tempo esgotado'), 'conteúdo');
});

test('rejeição própria passa inteira — o teto não a mascara', async () => {
  const falha = Promise.reject(new Error('401 Unauthorized'));
  await assert.rejects(() => comTeto(falha, 200, 'Tempo esgotado'), {
    message: '401 Unauthorized',
  });
});

/*
  O `clearTimeout` não é detalhe: sem ele toda requisição bem-sucedida deixa um timer de 15s vivo
  até o fim do teto, e no Android isso segura o módulo de timers acordado — aparece como bateria,
  nunca como bug. Por isso ele é afirmado, e não deduzido de o teste terminar rápido.
*/
test('o timer morre quando a promessa resolve antes', async () => {
  const relogio = globalThis.setTimeout;
  const cancelar = globalThis.clearTimeout;
  const criados: unknown[] = [];
  const cancelados: unknown[] = [];
  // @ts-expect-error — dublês só para observar quem foi criado e quem foi cancelado.
  globalThis.setTimeout = (fn: () => void, ms: number) => {
    const id = relogio(fn, ms);
    criados.push(id);
    return id;
  };
  // @ts-expect-error — idem.
  globalThis.clearTimeout = (id: unknown) => {
    cancelados.push(id);
    return cancelar(id as never);
  };
  try {
    await comTeto(Promise.resolve('ok'), 60_000, 'Tempo esgotado');
  } finally {
    globalThis.setTimeout = relogio;
    globalThis.clearTimeout = cancelar;
  }
  assert.deepEqual(cancelados, criados);
});
