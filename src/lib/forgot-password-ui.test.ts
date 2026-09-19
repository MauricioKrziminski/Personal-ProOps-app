import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/*
  A recuperação de senha renderizada de verdade, com os dois clientes Supabase como dublês.
  O que se prende aqui é a costura que já prendeu gente na tela: o erro do `updateUser` chegar ao
  campo, código e senha rodarem no cliente DESCARTÁVEL, e a sessão só ir para o principal
  (`setSession`) depois de a senha ter mudado. Mesma técnica de `simple-finance-ui.test.ts`.
*/
function tela(opts: { updateError?: object; setSessionError?: object } = {}) {
  const state: any[] = [];
  let cursor = 0;
  let nodes: any[] = [];
  const calls: string[] = [];
  const navigations: any[] = [];
  const tokens = { access_token: 'at-rec', refresh_token: 'rt-rec' };
  const principal = {
    auth: {
      resetPasswordForEmail: async () => { calls.push('principal.reset'); return { error: null }; },
      verifyOtp: async () => { calls.push('principal.verifyOtp'); return { error: null }; },
      updateUser: async () => { calls.push('principal.updateUser'); return { error: null }; },
      setSession: async (s: any) => {
        calls.push(`principal.setSession:${s.access_token}/${s.refresh_token}`);
        return { error: opts.setSessionError ?? null };
      },
    },
  };
  const recuperacao = {
    auth: {
      verifyOtp: async (p: any) => { calls.push(`rec.verifyOtp:${p.type}`); return { error: null }; },
      updateUser: async () => { calls.push('rec.updateUser'); return { error: opts.updateError ?? null }; },
      getSession: async () => ({ data: { session: tokens } }),
      signOut: async (p: any) => { calls.push(`rec.signOut:${p.scope}`); return { error: null }; },
    },
  };
  const animation = { duration: () => animation, easing: () => animation };
  const load = (path: string): any => {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return {
        useState(initial: any) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], (v: any) => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
        // A ref também é estado: sem persistir entre renders, a trava `pendente` nasceria de novo.
        useRef(v: unknown) { const i = cursor++; if (!(i in state)) state[i] = { current: v }; return state[i]; },
        useEffect: () => {},
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (v: unknown) => v }, View: 'View', TextInput: 'TextInput' };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, FadeInLeft: animation, FadeInRight: animation };
      if (name === 'expo-haptics') return { notificationAsync() {}, NotificationFeedbackType: {} };
      if (name === 'expo-router') return { router: { replace: (to: any) => navigations.push(to), back: () => navigations.push({ back: true }), canGoBack: () => true } };
      if (name === '@/lib/supabase') return { supabase: principal, criarClienteDeRecuperacao: () => recuperacao };
      if (name === '@/lib/auth-errors') return load('src/lib/auth-errors.ts');
      if (name === '@/design/tokens') return { Motion: { duration: {}, easing: {} }, Space: {} };
      return new Proxy({}, { get: (_, key) => String(key) });
    } });
    return module.exports;
  };
  const Component = load('src/app/forgot-password.tsx').default;
  const visit = (n: any) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n?.props) return;
    nodes.push(n);
    visit(n.props.children);
    visit(n.props.footer);
  };
  const render = () => { cursor = 0; nodes = []; visit(Component()); };
  render();
  const field = (label: string) => {
    const f = nodes.find((n) => n.type === 'Field' && n.props.label === label);
    assert.ok(f, `campo visível: ${label}`);
    const dentro: any[] = [];
    const collect = (n: any) => { if (Array.isArray(n)) return n.forEach(collect); if (n?.props) { dentro.push(n); collect(n.props.children); } };
    collect(f);
    return { field: f, input: dentro.find((n) => n.type === 'TextField' || n.type === 'OtpInput') };
  };
  const button = (label: string) => {
    const b = nodes.find((n) => n.type === 'Button' && n.props.label === label);
    assert.ok(b, `botão visível: ${label}`);
    return b;
  };
  return {
    calls, navigations, field, button,
    buttons: () => nodes.filter((n) => n.type === 'Button').map((n) => n.props.label),
    fill(label: string, v: string) { field(label).input.props.onChangeText(v); render(); },
    async press(label: string) { const b = button(label); assert.ok(!b.props.disabled, `${label} habilitado`); await b.props.onPress(); render(); },
    async code(v: string) { await field('Código').input.props.onComplete(v); render(); },
  };
}

async function atePasso(ui: ReturnType<typeof tela>) {
  ui.fill('E-mail', 'dev@proops.local');
  await ui.press('Enviar código');
  await ui.code('123456');
  ui.fill('Senha nova', 'senha-nova-1');
  ui.fill('Repita a senha', 'senha-nova-1');
}

test('código e senha rodam no cliente descartável; a sessão só vai ao principal depois da troca', async () => {
  const ui = tela();
  await atePasso(ui);
  assert.deepEqual(ui.calls, ['principal.reset', 'rec.verifyOtp:recovery']);
  await ui.press('Trocar senha');
  assert.deepEqual(ui.calls.slice(2), ['rec.updateUser', 'principal.setSession:at-rec/rt-rec']);
  // A sessão entregue NUNCA é revogada daqui — seria derrubar quem acabou de entrar.
  assert.ok(!ui.calls.some((c) => c.startsWith('rec.signOut')));
  assert.deepEqual(ui.navigations, [], 'quem leva para dentro é o portão de sessão, não a tela');
});

test('a recusa do servidor aparece no campo da senha e some ao digitar', async () => {
  const ui = tela({
    updateError: { code: 'same_password', status: 422, message: 'New password should be different from the old password.' },
  });
  await atePasso(ui);
  await ui.press('Trocar senha');
  const { field, input } = ui.field('Senha nova');
  assert.equal(field.props.error, 'A senha nova é igual à antiga.');
  assert.equal(input.props.invalid, true);
  assert.equal(ui.button('Trocar senha').props.loading, false, 'o botão volta a responder');
  assert.ok(!ui.calls.some((c) => c.startsWith('principal.setSession')));
  ui.fill('Repita a senha', 'senha-nova-2');
  assert.equal(ui.field('Senha nova').field.props.error, undefined);
});

test('senha trocada mas entrega falhou: diz isso, revoga a recuperação e leva ao login', async () => {
  const ui = tela({ setSessionError: { message: 'Invalid Refresh Token' } });
  await atePasso(ui);
  await ui.press('Trocar senha');
  assert.ok(ui.calls.includes('rec.signOut:local'));
  assert.deepEqual(ui.buttons(), ['Entrar']);
  await ui.press('Entrar');
  assert.deepEqual(ui.navigations, ['/login']);
});

test('Cancelar no passo da senha revoga a sessão de recuperação e sai', async () => {
  const ui = tela();
  await atePasso(ui);
  assert.ok(!ui.buttons().includes('Voltar ao código'));
  await ui.press('Cancelar');
  assert.ok(ui.calls.includes('rec.signOut:local'));
  assert.deepEqual(ui.navigations, [{ back: true }]);
});
