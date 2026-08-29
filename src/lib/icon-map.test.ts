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

/**
 * Os literais em posição de RESULTADO de uma expressão de ícone.
 *
 * `b.kind === 'invoice' ? 'creditcard' : 'exclamationmark.circle'` tem três literais e só dois
 * são ícones — `'invoice'` é o valor comparado. Varrer a expressão inteira faz o teste cobrar
 * um ícone chamado "invoice" que nunca existiu, e um teste que acusa o que não é defeito é
 * abandonado na primeira vez que atrapalha.
 *
 * Heurística: o que interessa vem **depois do primeiro `?`**. Cobre ternário e `??`; expressão
 * sem `?` nenhum (uma variável, um `.map`) não tem literal a cobrar.
 *
 * Duas exceções que apareceram na prática, em
 * `icon={ACTION_ICON[primeira?.type ?? 'unknown'] ?? 'magnifyingglass'}`:
 * - **subscrito**: `'unknown'` ali é CHAVE de mapa, não ícone — `[...]` sai antes da varredura;
 * - **encadeamento opcional**: o `?` de `primeira?.type` não abre ternário nenhum.
 */
function results(expr: string): string[] {
  const semSubscrito = expr.replace(/\[[^\]]*\]/g, '');
  const q = semSubscrito.search(/\?(?!\.)/);
  if (q === -1) return [];
  return [...semSubscrito.slice(q).matchAll(/'([a-z][a-zA-Z0-9.]*)'/g)].map((m) => m[1]);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes('.test.') ? [full] : [];
  });
}

/**
 * Nome de SF Symbol: minúsculo, com pontos. Um `.` é o que separa de rótulo comum.
 *
 * Usado só nos mapas tipados, onde o literal pode ser qualquer coisa. No `name=` de um `<Icon>`
 * e no `icon:` de uma ação **todo** valor é nome de ícone, com ponto ou sem — e é por isso que
 * eles são checados sem este filtro (ver `NAMES_ALWAYS` abaixo).
 */
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

    /**
     * Valores em posição de ÍCONE — checados sempre, sem o filtro de ponto.
     *
     * Duas cegueiras que deixaram `eye` e `eye.slash` passarem até aparecerem como círculo oco
     * no painel de destaque:
     *
     * 1. **Nome sem ponto.** O filtro `SF_LIKE` exige pelo menos um `.`, então `eye`, `bell`,
     *    `calendar` e `house` nunca eram checados — só os pontilhados. Metade dos ícones do app
     *    estava fora do teste que existe para cobri-los.
     * 2. **Ternário.** `name={cond ? 'eye.slash' : 'eye'}` não casava: o regex esperava a aspa
     *    logo depois do `{`. Agora o conteúdo entre chaves é varrido inteiro.
     */
    const NAMES_ALWAYS = [
      ...[...text.matchAll(/\bicon[=:]\s*['"]([a-z][a-zA-Z0-9.]*)['"]/g)].map((m) => m[1]),
      ...[...text.matchAll(/<Icon\b[^>]*?\bname=['"]([a-z][a-zA-Z0-9.]*)['"]/gs)].map((m) => m[1]),
      // `name={...}` e `icon={...}`: expressão inteira (ternário, `??`, default).
      ...[...text.matchAll(/<Icon\b[^>]*?\bname=\{([^}]*)\}/gs)].flatMap((m) => results(m[1])),
      ...[...text.matchAll(/\bicon[=:]\s*\{([^}]*)\}/g)].flatMap((m) => results(m[1])),
    ];

    for (const name of NAMES_ALWAYS) {
      if (!mapped.has(name)) missing.set(name, file.replace(SRC, 'src'));
    }

    const names = [
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
