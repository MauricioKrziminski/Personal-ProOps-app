import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type AppStatus = 'active' | 'inactive' | 'background';
type AuthResult = { success: boolean; error?: string };
type Slot = any;

/** Real LockProvider; native results and lifecycle events remain pending until the test delivers them. */
function mountLock(platform: 'ios' | 'android' = 'ios', delay: 0 | 30 | 60 = 0) {
  let now = 1_000;
  let cursor = 0;
  let dirty = true;
  let rendering = false;
  let mounted = true;
  let value: any;
  const slots: Slot[] = [];
  const effects: { index: number; fn: () => any; deps: any[] }[] = [];
  const listeners = new Set<(state: AppStatus) => void>();
  const auth: { resolve: (value: AuthResult) => void; reject: (error: Error) => void }[] = [];
  let session: { user: { id: string } } | null = { user: { id: 'test-user' } };
  const appState = {
    currentState: 'active' as AppStatus,
    addEventListener(_name: string, fn: (state: AppStatus) => void) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    },
  };
  const react = {
    createContext: (initial: any) => ({ value: initial, Provider: 'Provider' }),
    useContext: (context: any) => context.value,
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        if (!mounted) return;
        const result = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(slots[index], result)) { slots[index] = result; dirty = true; }
      }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return slots[index] ?? (slots[index] = { current: initial });
    },
    useEffect(fn: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
        effects.push({ index, fn, deps });
    },
    useMemo(fn: () => any, deps: any[]) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
        slots[index] = { deps, value: fn() };
      return slots[index].value;
    },
    useCallback(fn: (...args: any[]) => any, deps: any[]) { return react.useMemo(() => fn, deps); },
  };
  function load(file: string, require: (name: string) => any) {
    const module = { exports: {} as any };
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(source, { module, exports: module.exports, require, Date: { now: () => now }, setTimeout, clearTimeout }, { filename: file });
    return module.exports;
  }
  const policy = load('src/lib/lock-policy.ts', (name) => { throw new Error(`Unexpected dependency ${name}`); });
  const provider = load('src/hooks/use-lock.tsx', (name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }) };
    if (name === 'react-native') return { Platform: { OS: platform }, AppState: appState };
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getItem: async (key: string) => key === 'lock-mode' ? 'on' : String(delay), setItem: async () => {},
    } };
    if (name === 'expo-local-authentication') return {
      getEnrolledLevelAsync: async () => 1,
      supportedAuthenticationTypesAsync: async () => [],
      isEnrolledAsync: async () => false,
      authenticateAsync: () => new Promise<AuthResult>((resolve, reject) => auth.push({ resolve, reject })),
      cancelAuthenticate: async () => {},
    };
    if (name === '@/hooks/use-session') return { useSession: () => ({ session, loading: false }) };
    if (name === '../../modules/proops-privacidade') return { protegerAoSair() {} };
    if (name === '@/lib/lock-policy') return policy;
    throw new Error(`Unexpected dependency ${name}`);
  });
  function render() {
    if (!mounted) return;
    if (rendering) throw new Error('Nested render');
    rendering = true;
    try {
      for (let count = 0; dirty; count++) {
        if (count === 50) throw new Error('LockProvider did not reach a stable render');
        dirty = false;
        cursor = 0;
        effects.length = 0;
        value = provider.LockProvider({ children: null }).props.value;
        // A render-phase state update discards effects from that render, as React does.
        if (dirty) continue;
        for (const { index, fn, deps } of effects.splice(0)) {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: fn() };
        }
      }
    } finally { rendering = false; }
  }
  async function flush() {
    // Native promises and preference loading can schedule multiple nested microtasks.
    for (let round = 0; round < 16; round++) { await Promise.resolve(); render(); }
  }
  render();
  return {
    get value() { return value; },
    get calls() { return auth.length; },
    flush,
    emit(state: AppStatus) { appState.currentState = state; for (const fn of [...listeners]) fn(state); render(); },
    advance(milliseconds: number) { now += milliseconds; },
    setSession(id: string | null) { session = id ? { user: { id } } : null; dirty = true; render(); },
    unmount() {
      mounted = false;
      for (const slot of slots) if (typeof slot?.cleanup === 'function') slot.cleanup();
    },
    start() { const pending = value.autenticar(); render(); return pending; },
    async result(index: number, result: AuthResult) { assert.ok(auth[index], `Missing native call ${index}`); auth[index].resolve(result); await flush(); },
    async reject(index: number) { assert.ok(auth[index], `Missing native call ${index}`); auth[index].reject(new Error('native authentication failed')); await flush(); },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function observe(promise: Promise<string>) {
  let value = 'pending';
  void promise.then((result) => { value = result; }, () => { value = 'rejected'; });
  return { get value() { return value; } };
}

async function unlock(app: ReturnType<typeof mountLock>) {
  await app.flush();
  const pending = app.start();
  app.emit('inactive');
  await app.result(0, { success: true });
  app.emit('active');
  await app.flush();
  assert.equal(await pending, 'aberto');
  assert.equal(app.value.locked, false);
}

test('leaving during the successful prompt return invalidates that visit and asks again', async () => {
  const app = mountLock();
  await app.flush();
  const first = app.start();
  app.emit('inactive');
  await app.result(0, { success: true });
  assert.equal(app.value.locked, true, 'success before active must keep content protected');
  app.emit('background');
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, true, 'the old authentication cannot open the returned visit');
  assert.equal(app.calls, 2, 'returning from a real departure asks again');
  assert.equal(await first, 'trancado');
});

test('the real departure before the prompt active event cannot be consumed as system UI', async () => {
  const app = mountLock();
  await app.flush();
  const first = app.start();
  app.emit('inactive');
  await app.result(0, { success: true });
  app.emit('background');
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, true);
  assert.equal(app.calls, 2, 'the interrupted authentication requires a fresh native prompt');
  assert.equal(await first, 'trancado');
});

for (const resultBeforeActive of [true, false]) {
  test(`iOS legitimate prompt success ${resultBeforeActive ? 'before' : 'after'} active opens once`, async () => {
    const app = mountLock();
    await app.flush();
    const pending = app.start();
    app.emit('inactive');
    if (resultBeforeActive) {
      await app.result(0, { success: true });
      assert.equal(app.value.locked, true, 'native success alone must not expose inactive content');
      app.emit('active');
    } else {
      app.emit('active');
      assert.equal(app.value.locked, true, 'active alone must not authenticate');
      await app.result(0, { success: true });
    }
    await app.flush();
    assert.equal(app.value.locked, false);
    assert.equal(app.value.estado, 'trancado');
    assert.equal(app.calls, 1, 'the prompt return must not create an authentication loop');
    assert.equal(await pending, 'aberto');
  });
}

for (const resultBeforeActive of [true, false]) {
  test(`Android system credential background with success ${resultBeforeActive ? 'before' : 'after'} active is a legitimate return`, async () => {
    const app = mountLock('android');
    await app.flush();
    const pending = app.start();
    app.emit('inactive');
    app.emit('background');
    if (resultBeforeActive) {
      await app.result(0, { success: true });
      assert.equal(app.value.locked, true);
      app.emit('active');
    } else {
      app.emit('active');
      await app.result(0, { success: true });
    }
    await app.flush();
    assert.equal(app.value.locked, false);
    assert.equal(app.calls, 1);
    assert.equal(await pending, 'aberto');
  });
}

test('Android biometric dialog that never pauses the app opens without waiting for a nonexistent active event', async () => {
  const app = mountLock('android');
  await app.flush();
  const pending = app.start();
  await app.result(0, { success: true });
  assert.equal(app.value.locked, false);
  assert.equal(app.calls, 1);
  assert.equal(await pending, 'aberto');
});

test('iOS actual background before a late success refuses the old result and retries on return', async () => {
  const app = mountLock();
  await app.flush();
  const pending = app.start();
  app.emit('inactive');
  app.emit('background');
  await app.result(0, { success: true });
  assert.equal(app.value.locked, true, 'a backgrounded visit cannot accept the result');
  assert.equal(await pending, 'trancado');
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, true);
  assert.equal(app.calls, 2);
});

test('an iOS result delivered after the real return cannot unlock the new visit or clear its retry guard', async () => {
  const app = mountLock();
  await app.flush();
  const first = app.start();
  app.emit('inactive');
  app.emit('background');
  app.emit('active');
  assert.equal(app.value.locked, true);
  await app.result(0, { success: true });
  assert.equal(await first, 'trancado');
  assert.equal(app.value.locked, true);
  assert.equal(app.calls, 2, 'a returned locked visit eventually receives a fresh prompt');
  assert.equal(await app.start(), 'trancado');
  assert.equal(app.calls, 2, 'the old completion cannot release the new native operation guard');
  app.emit('inactive');
  await app.result(1, { success: true });
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, false);
  assert.equal(app.calls, 2);
});

for (const error of ['user_cancel', 'system_cancel', 'authentication_failed']) {
  test(`${error} keeps the app locked and a manual retry can open`, async () => {
    const app = mountLock();
    await app.flush();
    const first = app.start();
    app.emit('inactive');
    await app.result(0, { success: false, error });
    app.emit('active');
    await app.flush();
    assert.equal(app.value.locked, true);
    assert.equal(app.value.estado, 'falhou');
    assert.equal(app.calls, 1, 'a cancellation must not immediately restart the prompt');
    assert.equal(await first, 'trancado');
    const second = app.start();
    app.emit('inactive');
    await app.result(1, { success: true });
    app.emit('active');
    await app.flush();
    assert.equal(app.value.locked, false);
    assert.equal(app.calls, 2);
    assert.equal(await second, 'aberto');
  });
}

test('reentrant requests share one native operation and cannot prematurely open', async () => {
  const app = mountLock();
  await app.flush();
  const first = app.start();
  const duplicate = app.start();
  assert.equal(await duplicate, 'trancado');
  assert.equal(app.calls, 1);
  assert.equal(app.value.locked, true);
  app.emit('inactive');
  await app.result(0, { success: true });
  app.emit('active');
  await app.flush();
  assert.equal(await first, 'aberto');
  assert.equal(app.value.locked, false);
  assert.equal(app.calls, 1);
});

for (const delay of [0, 30, 60] as const) {
  for (const atThreshold of delay === 0 ? [true] : [false, true]) {
    test(`completed unlock respects ${delay}s grace ${atThreshold ? 'at' : 'before'} the threshold`, async () => {
      const app = mountLock('ios', delay);
      await app.flush();
      const pending = app.start();
      app.emit('inactive');
      await app.result(0, { success: true });
      app.emit('active');
      await app.flush();
      assert.equal(await pending, 'aberto');
      assert.equal(app.value.locked, false);
      app.emit('inactive');
      app.emit('background');
      assert.equal(app.value.velado, true, 'backgrounded content is covered even within grace');
      app.advance(delay * 1_000 - (atThreshold ? 0 : 1));
      app.emit('active');
      await app.flush();
      assert.equal(app.value.locked, atThreshold);
      assert.equal(app.value.velado, false);
      assert.equal(app.calls, atThreshold ? 2 : 1);
    });
  }

  test(`leaving after native success before active invalidates the attempt even with ${delay}s grace`, async () => {
    const app = mountLock('ios', delay);
    await app.flush();
    const pending = app.start();
    app.emit('inactive');
    await app.result(0, { success: true });
    app.emit('background');
    app.emit('active');
    await app.flush();
    assert.equal(app.value.locked, true);
    assert.equal(app.calls, 2, 'grace only applies to an already completed unlock');
    assert.equal(await pending, 'trancado');
  });
}

test('a thrown native error releases the in-flight guard so a retry can authenticate', async () => {
  const app = mountLock();
  await app.flush();
  const first = app.start().catch(() => 'rejected');
  app.emit('inactive');
  await app.reject(0);
  app.emit('active');
  await app.flush();
  await first;
  assert.equal(app.value.locked, true);
  assert.notEqual(app.value.estado, 'autenticando', 'an exception cannot leave a permanent busy prompt');
  const retry = app.start();
  assert.equal(app.calls, 2);
  app.emit('inactive');
  await app.result(1, { success: true });
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, false);
  assert.equal(await retry, 'aberto');
});

for (const platform of ['ios', 'android'] as const) {
  for (const finishesBeforeActive of [true, false]) {
    test(`${platform} external system UI returning ${finishesBeforeActive ? 'after' : 'before'} operation completion stays unlocked`, async () => {
      const app = mountLock(platform);
      await unlock(app);
      const operation = deferred<string>();
      const result = app.value.semTrancar(() => operation.promise);
      app.emit('inactive');
      app.emit('background');
      assert.equal(app.value.velado, false, 'external system UI keeps its existing exemption');
      if (finishesBeforeActive) { operation.resolve('picked-file'); await app.flush(); }
      app.emit('active');
      assert.equal(app.value.locked, false);
      assert.equal(app.calls, 1, 'returning from file/camera UI must not prompt');
      if (!finishesBeforeActive) operation.resolve('picked-file');
      assert.equal(await result, 'picked-file');
      await app.flush();
      app.emit('background');
      app.emit('active');
      await app.flush();
      assert.equal(app.value.locked, true, 'the exemption cannot leak into the next genuine departure');
      assert.equal(app.calls, 2);
    });
  }

  test(`${platform} nested system UI retains the exemption until the last operation returns`, async () => {
    const app = mountLock(platform);
    await unlock(app);
    const outer = deferred<string>();
    const inner = deferred<string>();
    const pending = app.value.semTrancar(async () => {
      const child = await app.value.semTrancar(() => inner.promise);
      return `${child}:${await outer.promise}`;
    });
    app.emit('inactive');
    app.emit('background');
    inner.resolve('photo');
    await app.flush();
    app.emit('active');
    assert.equal(app.value.locked, false);
    assert.equal(app.calls, 1, 'finishing the inner operation must not drop the outer exemption');
    app.emit('inactive');
    app.emit('background');
    outer.resolve('saved');
    await app.flush();
    app.emit('active');
    assert.equal(await pending, 'photo:saved');
    await app.flush();
    assert.equal(app.value.locked, false);
    assert.equal(app.calls, 1);
    app.emit('background');
    app.emit('active');
    await app.flush();
    assert.equal(app.value.locked, true);
    assert.equal(app.calls, 2);
  });
}

for (const newSession of [null, 'other-user']) {
  test(`${newSession === null ? 'logout' : 'account swap'} settles a successful authentication waiting for active as refused`, async () => {
    const app = mountLock();
    await app.flush();
    const pending = observe(app.start());
    app.emit('inactive');
    await app.result(0, { success: true });
    assert.equal(pending.value, 'pending');
    app.setSession(newSession);
    await app.flush();
    assert.equal(pending.value, 'trancado', 'authentication belongs to the session that started it');
    if (newSession === null) assert.equal(app.value.locked, false, 'logout leaves the login reachable');
    app.emit('active');
    await app.flush();
    assert.equal(app.calls, 1, 'the old session must not resume its prompt');
    app.setSession('next-user');
    app.emit('background');
    app.emit('active');
    await app.flush();
    assert.equal(app.value.locked, true, 'the new account retains its own lock policy');
    assert.equal(app.calls, 2, 'session invalidation cannot leave the authentication guard occupied');
  });
}

test('a late native success after an account swap cannot release the returned account', async () => {
  const app = mountLock();
  await app.flush();
  const old = observe(app.start());
  app.emit('inactive');
  app.setSession('other-user');
  app.emit('background');
  app.emit('active');
  await app.result(0, { success: true });
  assert.equal(old.value, 'trancado');
  assert.equal(app.value.locked, true, 'an old-session result cannot authenticate the new account');
  assert.equal(app.calls, 2);
});

for (const newSession of [null, 'other-user']) {
  test(`a native result arriving after ${newSession === null ? 'logout' : 'an account swap'} is refused without relying on a background event`, async () => {
    const app = mountLock();
    await app.flush();
    const pending = observe(app.start());
    app.emit('inactive');
    app.setSession(newSession);
    app.emit('active');
    await app.result(0, { success: true });
    assert.equal(pending.value, 'trancado', 'the old native result cannot authenticate a changed session');
    if (newSession === null) assert.equal(app.value.locked, false);
    else {
      const retry = app.start();
      assert.equal(app.calls, 2, 'refusing the old result must release the native-operation guard');
      await app.result(1, { success: true });
      assert.equal(await retry, 'aberto');
    }
  });
}

for (const nativeAlreadyFinished of [false, true]) {
  test(`account swap restores a usable locked retry after ${nativeAlreadyFinished ? 'success waiting for active' : 'an in-flight native authentication'} is refused`, async () => {
    const app = mountLock();
    await app.flush();
    const old = observe(app.start());
    app.emit('inactive');
    if (nativeAlreadyFinished) await app.result(0, { success: true });
    app.setSession('other-user');
    app.emit('active');
    if (!nativeAlreadyFinished) await app.result(0, { success: true });
    await app.flush();
    assert.equal(old.value, 'trancado');
    assert.equal(app.value.locked, true, 'a direct account swap preserves the existing locked state');
    assert.equal(app.value.estado, 'trancado', 'the retry button must be usable after the old operation is refused');
    const retry = app.start();
    assert.equal(app.calls, 2);
    app.emit('inactive');
    await app.result(1, { success: true });
    app.emit('active');
    await app.flush();
    assert.equal(await retry, 'aberto');
    assert.equal(app.value.locked, false);
  });
}

test('unmount settles successful authentication waiting for active without a later lifecycle event', async () => {
  const app = mountLock();
  await app.flush();
  const pending = observe(app.start());
  app.emit('inactive');
  await app.result(0, { success: true });
  assert.equal(pending.value, 'pending');
  app.unmount();
  await app.flush();
  assert.equal(pending.value, 'trancado', 'removed AppState listener cannot leave its promise pending forever');
  app.emit('active');
  await app.flush();
  assert.equal(app.calls, 1, 'an unmounted provider cannot restart native authentication');
});

test('native success arriving after unmount is refused and a fresh provider remains protected', async () => {
  const old = mountLock();
  await old.flush();
  const pending = observe(old.start());
  old.emit('inactive');
  old.unmount();
  old.emit('active');
  const fresh = mountLock();
  await fresh.flush();
  await old.result(0, { success: true });
  assert.equal(pending.value, 'trancado');
  assert.equal(fresh.value.locked, true);
  assert.equal(old.calls, 1);
  assert.equal(fresh.calls, 0);
  const retry = fresh.start();
  await fresh.result(0, { success: true });
  assert.equal(await retry, 'aberto');
  assert.equal(fresh.value.locked, false);
});

test('a genuine departure immediately after success and active asks again even while the visual reveal can still be running', async () => {
  const app = mountLock('ios', 0);
  await unlock(app);
  app.emit('inactive');
  app.emit('background');
  assert.equal(app.value.velado, true);
  app.emit('active');
  await app.flush();
  assert.equal(app.value.locked, true);
  assert.equal(app.calls, 2, 'the reveal animation cannot create a grace period');
});

for (const nativeAlreadyFinished of [false, true]) {
  test(`disabling lock refuses ${nativeAlreadyFinished ? 'a success waiting for active' : 'a late native success'} and keeps the setting off`, async () => {
    const app = mountLock();
    await app.flush();
    const pending = observe(app.start());
    app.emit('inactive');
    if (nativeAlreadyFinished) await app.result(0, { success: true });
    await app.value.configurar('off');
    await app.flush();
    if (!nativeAlreadyFinished) await app.result(0, { success: true });
    assert.equal(pending.value, 'trancado');
    app.emit('active');
    await app.flush();
    assert.equal(app.value.mode, 'off');
    assert.equal(app.value.locked, false);
    assert.equal(app.value.velado, false);
    assert.equal(app.value.estado, 'trancado');
    assert.equal(app.calls, 1, 'an invalidated attempt cannot restart a disabled lock');
  });
}
