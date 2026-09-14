/**
 * Toda coluna que o agente ESCREVE precisa existir no schema.
 *
 * ⚠️ **Isto não é zelo: `importar extrato` ficou 100% quebrado por uma palavra, desde o corte
 * para o Python.** `agent/app/jobs/importer.py` escrevia em `import_items (… , category)`, mas a
 * coluna se chama `suggested_category` desde a migration `0017_import_and_rules.sql` — anos antes
 * do agente existir. Toda importação devolvia **500**, o lote nascia vazio e a tela ficava
 * girando. Descoberto em 14/09/2026 importando um OFX de verdade; o pytest não pegava porque
 * teste que fala com banco não entra na suíte (`agent.md`), e não havia teste nenhum cobrindo
 * `importer.run`.
 *
 * A guarda certa não é "escrever um teste para o importer": é **conferir o contrato inteiro de
 * uma vez, sem banco**. `src/lib/database.types.ts` é gerado do schema pelo
 * `supabase gen types`, então ele é a verdade — e este teste compara contra ele TODO
 * `insert into public.<tabela> (...)` literal do agente.
 *
 * O que ele NÃO cobre, e de propósito: `update ... set`, SQL montado em runtime e chamada de RPC.
 * Insert literal é onde a divergência de nome é silenciosa e fatal; o resto tem outras redes.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const RAIZ_AGENTE = new URL('../../agent/app/', import.meta.url).pathname;
const TIPOS = readFileSync(new URL('./database.types.ts', import.meta.url), 'utf8');

function arquivosPython(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      return nome === '__pycache__' ? [] : arquivosPython(caminho);
    }
    return nome.endsWith('.py') ? [caminho] : [];
  });
}

/** As colunas de uma tabela, lidas do bloco `Row:` dos tipos gerados. */
function colunasDe(tabela: string): string[] | null {
  const re = new RegExp(`\\n      ${tabela}: \\{\\n        Row: \\{([\\s\\S]*?)\\n        \\}`);
  const m = TIPOS.match(re);
  if (!m) return null;
  return [...m[1].matchAll(/^\s+([a-z_]+)\??:/gm)].map((x) => x[1]);
}

test('todo insert do agente escreve em coluna que existe', () => {
  const problemas: string[] = [];
  let inserts = 0;

  for (const caminho of arquivosPython(RAIZ_AGENTE)) {
    const py = readFileSync(caminho, 'utf8');
    for (const m of py.matchAll(/insert\s+into\s+public\.([a-z_]+)\s*\(([^)]*)\)/gi)) {
      inserts += 1;
      const tabela = m[1];
      const escritas = m[2]
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const reais = colunasDe(tabela);
      const curto = caminho.slice(caminho.indexOf('agent/'));
      if (!reais) {
        problemas.push(`${curto}: tabela "${tabela}" não existe no schema`);
        continue;
      }
      for (const col of escritas) {
        if (!reais.includes(col)) {
          problemas.push(`${curto}: ${tabela} não tem a coluna "${col}"`);
        }
      }
    }
  }

  assert.ok(inserts > 0, 'nenhum insert encontrado — o formato do SQL mudou e o teste ficou cego');
  assert.deepEqual(problemas, []);
});
