import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('tablet rail enters on every app reveal and keeps the selection contents attached to the moving mask', () => {
  const rail = readFileSync('src/components/ui/tablet-navigation-rail.tsx', 'utf8');
  assert.match(rail, /useRelogioDeEntrada\(/, 'rail must share the root entrance clock');
  assert.match(rail, /progressoDeEntrada\(relogio\.get\(\)\)/);
  assert.match(rail, /overflow:\s*'hidden'/, 'selected surface clips the dark icon and label');
  assert.match(rail, /translateY:\s*-selected\.get\(\)/, 'the selected contents counter-translate');
  assert.doesNotMatch(rail, /active\s*\?\s*'heroSurface'/, 'text color cannot jump before the rail indicator arrives');
});

test('preview tab taps update params in place so the rail does not remount mid-flight', () => {
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
