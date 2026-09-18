import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the Android pill enters on app reveal and moves the selected icon with its circle', () => {
  const pill = readFileSync('src/components/ui/pill-tab-bar.tsx', 'utf8');
  assert.match(pill, /useRelogioDeEntrada\(/, 'pill must share the root entrance clock');
  assert.match(pill, /progressoDeEntrada\(relogio\.get\(\)\)/);
  assert.match(pill, /withSpring\(destino, Motion\.spring\.tab\)/, 'selection moves from the tap');
  assert.match(pill, /overflow:\s*'hidden'/, 'selected surface clips the dark icon');
  assert.match(pill, /translateX:\s*-esquerda\.get\(\)/, 'icon row counter-translates');
});

test('preview tab taps update params in place so the pill does not remount mid-flight', () => {
  const preview = readFileSync('src/app/design-preview.tsx', 'utf8');
  assert.match(preview, /router\.setParams\(\{ screen: target\.name \}\)/);
});

test('a stalled cover snaps closed before the shown session is replaced', () => {
  const session = readFileSync('src/hooks/use-session.tsx', 'utf8');
  const curtain = readFileSync('src/components/motion/session-curtain.tsx', 'utf8');
  assert.match(session, /cortina\.cobrirJa\(\)/);
  assert.ok(session.indexOf('cortina.cobrirJa()') < session.indexOf('setEstado({ session: next, loading: false })'));
  assert.match(curtain, /const cobrirJa = useCallback\(/);
  assert.match(curtain, /cancelAnimation\(progresso\)/);
});

test('auth cap recomputes its matching curve after a tablet resize and the form stays readable', () => {
  const cap = readFileSync('src/components/auth/auth-cap.tsx', 'utf8');
  const screen = readFileSync('src/components/auth/auth-screen.tsx', 'utf8');
  assert.match(cap, /useDerivedValue\(\(\) => progressoDaCapa\(height\)/);
  assert.match(screen, /maxWidth:\s*\d+/);
});
