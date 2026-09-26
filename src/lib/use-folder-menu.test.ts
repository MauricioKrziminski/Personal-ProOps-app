import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * O menu do toque longo no ladrilho da pasta (Notas e dentro de uma pasta).
 *
 * 25/09/2026: *"Eu não consigo apagar uma pasta?"* — ali só havia Fixar, Cor, Arquivar e Abrir;
 * apagar existia só em "Gerenciar pastas", a duas telas de distância do que a pessoa segura.
 */
function transpilar(caminho: string) {
  return ts.transpileModule(readFileSync(new URL(caminho, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function montar() {
  const folhas: { titulo: string; acoes: { label: string; destructive?: boolean; onPress: () => void }[] }[] = [];
  const apagadas: string[] = [];
  const renomeadas: string[] = [];
  const movidas: string[] = [];
  const carregar = (caminho: string, extras: Record<string, unknown>) => {
    const mod = { exports: {} as any };
    runInNewContext(transpilar(caminho), {
      module: mod,
      exports: mod.exports,
      require: (nome: string) => {
        if (nome in extras) return extras[nome];
        throw new Error(`módulo inesperado: ${nome}`);
      },
    });
    return mod.exports;
  };
  const acoes = carregar('../components/notes/note-actions.ts', {
    '@/lib/item-actions': {
      showItemActions: (titulo: string, lista: any[]) => folhas.push({ titulo, acoes: lista }),
    },
  });
  const menu = carregar('../components/notes/use-folder-menu.ts', {
    react: { useCallback: (fn: unknown) => fn },
    'expo-router': { router: { push: () => {} } },
    'expo-haptics': { impactAsync: () => {}, notificationAsync: () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    '@/components/notes/note-actions': acoes,
    '@/components/notes/nova-pasta': { useMoverPasta: () => (f: { id: string }) => movidas.push(f.id) },
    '@/components/ui/toast': { useToast: () => () => {} },
    '@/hooks/use-notes': {
      useUpdateFolder: () => ({ mutate: () => {} }),
      useDeleteFolder: () => ({ mutate: (id: string) => apagadas.push(id) }),
    },
  });
  return {
    abrir: menu.useFolderMenu({ onColor: () => {}, onRename: (f: { id: string }) => renomeadas.push(f.id), pastas: [] }),
    folhas,
    apagadas,
    renomeadas,
    movidas,
  };
}

test('segurar a pasta oferece Apagar, e apagar confirma antes', () => {
  const { abrir, folhas, apagadas } = montar();
  abrir({ id: 'f1', name: 'compras', notes_count: 3, pinned: false });
  const apagar = folhas[0].acoes.find((a) => a.label === 'Apagar');
  assert.ok(apagar, 'o menu do ladrilho tem Apagar');
  assert.equal(apagar!.destructive, true);

  apagar!.onPress();
  assert.equal(apagadas.length, 0, 'nada é apagado sem confirmar');
  const confirmacao = folhas[1];
  assert.equal(confirmacao.titulo, 'Apagar a pasta compras?');
  const sim = confirmacao.acoes.find((a) => a.label === 'Apagar pasta');
  assert.equal(sim?.destructive, true);
  sim!.onPress();
  assert.deepEqual(apagadas, ['f1']);
});

test('segurar a pasta também renomeia e move — sem ir a Organizar pastas (25/09/2026)', () => {
  const { abrir, folhas, renomeadas, movidas } = montar();
  abrir({ id: 'f1', name: 'compras', notes_count: 3, pinned: false });
  const acao = (label: string) => folhas[0].acoes.find((a) => a.label === label);
  acao('Renomear')!.onPress();
  acao('Mover para dentro de…')!.onPress();
  assert.deepEqual(renomeadas, ['f1']);
  assert.deepEqual(movidas, ['f1']);
  assert.equal(folhas[0].acoes.at(-1)!.label, 'Apagar', 'apagar continua por último, destrutivo');
});
