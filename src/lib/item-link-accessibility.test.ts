import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
type Props = Record<string, any>;
/** Renderização React real, com NoteCard/ItemLink e Link/Trigger/Slot do SDK instalado.
 * Somente vistas nativas, estado da navegação e tema recebem dublês. */
function harness() {
  const nodes: { props: Props; insidePreview: boolean }[] = [];
  const navigations: unknown[] = [];
  const menus: Props[] = [];
  const swipes: Props[] = [];
  const nativePreview = React.createContext(false);
  const theme = { surface: '#fff', cardBorder: '#ddd', backgroundSelected: '#eee' };
  const router = { navigate: (href: unknown) => navigations.push(href) };
  function View(props: Props) {
    nodes.push({ props, insidePreview: React.useContext(nativePreview) });
    return React.createElement('div', null, props.children);
  }
  function Pressable(props: Props) {
    return React.createElement(View, { ...props, accessible: props.accessible !== false },
      typeof props.children === 'function' ? props.children({ pressed: false }) : props.children);
  }
  const rn = { View, Pressable, Platform: { OS: 'ios', isPad: false, select: (v: Props) => v.ios ?? v.default },
    StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => v },
    useWindowDimensions: () => ({ fontScale: 1 }), PixelRatio: { get: () => 3 } };
  const identity = ({ children }: Props) => children;
  const cache = new Map<string, any>();
  function load(file: string): any {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const source = readFileSync(path, 'utf8');
    const code = path.endsWith('.js') ? source : ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, process: { env: { EXPO_OS: 'ios', NODE_ENV: 'production' } },
      console, Date, Set, Map,
      require: (name: string) => {
        if (name === 'react-native') return rn;
        if (name === 'react-native-worklets') return { scheduleOnRN: (fn: (...a: any[]) => unknown, ...a: unknown[]) => fn(...a) };
        if (name === 'react-native-reanimated') return { Easing: { bezier: () => () => 0, out: (v: unknown) => v, quad: () => 0 } };
        if (name === 'react-native-gesture-handler') return { GestureDetector: identity };
        if (name === 'expo-router') return { ...load('node_modules/expo-router/build/link/Link.js'), router };
        if (name === '@/components/ui/item-link') return load('src/components/ui/item-link.ios.tsx');
        if (name === '@/components/ui/deslizavel') return { Deslizavel: (props: Props) => { swipes.push(props); return props.children; } };
        if (name === '@/hooks/use-dicas') return { usarDica: () => {} };
        if (name === '@/hooks/use-theme') return { useTheme: () => theme, useScheme: () => 'light', PaletaTingida: identity };
        if (name === '@/design/note-colors') return { notePalette: () => null };
        if (name === '@/components/themed-text') return { ThemedText: identity };
        if (name === '@/components/ui/icon') return { Icon: () => null };
        if (name === '@/components/ui/mark') return { Mark: () => null };
        if (name === '@/global.css') return {};
        if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
        // Os componentes Expo são reais; isolamos apenas serviços de navegação e native hosts.
        if (name === './Redirect') return { Redirect: () => null };
        if (name === '../hooks') return { useRouter: () => router };
        if (name === './useLinkHooks') return { useInteropClassName: (p: Props) => p.style, useHrefAttrs: () => ({}) };
        if (name === '../global-state/routing') return { linkTo: (href: unknown) => router.navigate(href) };
        if (name === '../domComponents/emitDomEvent') return { emitDomLinkEvent: () => false };
        if (name === '../fork/getPathFromState-forks') return { appendBaseUrl: (href: string) => href };
        if (name === './href') return { resolveHref: (href: string) => href };
        if (name === '../utils/url') return { shouldLinkExternally: () => false };
        if (name === '../matchers') return { stripGroupSegmentsFromPath: (href: string) => href };
        if (name === '../Prefetch') return { Prefetch: () => null };
        if (name === './preview/LinkPreviewContext') return { useLinkPreviewContext: () => ({ setOpenPreviewKey: () => {} }) };
        if (name === './preview/useNextScreenId') return { useNextScreenId: () => [{ nextScreenId: 'next', tabPath: [] }, () => {}] };
        if (name === './zoom/useZoomHref') return { useZoomHref: (props: Props) => props.href };
        if (name === './zoom/zoom-transition-context-providers') return { ZoomTransitionSourceContextProvider: identity };
        if (name === './zoom/link-apple-zoom') return { LinkAppleZoom: identity };
        if (name === './zoom/link-apple-zoom-target') return { LinkAppleZoomTarget: identity };
        if (name === '../primitives') return { Label: identity, Icon: () => null };
        if (name === './preview/HrefPreview') return { HrefPreview: () => null };
        if (name === './preview/native') return {
          NativeLinkPreview: (props: Props) => React.createElement(nativePreview.Provider, { value: true }, props.children),
          NativeLinkPreviewAction: (props: Props) => { menus.push(props); return props.children ?? null; },
          NativeLinkPreviewContent: identity,
        };
        if (name.startsWith('.')) {
          const candidate = resolve(dirname(path), name);
          return load(/\.[jt]sx?$/.test(candidate) ? candidate : `${candidate}.js`);
        }
        return nativeRequire(name);
      },
    }, { filename: path });
    return module.exports;
  }
  return { nodes, navigations, menus, swipes,
    child(props: Props) { return React.createElement(Pressable, props, 'Linha'); },
    renderNote(props: Props) { renderToStaticMarkup(React.createElement(load('src/components/notes/note-card.tsx').NoteCard, props)); },
    renderLink(props: Props) {
      const { children = () => React.createElement(Pressable, null, 'Linha'), ...rest } = props;
      renderToStaticMarkup(React.createElement(load('src/components/ui/item-link.ios.tsx').ItemLink, rest, children));
    },
  };
}
const note = { id: 'n1', content: 'QA Filtros 3009 alvo\nTexto completo da nota', pinned: false, source: 'app', updated_at: '2026-09-30T12:00:00Z', created_at: '2026-09-30T12:00:00Z', color: null, folder_id: null, tags: [], archived_at: null, position: null, deleted_at: null };

test('cartão iOS expõe rótulo e ativação fora do contêiner nativo do preview, preservando menu e arrasto', () => {
  const h = harness();
  const calls: string[] = [];
  h.renderNote({ note, actions: { onPin: () => calls.push('pin'), onMove: () => calls.push('move'), onColor: () => calls.push('color'), onArchive: () => calls.push('archive'), onTrash: () => calls.push('trash') } });
  const accessible = h.nodes.find(n => !n.insidePreview && n.props.accessible && String(n.props.accessibilityLabel).startsWith('QA Filtros 3009 alvo'));
  assert.ok(accessible, 'o cartão precisa de um alvo AX com caixa própria fora do contêiner display:contents do Expo');
  assert.match(accessible.props.accessibilityLabel, /atualizada/);
  accessible.props.onAccessibilityTap();
  assert.deepEqual(h.navigations, ['/notes/n1']);
  const pin = accessible.props.accessibilityActions.find((a: Props) => a.label === 'Fixar');
  assert.ok(pin, 'o leitor de tela alcança a mesma ação do menu');
  accessible.props.onAccessibilityAction({ nativeEvent: { actionName: pin.name } });
  assert.deepEqual(calls, ['pin']);
  const nativePin = h.menus.find((m) => m.title === 'Fixar');
  assert.ok(nativePin, 'o menu nativo continua presente');
  nativePin.onSelected();
  assert.deepEqual(calls, ['pin', 'pin']);
  assert.equal(h.swipes[0].forma, 'card');
  assert.equal(h.swipes[0].acoes.find((a: Props) => a.label === 'Fixar').arrasto, 'direita');
  const trigger = h.nodes.find(n => n.insidePreview && typeof n.props.onPress === 'function');
  assert.ok(trigger, 'o toque curto continua no Link.Trigger real');
  trigger.props.onPress({ defaultPrevented: false });
  assert.deepEqual(h.navigations, ['/notes/n1', '/notes/n1']);
});

test('ações AX preservam submenus e impedem executar ações desabilitadas', () => {
  const h = harness();
  const calls: string[] = [];
  h.renderLink({ href: '/notes/n1', title: 'Nota', actions: [
    { label: 'Mover', actions: [{ label: 'Trabalho', onPress: () => calls.push('move') }, { label: 'Bloqueada', disabled: true, onPress: () => calls.push('disabled') }] },
    { label: 'Excluir', disabled: true, onPress: () => calls.push('disabled') },
  ] });
  const accessible = h.nodes.find(n => !n.insidePreview && n.props.accessible && n.props.accessibilityLabel === 'Nota');
  assert.ok(accessible);
  const enabledActions = accessible.props.accessibilityActions.filter((a: Props) => a.name !== 'activate');
  assert.equal(enabledActions.length, 1);
  assert.match(enabledActions[0].label, /Mover.*Trabalho/);
  accessible.props.onAccessibilityAction({ nativeEvent: { actionName: enabledActions[0].name } });
  accessible.props.onAccessibilityAction({ nativeEvent: { actionName: 'invalid' } });
  assert.deepEqual(calls, ['move']);
});


test('ItemLink preserva rótulo rico do filho e só executa render prop uma vez', () => {
  const h = harness();
  let renders = 0;
  h.renderLink({ href: '/notes/n1', title: 'Conta principal', actions: [], children: () => {
    renders += 1;
    return h.child({ accessibilityLabel: 'Conta principal, saldo R$ 200,00, ativa' });
  } });
  const accessible = h.nodes.find(n => !n.insidePreview && n.props.accessible);
  assert.ok(accessible);
  assert.equal(accessible.props.accessibilityLabel, 'Conta principal, saldo R$ 200,00, ativa');
  assert.equal(renders, 1);
});

test('rótulo explícito do ItemLink prevalece sobre o título e rótulo do filho', () => {
  const h = harness();
  h.renderLink({ href: '/notes/n1', title: 'Título', accessibilityLabel: 'Rótulo completo', actions: [],
    children: () => h.child({ accessibilityLabel: 'Rótulo do filho' }) });
  assert.equal(h.nodes.find(n => !n.insidePreview && n.props.accessible)?.props.accessibilityLabel, 'Rótulo completo');
});
