import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { abaixoDoDialogo, tabletSheetFrame } from './adaptive-sheet.ts';

test('tablet sheets use a bounded task surface in both orientations', () => {
  assert.deepEqual(tabletSheetFrame(820, 1180), { width: 720, height: 840 });
  assert.deepEqual(tabletSheetFrame(1180, 820), { width: 720, height: 756 });
  assert.deepEqual(tabletSheetFrame(610, 700), { width: 562, height: 636 });
});

test('o diálogo do tablet cabe DENTRO da área segura (barra de tarefas, status, recortes)', () => {
  // Galaxy Tab deitado: 1280×800 com status 24 e barra de tarefas 48 embaixo
  const bordas = { top: 24, bottom: 48, left: 0, right: 0 };
  const quadro = tabletSheetFrame(1280, 800, bordas);
  assert.equal(quadro.height, 800 - 24 - 48 - 64);
  assert.ok(quadro.height + 24 + 48 <= 800, 'nunca invade a barra de tarefas');
  assert.equal(tabletSheetFrame(700, 800, { top: 0, bottom: 0, left: 40, right: 40 }).width, 700 - 80 - 48);
});

test('o vão sob o diálogo é o que o teclado cobre fora dele', () => {
  // Galaxy Tab deitado: barra de status 52, barra de tarefas 56. Medido no emulador: 88.
  const bordas = { top: 52, bottom: 56, left: 68, right: 0 };
  assert.equal(abaixoDoDialogo(1280, 800, bordas), 88);
  // Em pé o diálogo bate no teto de 840 e sobra mais embaixo.
  assert.equal(abaixoDoDialogo(800, 1280, { top: 24, bottom: 48, left: 0, right: 0 }), 48 + (1208 - 840) / 2);
});

test('toda folha com campo tem UM mecanismo de teclado: a rolagem', () => {
  const sheet = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  // O `KeyboardAvoidingView` encolhia a folha e a rolagem abria o teclado inteiro por cima: vão
  // vazio da altura do teclado no fim do formulário (27/09/2026).
  assert.doesNotMatch(sheet, /<KeyboardAvoidingView/);
  assert.match(sheet, /extraKeyboardSpace=\{-abaixo\}/);
});

test('shared sheets use native iPad form presentation and Android tablet dialog semantics', () => {
  const sheet = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  const header = readFileSync('src/components/ui/task-header.tsx', 'utf8');
  assert.match(sheet, /presentationStyle=\{iosTablet \? 'formSheet'/);
  assert.match(sheet, /transparent=\{androidTablet\}/);
  assert.match(sheet, /tabletSheetFrame\(width, height, insets\)/);
  assert.match(header, /useTabletSheetContext/);
});

test('a sheet cannot remain presented over a different route', () => {
  const sheet = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  assert.match(sheet, /useIsFocused\(\)/);
  assert.match(sheet, /visible=\{visible && focused\}/);
  assert.match(sheet, /!focused && visible/);
});
