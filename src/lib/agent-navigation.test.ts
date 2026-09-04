import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * As três tab bars precisam ter os MESMOS cinco destinos, na MESMA ordem.
 *
 * Elas são três arquivos por plataforma de propósito (a regra está em
 * `frontend.md`): a implementação diverge, o contrato não. E a divergência é
 * invisível na leitura — cada arquivo parece certo sozinho. O sintoma seria uma
 * aba que existe no iOS e some no Android, ou a ordem trocada entre as duas, o
 * que muda o índice do berço do `CurvedTabBar` e faz a bolha parar no slot
 * errado.
 *
 * Lê os arquivos como TEXTO: eles importam React Native e não rodam no
 * `node --test`. Mesma estratégia de `icon-map.test.ts` e `categories.test.ts`.
 */
const SRC = join(import.meta.dirname, '..');

const ORDEM = ['today', 'notes', 'finance', 'agent', 'profile'] as const;

function ler(arquivo: string): string {
  return readFileSync(join(SRC, arquivo), 'utf8');
}

/** A ordem em que os nomes das abas aparecem no arquivo, sem repetir. */
function ordemDeAbas(fonte: string): string[] {
  const achados: string[] = [];
  const re = /['"](today|notes|finance|agent|profile)['"]/g;
  for (const m of fonte.matchAll(re)) {
    if (!achados.includes(m[1])) achados.push(m[1]);
  }
  return achados;
}

const ARQUIVOS = [
  'components/app-tabs.tsx',
  'components/app-tabs.android.tsx',
  'components/app-tabs.web.tsx',
];

for (const arquivo of ARQUIVOS) {
  test(`${arquivo} tem os cinco destinos na ordem canônica`, () => {
    assert.deepEqual(ordemDeAbas(ler(arquivo)), [...ORDEM]);
  });

  test(`${arquivo} declara cada destino uma vez só`, () => {
    const fonte = ler(arquivo);
    for (const nome of ORDEM) {
      const vezes = [...fonte.matchAll(new RegExp(`name=["']${nome}["']|['"]${nome}['"]:`, 'g'))];
      assert.ok(vezes.length <= 1, `${nome} aparece ${vezes.length}× como destino`);
    }
  });
}

test('o Android navega para os cinco hrefs, na mesma ordem', () => {
  // `HREFS` é indexado pela posição do slot: uma entrada fora de ordem manda a
  // pessoa para a tela errada, com a barra animando para o lugar certo.
  const fonte = ler('components/app-tabs.android.tsx');
  const linha = fonte.match(/const HREFS = \[(.*?)\]/s);
  assert.ok(linha, 'não achei HREFS');
  const hrefs = [...linha[1].matchAll(/'\/([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, [...ORDEM]);
});

test('a vitrine visual monta as cinco raízes', () => {
  // `design-preview` é como as raízes são vistas sem login. Uma raiz de fora
  // dela é uma tela que volta a ser entregue no escuro — já aconteceu duas vezes.
  const fonte = ler('app/design-preview.tsx');
  for (const nome of ORDEM) {
    assert.ok(
      new RegExp(`['"]${nome}['"]`).test(fonte),
      `design-preview não conhece a raiz ${nome}`,
    );
  }
});

test('a aba do agente usa os SF Symbols que estão no mapa do Icon', () => {
  // `expo-symbols` não traduz nome sozinho: fora do mapa o ícone vira um
  // `circle` vazio no Android, em silêncio.
  const icon = readFileSync(join(SRC, 'components/ui/icon.tsx'), 'utf8');
  for (const sf of ['bubble.left.and.bubble.right', 'bubble.left.and.bubble.right.fill']) {
    assert.ok(icon.includes(`'${sf}'`), `${sf} não está no mapa SF → Material`);
  }
});
