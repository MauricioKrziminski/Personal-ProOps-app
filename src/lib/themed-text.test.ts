import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/**
 * Mudar o tamanho da fonte do iPhone com o app ABERTO deixava as telas já montadas com a medida
 * antiga do texto: o Perfil ficou com "Dado", "Aparên", "Tem" e a última linha de cada item
 * cortada (medido no simulador em 23/09/2026, `content_size extra-extra-extra-large`). O texto
 * tem que ser medido de novo quando a escala muda — sem isso a queixa volta em silêncio.
 */
function renderizar(fontScale: number) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync(new URL('../components/themed-text.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (nome: string) => {
      if (nome === 'react-native') {
        return { StyleSheet: { create: (s: unknown) => s }, Text: 'Text', useWindowDimensions: () => ({ width: 400, height: 800, scale: 3, fontScale }) };
      }
      if (nome === 'react/jsx-runtime') return require(nome);
      if (nome === '@/hooks/use-theme') return { useTheme: () => new Proxy({}, { get: () => '#000' }) };
      if (nome === '@/design/tokens') return { Type: new Proxy({}, { get: () => ({}) }) };
      if (nome === '@/constants/theme') return { Fonts: new Proxy({}, { get: () => 'Fonte' }) };
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return module.exports.ThemedText({ children: 'Aparência' });
}

test('o texto é medido de novo quando a escala da fonte do sistema muda', () => {
  const antes = renderizar(1);
  const depois = renderizar(1.35);
  assert.notEqual(antes.key, depois.key, 'mesma chave = o Text montado guarda a medida antiga');
  assert.equal(renderizar(1).key, antes.key, 'sem mudança de escala, nada remonta');
});
