import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createElement, Fragment, isValidElement } from 'react';
import ts from 'typescript';

type Value = { q?: string; from?: string; to?: string; minCents?: number; maxCents?: number; selections?: Record<string, string>; multiSelections?: Record<string, readonly string[]> };
type Props = Record<string, unknown>;
type Node = { type: unknown; props: Props; children: Node[]; actions: Node[] };
type Frame = { slots: unknown[]; next: number };
const require = createRequire(import.meta.url);
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

/** JSX/elementos React reais; hooks controlados e primitivas nativas substituidas por hosts. */
function renderFilters(value: Value = {}, options: Props = {}) {
  const applied: Value[] = [];
  const events: string[] = [];
  const states = new Map<string, unknown[]>();
  const cache = new Map<string, unknown>();
  let frame: Frame | undefined;
  let roots: Node[] = [];
  let props: Props = {
    visible: true, value, showValues: true,
    selects: [
      { key: 'accountId', label: 'Conta', options: [{ id: 'a', label: 'Conta A' }] },
      { key: 'source', label: 'Origem', options: [{ id: 'csv', label: 'CSV' }] },
    ],
    ...options,
    onApply(next: Value) { applied.push(wire(next)); events.push('apply'); props = { ...props, value: next }; },
    onClose() { events.push('close'); props = { ...props, visible: false }; },
  };
  function load(file: string): unknown {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports,
      require: (name: string) => {
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'react') return {
          useState(initial: unknown) {
            assert.ok(frame, 'estado precisa pertencer a uma instancia montada');
            const slots = frame.slots; const slot = frame.next++;
            if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
            return [slots[slot], (next: unknown) => {
              slots[slot] = typeof next === 'function' ? next(slots[slot]) : next;
            }];
          },
        };
        if (name === 'react-native') return { View: 'View', StyleSheet: { create: (styles: unknown) => styles } };
        if (name === '@/design/tokens') return { Space: { lg: 20, xl: 28 } };
        if (name === '@/lib/dates') return load('src/lib/dates.ts');
        if (name === '@/lib/list-filters') return load('src/lib/list-filters.ts');
        if (name.startsWith('.')) return load(resolve(path, '..', name));
        return new Proxy({}, { get: (_target, key) => String(key) });
      },
    }, { filename: path });
    cache.set(path, module.exports);
    return module.exports;
  }
  const component = (load('src/components/ui/list-filters.tsx') as {
    ListFilters: (props: Props) => ReturnType<typeof createElement>;
  }).ListFilters;
  function render() {
    const mounted = new Set<string>();
    function visit(element: unknown, path: string): Node[] {
      if (Array.isArray(element)) return element.flatMap((child, i) => visit(child, `${path}.${i}`));
      if (!isValidElement<Props>(element)) return [];
      if (element.type === Fragment) return visit(element.props.children, `${path}.fragment`);
      if (typeof element.type === 'function') {
        mounted.add(path);
        const slots = states.get(path) ?? [];
        states.set(path, slots);
        const previous = frame;
        frame = { slots, next: 0 };
        let result: unknown;
        try { result = (element.type as (p: Props) => unknown)(element.props); }
        finally { frame = previous; }
        return visit(result, `${path}.render`);
      }
      return [{ type: element.type, props: element.props,
        children: visit(element.props.children, `${path}.children`),
        actions: [...visit(element.props.action, `${path}.action`), ...visit(element.props.labelAccessory, `${path}.accessory`),
          ...visit(element.props.error, `${path}.error`)],
      }];
    }
    roots = visit(createElement(component, props), 'root');
    // Conditional editor realmente desmonta ao fechar: uma abertura nova ganha outro draft.
    for (const path of states.keys()) if (!mounted.has(path)) states.delete(path);
  }
  function nodes(): Node[] {
    const all: Node[] = [];
    function visit(node: Node) { all.push(node); node.children.forEach(visit); node.actions.forEach(visit); }
    roots.forEach(visit);
    return all;
  }
  function node(type: string, matching: Props = {}): Node {
    const found = nodes().find(n => n.type === type && Object.entries(matching).every(([key, expected]) => n.props[key] === expected));
    assert.ok(found, `nao achei ${type} ${JSON.stringify(matching)}`);
    return found;
  }
  function act(target: Node, handler: string, ...args: unknown[]) {
    const action = target.props[handler];
    assert.equal(typeof action, 'function', `${handler} deve ser uma acao real`);
    (action as (...values: unknown[]) => unknown)(...args);
    render();
  }
  render();
  return {
    applied, events, node, nodes, act,
    open(next = props.value as Value) { props = { ...props, visible: true, value: next }; render(); },
    button(label: string) { return node('Button', { label }); },
    select(label: string) { return node('Field', { label }).children.find(n => n.type === 'SelectField')!; },
  };
}

const original: Value = {
  q: 'mercado', from: '2026-09-01', to: '2026-09-30', minCents: 100, maxCents: 20000,
  selections: { accountId: 'a', source: 'csv' },
};

const multipleOptions = { multiSelects: [{ key: 'paymentMethods', label: 'Formas de pagamento', options: [
  { id: 'pix', label: 'Pix' }, { id: 'boleto', label: 'Boleto' }, { id: 'not_informed', label: 'Não informado' },
] }] };

test('múltiplas formas são um rascunho independente e só Aplicar publica', () => {
  const value = wire({ ...original, multiSelections: { paymentMethods: ['pix'] } });
  const h = renderFilters(value, multipleOptions);
  assert.equal(h.node('Chip', { label: 'Pix' }).props.selected, true);
  assert.equal(h.node('Chip', { label: 'Todos' }).props.selected, false);
  h.act(h.node('Chip', { label: 'Boleto' }), 'onPress');
  h.act(h.node('Chip', { label: 'Não informado' }), 'onPress');
  assert.equal(h.node('Chip', { label: 'Pix' }).props.selected, true);
  assert.equal(h.node('Chip', { label: 'Boleto' }).props.selected, true);
  assert.equal(h.node('Chip', { label: 'Não informado' }).props.selected, true);
  assert.deepEqual(value.multiSelections.paymentMethods, ['pix']);
  assert.deepEqual(h.applied, []);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{ ...value, multiSelections: { paymentMethods: ['pix', 'boleto', 'not_informed'] } }]);
  assert.deepEqual(h.events, ['apply', 'close']);
});

test('cancelar múltiplas formas preserva valor publicado e reabrir descarta alterações', () => {
  const value = wire({ ...original, multiSelections: { paymentMethods: ['pix'] } });
  const h = renderFilters(value, multipleOptions);
  h.act(h.node('Chip', { label: 'Pix' }), 'onPress');
  h.act(h.node('Chip', { label: 'Não informado' }), 'onPress');
  h.act(h.node('Sheet'), 'onClose');
  assert.deepEqual(h.applied, []);
  assert.deepEqual(value.multiSelections.paymentMethods, ['pix']);
  h.open();
  assert.equal(h.node('Chip', { label: 'Pix' }).props.selected, true);
  assert.equal(h.node('Chip', { label: 'Não informado' }).props.selected, false);
});

test('Todos limpa somente o grupo; último toggle vazio é Todos, distinto de Não informado', () => {
  const value = { ...original, multiSelections: { paymentMethods: ['not_informed'] } };
  const h = renderFilters(wire(value), multipleOptions);
  h.act(h.node('Chip', { label: 'Não informado' }), 'onPress');
  assert.equal(h.node('Chip', { label: 'Todos' }).props.selected, true);
  h.act(h.node('Chip', { label: 'Pix' }), 'onPress');
  h.act(h.node('Chip', { label: 'Todos' }), 'onPress');
  assert.equal(h.select('Conta').props.value, 'a');
  assert.equal(h.node('TextField').props.value, 'mercado');
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{ ...value, multiSelections: { paymentMethods: [] } }]);
});

test('Limpar inclui seleção múltipla, mas cancelar não altera o pai', () => {
  const value = wire({ ...original, multiSelections: { paymentMethods: ['pix', 'not_informed'] } });
  const h = renderFilters(value, multipleOptions);
  h.act(h.button('Limpar filtros'), 'onPress');
  assert.equal(h.node('Chip', { label: 'Todos' }).props.selected, true);
  assert.equal(h.node('Chip', { label: 'Pix' }).props.selected, false);
  assert.deepEqual(h.applied, []);
  h.act(h.node('TaskHeader'), 'onClose');
  h.open();
  assert.equal(h.node('Chip', { label: 'Não informado' }).props.selected, true);
  h.act(h.button('Limpar filtros'), 'onPress');
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{}]);
  assert.deepEqual(value.multiSelections.paymentMethods, ['pix', 'not_informed']);
});

test('busca preserva nomes e termos digitados sem autocorreção do teclado', () => {
  const h = renderFilters();
  const input = h.node('TextField', { accessibilityLabel: 'Texto do filtro' });
  assert.equal(input.props.autoCorrect, false);
  assert.equal(input.props.autoCapitalize, 'none');
  h.act(input, 'onChangeText', 'QA Filtros 3009 lixeira');
  h.act(h.button('Aplicar'), 'onPress');
  assert.equal(h.applied[0].q, 'QA Filtros 3009 lixeira');
});

test('significado da data fica no rótulo de cada input, sem título de seção duplicado', () => {
  const h = renderFilters({}, { dateLabels: { from: 'Lançamento a partir de', to: 'Lançamento até' } });
  assert.ok(h.node('Field', { label: 'Lançamento a partir de' }).children.some(n => n.type === 'DatePickerField'));
  assert.ok(h.node('Field', { label: 'Lançamento até' }).children.some(n => n.type === 'DatePickerField'));
  assert.equal(h.nodes().filter(n => n.type === 'ThemedText' && String(n.props.children).startsWith('Data')).length, 0);
});

test('digitar modifica somente draft; Aplicar publica um payload e fecha depois', () => {
  const value = wire(original);
  const h = renderFilters(value);
  h.act(h.node('TextField'), 'onChangeText', 'farmacia');
  h.act(h.node('DatePickerField', { accessibilityLabel: 'Data a partir de' }), 'onChange', '02/09/2026');
  h.act(h.node('MoneyField', { accessibilityLabel: 'Valor mínimo do filtro' }), 'onChangeCents', 200);
  assert.deepEqual(h.applied, []);
  assert.deepEqual(value, original);
  assert.equal(h.button('Aplicar').props.disabled, false);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{ ...original, q: 'farmacia', from: '2026-09-02', minCents: 200 }]);
  assert.deepEqual(h.events, ['apply', 'close']);
});

for (const closeTarget of ['Sheet', 'TaskHeader']) {
  test(`${closeTarget}: fechar/voltar cancela e reabrir remonta draft do valor publicado`, () => {
    const value = wire(original);
    const h = renderFilters(value);
    h.act(h.node('TextField'), 'onChangeText', 'rascunho cancelado');
    h.act(h.button('Limpar filtros'), 'onPress');
    h.act(h.node(closeTarget), 'onClose');
    assert.deepEqual(h.events, ['close']);
    assert.deepEqual(h.applied, []);
    assert.deepEqual(value, original, 'limpeza cancelada nao altera objeto do pai');
    assert.equal(h.node('Sheet').children.length, 0);
    const next = { ...value, q: 'novo valor do pai' };
    h.open(next);
    assert.equal(h.node('TextField').props.value, 'novo valor do pai');
    assert.equal(h.node('DatePickerField', { accessibilityLabel: 'Data a partir de' }).props.value, '01/09/2026');
    assert.equal(h.select('Conta').props.value, 'a');
    assert.equal(h.node('MoneyField', { accessibilityLabel: 'Valor máximo do filtro' }).props.valueCents, 20000);
  });
}

test('Limpar zera busca, datas, valores e selecoes mas somente Aplicar publica a limpeza', () => {
  const h = renderFilters(wire(original));
  h.act(h.button('Limpar filtros'), 'onPress');
  assert.deepEqual(h.applied, []);
  assert.equal(h.node('TextField').props.value, '');
  for (const label of ['Data a partir de', 'Data até'])
    assert.equal(h.node('DatePickerField', { accessibilityLabel: label }).props.value, null);
  assert.equal(h.node('SwitchRow', { label: 'Valor mínimo' }).props.value, false);
  assert.equal(h.node('SwitchRow', { label: 'Valor máximo' }).props.value, false);
  assert.equal(h.nodes().filter(n => n.type === 'MoneyField').length, 0);
  assert.equal(h.select('Conta').props.value, null);
  assert.equal(h.select('Origem').props.value, null);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{}]);
});

test('Voltar ao mês remove somente o intervalo e exige Aplicar; cancelar preserva o recorte publicado', () => {
  const h = renderFilters(wire(original), { resetDatesLabel: 'Voltar ao mês' });
  h.act(h.node('HeaderIconButton', { label: 'Voltar ao mês' }), 'onPress');
  assert.equal(h.nodes().filter(n => n.type === 'Button' && String(n.props.label).startsWith('Remover data')).length, 0);
  assert.equal(h.node('DatePickerField', { accessibilityLabel: 'Data a partir de' }).props.value, null);
  assert.equal(h.node('DatePickerField', { accessibilityLabel: 'Data até' }).props.value, null);
  assert.equal(h.select('Conta').props.value, 'a');
  assert.equal(h.node('TextField').props.value, original.q);
  assert.equal(h.node('MoneyField', { accessibilityLabel: 'Valor máximo do filtro' }).props.valueCents, original.maxCents);
  assert.deepEqual(h.applied, []);
  h.act(h.node('TaskHeader'), 'onClose');
  h.open(wire(original));
  assert.equal(h.node('DatePickerField', { accessibilityLabel: 'Data a partir de' }).props.value, '01/09/2026');
  h.act(h.node('HeaderIconButton', { label: 'Voltar ao mês' }), 'onPress');
  h.act(h.button('Aplicar'), 'onPress');
  const { from: _from, to: _to, ...expected } = original;
  assert.deepEqual(h.applied, [expected]);
});

test('ícone único limpa datas em listas com bordas independentes sem alterar seleções', () => {
  for (const value of [{ ...original, to: undefined }, { ...original, from: undefined }]) {
    const h = renderFilters(wire(value));
    const reset = h.node('HeaderIconButton', { label: 'Limpar datas' });
    assert.equal(reset.props.hint, 'Remove as duas datas. Os outros filtros são mantidos.');
    h.act(reset, 'onPress');
    assert.deepEqual(h.applied, []);
    assert.equal(h.select('Conta').props.value, 'a');
    assert.equal(h.nodes().filter(n => n.type === 'HeaderIconButton').length, 0);
    h.act(h.button('Aplicar'), 'onPress');
    const { from: _from, to: _to, ...expected } = value;
    assert.deepEqual(h.applied, [wire(expected)]);
  }
});


test('apenas uma data é aplicável e publica somente a borda escolhida', () => {
  for (const value of [{ from: '2026-09-01' }, { to: '2026-09-30' }]) {
    const h = renderFilters(value);
    assert.equal(h.button('Aplicar').props.disabled, false);
    h.act(h.button('Aplicar'), 'onPress');
    assert.deepEqual(h.applied, [{ ...value, selections: {} }]);
    assert.deepEqual(h.events, ['apply', 'close']);
  }
});

test('erro de intervalo aparece junto à data final e desaparece ao corrigir a ordem', () => {
  const h = renderFilters({ from: '2026-10-01', to: '2026-09-30' });
  const field = h.node('Field', { label: 'Data até' });
  assert.ok(field.actions.some(n => n.type === 'ThemedText' && n.props.accessibilityRole === 'alert'), 'não esconder o motivo no fim da folha');
  assert.equal(h.nodes().filter(n => n.type === 'ThemedText' && n.props.accessibilityRole === 'alert').length, 1);
  h.act(h.node('DatePickerField', { accessibilityLabel: 'Data até' }), 'onChange', '01/10/2026');
  assert.equal(h.button('Aplicar').props.disabled, false);
  assert.equal(h.nodes().filter(n => n.type === 'ThemedText' && n.props.accessibilityRole === 'alert').length, 0);
});

for (const [name, value] of [
  ['data impossivel', { from: '2026-02-31', to: '2026-03-01' }],
  ['ordem das datas', { from: '2026-03-02', to: '2026-03-01' }],
  ['minimo acima do maximo', { minCents: 101, maxCents: 100 }],
  ['valor negativo', { minCents: -1 }],
  ['centavos fracionarios', { maxCents: 1.5 }],
] as [string, Value][]) {
  test(`${name}: erro inline desabilita Aplicar e o handler tambem recusa`, () => {
    const h = renderFilters(value);
    assert.equal(h.button('Aplicar').props.disabled, true);
    assert.ok(h.node('ThemedText', { accessibilityRole: 'alert' }).props.children);
    h.act(h.button('Aplicar'), 'onPress');
    assert.deepEqual(h.applied, []);
    assert.deepEqual(h.events, [], 'handler invalido nem fecha a folha');
  });
}

test('data invalida digitada atualiza validacao sem publicar o draft', () => {
  const h = renderFilters({ from: '2026-02-01', to: '2026-03-01' });
  h.act(h.node('DatePickerField', { accessibilityLabel: 'Data a partir de' }), 'onChange', '31/02/2026');
  assert.equal(h.button('Aplicar').props.disabled, true);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, []);
});

test('minimo/maximo zero e intervalo do mesmo dia sao validos e publicados', () => {
  const h = renderFilters({ from: '2026-09-30', to: '2026-09-30' });
  h.act(h.node('SwitchRow', { label: 'Valor mínimo' }), 'onValueChange', true);
  h.act(h.node('SwitchRow', { label: 'Valor máximo' }), 'onValueChange', true);
  assert.equal(h.node('MoneyField', { accessibilityLabel: 'Valor mínimo do filtro' }).props.valueCents, 0);
  assert.equal(h.node('MoneyField', { accessibilityLabel: 'Valor máximo do filtro' }).props.valueCents, 0);
  assert.equal(h.button('Aplicar').props.disabled, false);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{ from: '2026-09-30', to: '2026-09-30', selections: {}, minCents: 0, maxCents: 0 }]);
});

test('selecao null remove so a chave escolhida e preserva objeto original/conjunto de opcoes', () => {
  const value = Object.freeze({ ...original, selections: Object.freeze({ ...original.selections }) });
  const h = renderFilters(value);
  assert.equal((h.select('Conta').props.options as { id: string | null }[])[0].id, null);
  h.act(h.select('Conta'), 'onChange', null);
  assert.equal(h.select('Conta').props.value, null);
  assert.equal(h.select('Origem').props.value, 'csv');
  assert.deepEqual(value, original);
  h.act(h.button('Aplicar'), 'onPress');
  assert.deepEqual(h.applied, [{ ...original, selections: { accountId: '', source: 'csv' } }]);
});

test('cabecalho fica presente e SheetScroll e o ultimo filho da folha', () => {
  const h = renderFilters();
  const children = h.node('Sheet').children;
  assert.equal(children[0].type, 'TaskHeader');
  assert.equal(children[0].props.title, 'Filtros');
  assert.equal(typeof children[0].props.onClose, 'function');
  assert.equal(children[0].actions[0].type, 'Button');
  assert.equal(children.at(-1)!.type, 'SheetScroll');
});
