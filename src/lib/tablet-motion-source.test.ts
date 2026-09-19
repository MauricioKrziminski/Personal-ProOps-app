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

test('logout covers downward and reveals upward, with the session changed while hidden', () => {
  const session = readFileSync('src/hooks/use-session.tsx', 'utf8');
  const curtain = readFileSync('src/components/motion/session-curtain.tsx', 'utf8');
  assert.match(
    session,
    /cortina\.cobrir\(onda\)[\s\S]*?setEstado\(\{ session: next, loading: false \}\)[\s\S]*?cortina\.revelar\(revelacao\)/,
    'the next screen must mount between the two visible movements'
  );
  assert.match(curtain, /await animar\(0, Motion\.curtain\.duration\)/);
  assert.match(curtain, /await animar\(alvo, duracao\)/);
});

test('the session curtain does not duplicate or animate the auth brand', () => {
  const curtain = readFileSync('src/components/motion/session-curtain.tsx', 'utf8');
  const button = readFileSync('src/components/ui/button.tsx', 'utf8');
  const profile = readFileSync('src/app/(tabs)/profile/index.tsx', 'utf8');
  assert.doesNotMatch(curtain, /AuthBrand|marcaDaOnda|marcaNaBorda/);
  assert.doesNotMatch(button, /carregandoNaTroca|loadingVisual\s*=\s*loading\s*\|\|/);
  assert.doesNotMatch(profile, /DotsLoader|trailing=\{saindo/);
});

test('logout starts covering before signOut and reuses that cover in the session gate', () => {
  const profile = readFileSync('src/app/(tabs)/profile/index.tsx', 'utf8');
  const session = readFileSync('src/hooks/use-session.tsx', 'utf8');
  const curtain = readFileSync('src/components/motion/session-curtain.tsx', 'utf8');
  assert.match(
    profile,
    /cortina\.preparar\(\);[\s\S]*?confirmDestructive\(/,
    'logout should pre-mount the curtain while the native confirmation is open'
  );
  assert.match(
    profile,
    /cortina\.cobrir\([\s\S]*?\)[\s\S]*?supabase\.auth\.signOut\(\)/,
    'logout must start the cover before waiting for Supabase'
  );
  assert.match(session, /cortina\.cobrir\(onda\)/);
  assert.match(curtain, /coberturaAtual/);
  assert.match(curtain, /fase === 'aberta' && !camadaMontada/);
  assert.match(curtain, /pointerEvents=\{fase === 'aberta' \|\| fase === 'revelando' \? 'none' : 'auto'\}/);
});

test('auth cap recomputes its matching curve after a tablet resize and the form stays readable', () => {
  const cap = readFileSync('src/components/auth/auth-cap.tsx', 'utf8');
  const screen = readFileSync('src/components/auth/auth-screen.tsx', 'utf8');
  assert.match(cap, /useDerivedValue\(\(\) => progressoDaCapa\(height\)/);
  assert.match(screen, /maxWidth:\s*\d+/);
});
