const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const packageRoot = path.dirname(require.resolve('expo-router/package.json'));
const version = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
).version;
assert.equal(
  version,
  '57.0.22',
  'Revalidate the linking patch and tests when expo-router changes version.',
);
const installed = path.join(packageRoot, 'build');
const fixture = process.env.ROUTER_FIXTURE || installed;
const URL_A = 'appproops:///finance/lancar?tipo=expense&titulo=Almo%C3%A7o';
const PATH_A = 'finance/lancar?tipo=expense&titulo=Almoço';
const URL_B = 'appproops:///finance/lancar?tipo=income&titulo=Freela';
const PATH_B = 'finance/lancar?tipo=income&titulo=Freela';
const deferred = () => {
  let resolve;
  return {
    promise: new Promise((r) => (resolve = r)),
    resolve: (v) => resolve(v),
  };
};
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function createHarness({
  initialURL,
  platform = 'android',
  web = false,
  explicitState = false,
  defaultURL = false,
} = {}) {
  let cursor = 0,
    effects = [],
    phase = 'render',
    tree,
    listener,
    routePath,
    getInitialState;
  const slots = [],
    updates = [],
    dispatched = [],
    modules = new Map();
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useRef(value) {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) {
        const slot = {
          value: typeof initial === 'function' ? initial() : initial,
        };
        slot.set = (v) => {
          slot.value = typeof v === 'function' ? v(slot.value) : v;
          updates.push({ phase, value: slot.value });
        };
        slots[i] = slot;
      }
      return [slots[i].value, slots[i].set];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps))
        slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useMemo(fn, deps) {
      return hooks.useCallback(fn, deps)();
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const slot = (slots[i] ??= {});
        slot.deps = deps;
        slot.effect = fn;
        effects.push(slot);
      }
    },
    useImperativeHandle() {
      cursor++;
    },
    forwardRef: (fn) => fn,
    use: () => undefined,
  };
  const Provider = 'Provider';
  const native = {
    DefaultTheme: {},
    ThemeProvider: 'ThemeProvider',
    BaseNavigationContainer: 'BaseNavigationContainer',
    LocaleDirContext: { Provider },
    UNSTABLE_UnhandledLinkingContext: { Provider },
    LinkingContext: { Provider },
    validatePathConfig() {},
    useNavigationIndependentTree: () => false,
    getStateFromPath: (p) => ({
      routes: [
        {
          name: 'root',
          path: p,
          params: Object.fromEntries(new URLSearchParams(p.split('?')[1])),
        },
      ],
    }),
    getActionFromState: (s) => ({ type: 'NAVIGATE', payload: s }),
  };
  const navigation = {
    getCurrentRoute: () => ({ path: routePath }),
    getRootState: () => ({ routeNames: ['root'] }),
    dispatch: (a) => dispatched.push(a),
    resetRoot: (s) => dispatched.push({ type: 'RESET', payload: s }),
    addListener: () => () => {},
  };
  const window = {
    location: {
      pathname: '/finance/lancar',
      search: '?tipo=expense&titulo=Almo%C3%A7o',
      hash: '#review',
    },
  };
  const stubs = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': {
      I18nManager: { getConstants: () => ({ isRTL: false }) },
      Platform: { OS: platform },
      Linking: { getInitialURL: () => initialURL },
    },
    'expo-linking': { getLinkingURL: () => initialURL },
    '../react-navigation/native': native,
    './useBackButton': { useBackButton() {} },
    './useDocumentTitle': { useDocumentTitle() {} },
    '../imperative-api': { useImperativeApiEmitter() {} },
    '../utils/useLatestCallback': (fn) => fn,
    'fast-deep-equal': (a, b) => JSON.stringify(a) === JSON.stringify(b),
    './createMemoryHistory': {
      createMemoryHistory: () => ({
        index: 0,
        listen: () => () => {},
        replace() {},
        push() {},
        get() {},
      }),
    },
    './getPathFromState': { appendBaseUrl: (p) => p },
    '../global-state/storeContext': { useExpoRouterStore: () => ({}) },
    '../global-state/serverLocationContext': { ServerContext: {} },
    '../global-state/utils': { getRootStackRouteNames: () => ['root'] },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = {};
    modules.set(file, exports);
    const filename = path.join(fixture, file);
    vm.runInNewContext(
      fs.readFileSync(filename, 'utf8'),
      {
        exports,
        require: (name) => {
          if (name === './useLinking') {
            const actual = load(
              web ? 'fork/useLinking.js' : 'fork/useLinking.native.js',
            );
            return {
              ...actual,
              useLinking(...args) {
                const result = actual.useLinking(...args);
                getInitialState = result.getInitialState;
                return result;
              },
            };
          }
          if (name in stubs) return stubs[name];
          if (name.startsWith('.'))
            return load(
              path.normalize(path.join(path.dirname(file), name + '.js')),
            );
          throw Error('Unexpected dependency ' + name);
        },
        process: { env: { NODE_ENV: 'test' } },
        Promise,
        URL,
        URLSearchParams,
        console,
        setTimeout,
        window,
      },
      { filename },
    );
    return exports;
  }
  const Container = load('fork/NavigationContainer.js').NavigationContainer;
  const linking = {
    prefixes: [],
    ...(defaultURL ? {} : { getInitialURL: () => initialURL }),
    subscribe: (cb) => {
      listener = cb;
      return () => {
        listener = undefined;
      };
    },
  };
  function find(node, type) {
    if (!node) return;
    if (node.type === type) return node;
    return find(node.props?.children, type);
  }
  function render() {
    phase = 'render';
    cursor = 0;
    tree = Container(
      {
        linking,
        ...(explicitState
          ? { initialState: { routes: [{ name: 'root' }] } }
          : {}),
      },
      null,
    );
    return tree;
  }
  function bindNavigation() {
    slots[0].current = navigation;
  }
  function commit() {
    phase = 'committed';
    const todo = effects;
    effects = [];
    for (const slot of todo) {
      slot.cleanup?.();
      slot.cleanup = slot.effect();
    }
  }
  function cleanup() {
    phase = 'cleanup';
    for (const slot of slots) slot?.cleanup?.();
  }
  function replayEffects() {
    cleanup();
    phase = 'committed';
    for (const slot of slots) if (slot?.effect) slot.cleanup = slot.effect();
  }
  function ready(pathValue) {
    phase = 'child-commit';
    routePath = pathValue;
    bindNavigation();
    find(tree, 'BaseNavigationContainer').props.onReady();
  }
  function stateChange(pathValue) {
    phase = 'committed';
    routePath = pathValue;
    bindNavigation();
    find(tree, 'BaseNavigationContainer').props.onStateChange({ routes: [] });
  }
  return {
    render,
    commit,
    cleanup,
    replayEffects,
    initialRequest: () => getInitialState(),
    setInitialURL: (v) => {
      initialURL = v;
    },
    ready,
    stateChange,
    bindNavigation,
    updates,
    dispatched,
    emit: (url) => listener?.(url),
    containerProps: () => find(tree, 'BaseNavigationContainer')?.props,
    linkValue: () => {
      let n = tree;
      while (n) {
        if (
          n.props?.value &&
          typeof n.props.value === 'object' &&
          'lastUnhandledLink' in n.props.value
        )
          return n.props.value.lastUnhandledLink;
        n = n.props?.children;
      }
    },
    setRoute: (pathValue) => {
      routePath = pathValue;
    },
  };
}
// These assert behavior from installed modules, not a duplicated queue implementation.
// Controlled hooks are needed because React Native renderer cannot execute in Node.
test('Android initial Promise cannot dispatch before commit, then publishes URL without losing query', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise, defaultURL: true });
  h.render();
  d.resolve(URL_A);
  await tick();
  assert.deepEqual(h.updates, []);
  h.commit();
  await tick();
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  assert.equal(h.containerProps().initialState.routes[0].path, PATH_A);
  assert.equal(
    h.containerProps().initialState.routes[0].params.titulo,
    'Almoço',
  );
  h.cleanup();
});
test('abandoned initial render never dispatches from its URL continuation', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise });
  h.render();
  d.resolve(URL_A);
  await tick();
  assert.deepEqual(h.updates, []);
});
test('URL resolving after cleanup cannot dispatch to an unmounted container', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise });
  h.render();
  h.commit();
  h.cleanup();
  const before = h.updates.length;
  d.resolve(URL_A);
  await tick();
  assert.equal(h.updates.length, before);
});
test('iOS synchronous initial URL returns initial state synchronously without a render dispatch', () => {
  const h = createHarness({
    platform: 'ios',
    initialURL: URL_A,
    defaultURL: true,
  });
  h.render();
  assert.deepEqual(h.updates, []);
  assert.equal(h.containerProps().initialState.routes[0].path, PATH_A);
  h.commit();
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  h.cleanup();
});
test('web synchronous initial path preserves search and hash without a render dispatch', () => {
  const h = createHarness({ web: true });
  h.render();
  assert.deepEqual(h.updates, []);
  assert.equal(
    h.containerProps().initialState.routes[0].path,
    '/finance/lancar?tipo=expense&titulo=Almo%C3%A7o#review',
  );
  h.commit();
  h.render();
  assert.equal(
    h.linkValue(),
    '/finance/lancar?tipo=expense&titulo=Almo%C3%A7o#review',
  );
  h.cleanup();
});
test('child onReady before parent effects clears a handled queued URL permanently', () => {
  const h = createHarness({ initialURL: URL_A });
  h.render();
  h.ready(PATH_A);
  h.setRoute(PATH_B);
  h.commit();
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
test('already focused initial URL resolving after ready is not reintroduced', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise, explicitState: true });
  h.render();
  h.ready(PATH_A);
  h.commit();
  d.resolve(URL_A);
  await tick();
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
test('warm links still dispatch and onStateChange clears the handled URL', () => {
  const h = createHarness({ initialURL: null });
  h.render();
  h.commit();
  h.bindNavigation();
  h.emit(URL_A);
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  assert.equal(h.dispatched[0].payload.routes[0].path, PATH_A);
  h.stateChange(PATH_A);
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
test('successive warm links keep the latest URL until its own state change', () => {
  const h = createHarness({ initialURL: null });
  h.render();
  h.commit();
  h.bindNavigation();
  h.emit(URL_A);
  h.emit(URL_B);
  h.render();
  assert.equal(h.linkValue(), PATH_B);
  h.stateChange(PATH_A);
  h.render();
  assert.equal(h.linkValue(), PATH_B);
  h.stateChange(PATH_B);
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
test('late initial Promise cannot replace tracking for a newer warm link', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise, explicitState: true });
  h.render();
  h.commit();
  h.bindNavigation();
  h.emit(URL_B);
  d.resolve(URL_A);
  await tick();
  h.render();
  assert.equal(h.linkValue(), PATH_B);
  assert.equal(h.dispatched[0].payload.routes[0].path, PATH_B);
  h.cleanup();
});
test('protected login route keeps an unhandled initial URL for later replay', () => {
  const h = createHarness({ initialURL: URL_A });
  h.render();
  h.ready('login');
  h.commit();
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  h.cleanup();
});
test('matching pathname with different query does not clear an unhandled URL', () => {
  const h = createHarness({ initialURL: URL_A });
  h.render();
  h.ready(PATH_B);
  h.commit();
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  h.stateChange(PATH_B);
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  h.cleanup();
});
test('StrictMode effect cleanup and setup permits the still-active initial request', async () => {
  const d = deferred(),
    h = createHarness({ initialURL: d.promise });
  h.render();
  h.commit();
  h.replayEffects();
  d.resolve(URL_A);
  await tick();
  h.render();
  assert.equal(h.linkValue(), PATH_A);
  assert.equal(h.containerProps().initialState.routes[0].path, PATH_A);
  h.cleanup();
});
test('StrictMode effect replay keeps an already-cleared URL cleared', () => {
  const h = createHarness({ initialURL: URL_A });
  h.render();
  h.ready(PATH_A);
  h.commit();
  h.replayEffects();
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
test('newer initial-state request supersedes bookkeeping from older Promise but both still resolve state', async () => {
  const a = deferred(),
    b = deferred(),
    h = createHarness({ initialURL: a.promise, explicitState: true });
  h.render();
  h.setInitialURL(b.promise);
  const newer = h.initialRequest();
  b.resolve(URL_B);
  const newerState = await newer;
  await tick();
  a.resolve(URL_A);
  await tick();
  assert.deepEqual(h.updates, []);
  h.commit();
  await tick();
  h.render();
  assert.equal(h.linkValue(), PATH_B);
  assert.equal(newerState.routes[0].path, PATH_B);
  h.cleanup();
});
test('child onStateChange before queue flush clears its URL even if navigation moves again', () => {
  const h = createHarness({ initialURL: URL_A });
  h.render();
  h.stateChange(PATH_A);
  h.setRoute(PATH_B);
  h.commit();
  h.render();
  assert.equal(h.linkValue(), undefined);
  h.cleanup();
});
