import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A contagem anti-slop (`design.md` §10) medida por teste, não afirmada por quem escreveu.
 *
 * Ela já foi dada como zerada duas vezes e não estava: numa medição apareceram 3 hex e 4
 * `fontSize` soltos; depois a aba Notas inteira nasceu com uma paleta local (`NOTE_SKIN`, fundo
 * `#0F0F12` e um accent violeta que não existe em `Colors`) forçando dark no tema claro.
 *
 * A lição do `icon-map.test.ts` vale igual aqui: **guarda que depende de alguém olhar não é
 * guarda.** Cor nova precisa de par light e dark em `constants/theme.ts`, e tamanho de texto
 * precisa de um nome na escala `Type` — as duas regras agora quebram o build em vez de virarem
 * uma linha num handoff.
 *
 * Lê os arquivos como TEXTO de propósito: eles importam React Native e não rodam no
 * `node --test`. Mesma estratégia de `icon-map.test.ts` e `categories.test.ts`.
 */
const SRC = join(import.meta.dirname, '..');

/** Onde a cor e a escala PODEM ser literais — é o trabalho desses arquivos. */
const ALLOWED = new Set([
  join(SRC, 'constants', 'theme.ts'),
  join(SRC, 'design', 'tokens.ts'),
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !entry.includes('.test.') ? [full] : [];
  });
}

/**
 * Tira comentários antes de medir.
 *
 * Sem isso o teste acusa a própria documentação: `button.tsx` explica que substituiu 18
 * `color: '#fff'`, e o cabeçalho de `notes/index.tsx` cita os hex da paleta que foi removida.
 * Descrever o defeito não é cometê-lo.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    if (ALLOWED.has(file)) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, i) => {
      const match = line.match(pattern);
      if (match) found.push(`${file.replace(SRC, 'src')}:${i + 1}  ${match[0].trim()}`);
    });
  }
  return found;
}

test('nenhuma cor hardcoded fora de constants/theme.ts', () => {
  // `#fff`, `#ffffff`, `#ffffffcc` — em aspas, que é como cor entra em estilo.
  assert.deepEqual(
    offenders(/['"]#[0-9a-fA-F]{3,8}['"]/),
    [],
    'toda cor vem de useTheme(); cor nova precisa de par light E dark em constants/theme.ts'
  );
});

test('nenhum fontSize solto fora de design/tokens.ts', () => {
  assert.deepEqual(
    offenders(/\bfontSize:\s*\d/),
    [],
    'tamanho de texto vem da escala Type (ThemedText type=...), nunca de um número na tela'
  );
});

test('rgba/hsl literais também não passam', () => {
  // A paleta local da aba Notas escapava por aqui: `accentSoft: 'rgba(139,92,246,0.18)'`.
  assert.deepEqual(
    offenders(/['"](?:rgba?|hsla?)\(\s*\d/),
    [],
    'cor em rgba() é cor hardcoded igual — o par light/dark mora em constants/theme.ts'
  );
});
