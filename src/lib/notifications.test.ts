import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * Tocar numa notificação leva UMA vez ao destino dela.
 *
 * `getLastNotificationResponseAsync()` devolve a última resposta tocada até alguém LIMPÁ-LA — e
 * sem limpar, toda abertura do app voltava a navegar para a notificação antiga (visto no
 * emulador em 23/09/2026: o app reabria na tela de um lembrete tocado dias antes, e com o
 * navegador ainda montando, o `router.push` caía no vazio com "The 'navigation' object hasn't
 * been initialized yet").
 */
function carregar(ultima: unknown) {
  const estado = { ultima, idas: [] as string[], limpezas: 0, ouvinte: null as null | ((r: unknown) => void) };
  const notifications = {
    addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
      estado.ouvinte = fn;
      return { remove() {} };
    },
    getLastNotificationResponseAsync: async () => estado.ultima,
    clearLastNotificationResponseAsync: async () => {
      estado.limpezas++;
      estado.ultima = null;
    },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync(new URL('./notifications.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (nome: string) => {
      if (nome === 'expo-router') return { router: { push: (rota: string) => estado.idas.push(rota) } };
      if (nome === '@/lib/push-module') return { notifications };
      if (nome === '@/lib/push-routes') return { routeFor: (data: any) => (data?.target === 'reminders' ? '/reminders' : null) };
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return { estado, api: module.exports };
}

const toque = { notification: { request: { content: { data: { target: 'reminders' } } } } };
const espera = () => new Promise((r) => setTimeout(r, 0));

test('abrir o app por uma notificação leva ao destino e LIMPA a resposta', async () => {
  const { estado, api } = carregar(toque);
  api.attachNotificationListeners();
  await espera();
  assert.deepEqual(estado.idas, ['/reminders']);
  assert.equal(estado.limpezas, 1, 'sem limpar, a próxima abertura voltaria para cá');
});

test('a abertura seguinte não repete a notificação antiga', async () => {
  const { estado, api } = carregar(toque);
  api.attachNotificationListeners();
  await espera();
  api.attachNotificationListeners(); // o app foi fechado e aberto de novo
  await espera();
  assert.deepEqual(estado.idas, ['/reminders']);
});

test('tocar com o app aberto também limpa — senão a próxima abertura voltaria para lá', async () => {
  const { estado, api } = carregar(null);
  api.attachNotificationListeners();
  await espera();
  estado.ouvinte?.(toque);
  await espera();
  assert.deepEqual(estado.idas, ['/reminders']);
  assert.equal(estado.limpezas, 1);
});
