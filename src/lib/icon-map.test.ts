import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Todo SF Symbol usado no app precisa estar no mapa SF → Material do `Icon`.
 *
 * `expo-symbols` NÃO traduz nome sozinho: fora do mapa, o ícone vira um `circle` vazio no
 * Android. Existe um `console.warn` em `__DEV__`, mas ele só grita quando ALGUÉM ABRE a tela —
 * e foi assim que `bubble.left` e `iphone` (a origem do lançamento) passaram: o defeito só
 * apareceu no print do detalhe, um círculo azul oco no lugar do ícone.
 *
 * O teste lê os arquivos como TEXTO de propósito: `icon.tsx` importa React Native e não roda no
 * `node --test`. Mesma estratégia de `categories.test.ts`.
 */
const SRC = join(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes('.test.') ? [full] : [];
  });
}

/** Nome de SF Symbol: minúsculo, com pontos. Um `.` é o que separa de rótulo comum. */
const SF_LIKE = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;

test('Icon: todo SF Symbol usado no app está no mapa SF → Material', () => {
  const iconFile = join(SRC, 'components/ui/icon.tsx');
  const mapped = new Set(
    [...readFileSync(iconFile, 'utf8').matchAll(/^\s*'?([a-zA-Z0-9.]+)'?:\s*'[a-z0-9_]+',/gm)].map(
      (m) => m[1]
    )
  );
  assert.ok(mapped.size > 100, `mapa parece vazio (${mapped.size} entradas) — regex quebrou?`);

  const missing = new Map<string, string>();
  for (const file of walk(SRC)) {
    if (file === iconFile) continue;
    const text = readFileSync(file, 'utf8');
    const names = [
      ...[...text.matchAll(/\bicon[=:]\s*['"]([a-z][a-zA-Z0-9.]*)['"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/<Icon\b[^>]*?\bname=\{?['"]([a-z][a-zA-Z0-9.]*)['"]/gs)].map((m) => m[1]),
      // mapas tipados (`Record<..., SymbolViewProps['name']>`): pega os literais do bloco
      ...[
        ...text.matchAll(
          /(?:SymbolViewProps\['name'\]|Parameters<typeof Icon>\[0\]\['name'\])[^=]*=\s*(\{[\s\S]*?\n\}|\[[\s\S]*?\n\])/g
        ),
      ].flatMap((m) => [...m[1].matchAll(/'([a-z][a-zA-Z0-9.]*)'/g)].map((x) => x[1])),
    ];
    for (const name of names) {
      // Só cobra o que PARECE SF Symbol: `'expense'` e `'primary'` são chaves de outros mapas.
      if (SF_LIKE.test(name) && !mapped.has(name)) {
        missing.set(name, file.replace(SRC, 'src'));
      }
    }
  }

  assert.deepEqual(
    [...missing].map(([name, file]) => `${name} (${file})`),
    [],
    'ícone fora do mapa vira "circle" vazio no Android'
  );
});
