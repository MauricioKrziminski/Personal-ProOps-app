import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, '..', 'components', 'ui', 'task-header.tsx'), 'utf8');

test('TaskHeader: o título de chrome tem teto de escala, para ✕, título e "Salvar" caberem numa faixa', () => {
  assert.match(src, /headAction: \{[^}]*flexShrink: 0/);
  assert.equal((src.match(/maxFontSizeMultiplier=\{TETO_DO_TITULO\}/g) ?? []).length, 2);
});

test('PillTabBar: o repouso troca a view animada por uma View comum (key nova), por timer do React', () => {
  const pill = readFileSync(join(import.meta.dirname, '..', 'components', 'ui', 'pill-tab-bar.tsx'), 'utf8');
  assert.match(pill, /const Raiz = noLugar \? View : Animated\.View/);
  assert.match(pill, /key=\{noLugar \? 'no-lugar' : 'subindo'\}/);
  assert.match(pill, /setTimeout\(\(\) => setForcadaEm\(geracao\)/);
});
