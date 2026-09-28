import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * A escuta ao vivo (`lib/fala.ts`) recebe o texto de dois jeitos: no Android, vários trechos FINAIS
 * (um por frase); no iPhone, um resultado que cresce e fecha num final só. O campo tem que mostrar
 * cada palavra uma vez nos dois.
 */
function carregar(nativo: boolean) {
  const code = ts.transpileModule(readFileSync(new URL('./fala.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as any };
  let carregouBiblioteca = false;
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    require: (nome: string) => {
      if (nome === 'expo') return { requireOptionalNativeModule: () => (nativo ? {} : null) };
      if (nome === 'react-native') return { Platform: { OS: 'ios', Version: '26.0' } };
      if (nome === 'expo-speech-recognition') {
        carregouBiblioteca = true;
        return { ExpoSpeechRecognitionModule: { isRecognitionAvailable: () => true } };
      }
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return { api: mod.exports, carregouBiblioteca: () => carregouBiblioteca };
}

test('Android: trechos finais se juntam e o parcial vem por cima, sem repetir', () => {
  const { api } = carregar(true);
  assert.equal(api.textoDaEscuta([], 'gastei 45'), 'gastei 45');
  assert.equal(api.textoDaEscuta(['gastei 45 no mercado'], ''), 'gastei 45 no mercado');
  assert.equal(api.textoDaEscuta(['gastei 45 no mercado'], 'e 30 na'), 'gastei 45 no mercado e 30 na');
  assert.equal(api.textoDaEscuta(['gastei 45 no mercado', 'e 30 na padaria'], ''), 'gastei 45 no mercado e 30 na padaria');
});

test('iPhone: o parcial que cresce é substituído, e o final único fecha igual', () => {
  const { api } = carregar(true);
  assert.equal(api.textoDaEscuta([], 'gastei'), 'gastei');
  assert.equal(api.textoDaEscuta([], 'gastei 45 no mercado'), 'gastei 45 no mercado');
  assert.equal(api.textoDaEscuta(['Gastei 45 no mercado.'], ''), 'Gastei 45 no mercado.');
});

test('sem o módulo nativo a biblioteca nem é carregada, e a escuta ao vivo fica indisponível', () => {
  const sem = carregar(false);
  assert.equal(sem.api.falaAoVivoDisponivel(), false);
  assert.equal(sem.carregouBiblioteca(), false, 'carregar sem o nativo fecharia o app na abertura');
  assert.equal(carregar(true).api.falaAoVivoDisponivel(), true);
});
