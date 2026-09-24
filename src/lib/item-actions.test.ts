import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * O `Alert` do React Native troca mensagem ausente por `''` e o Android ainda reserva a área dela:
 * "Sair da conta?" saía com um vão vazio entre o título e os botões (visto no emulador em
 * 24/09/2026). Sem mensagem, a pergunta vai no corpo do diálogo, e ele sai compacto.
 */
function carregar(os: 'android' | 'ios') {
  const chamadas: unknown[][] = [];
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync(new URL('./item-actions.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (nome: string) => {
      if (nome === 'react-native') {
        return {
          Platform: { OS: os },
          Alert: { alert: (...a: unknown[]) => chamadas.push(['alert', ...a]) },
          ActionSheetIOS: { showActionSheetWithOptions: (...a: unknown[]) => chamadas.push(['sheet', ...a]) },
        };
      }
      if (nome === 'expo-haptics') return { notificationAsync() {}, NotificationFeedbackType: { Warning: 'w' } };
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return { api: module.exports, chamadas };
}

test('Android sem mensagem: a pergunta vai no corpo, sem vão vazio embaixo do título', () => {
  const { api, chamadas } = carregar('android');
  api.confirmDestructive('Sair da conta?', 'Sair', () => {});
  const [tipo, titulo, mensagem] = chamadas[0];
  assert.equal(tipo, 'alert');
  assert.equal(titulo, '');
  assert.equal(mensagem, 'Sair da conta?');
});

test('Android com mensagem: título e mensagem como sempre', () => {
  const { api, chamadas } = carregar('android');
  api.confirmDestructive('Apagar este lembrete?', 'Apagar', () => {}, 'Aluguel');
  assert.equal(chamadas[0][1], 'Apagar este lembrete?');
  assert.equal(chamadas[0][2], 'Aluguel');
});

test('iOS continua com o título na folha de ações', () => {
  const { api, chamadas } = carregar('ios');
  api.confirmDestructive('Sair da conta?', 'Sair', () => {});
  const opcoes = chamadas[0][1] as { title: string };
  assert.equal(chamadas[0][0], 'sheet');
  assert.equal(opcoes.title, 'Sair da conta?');
});
