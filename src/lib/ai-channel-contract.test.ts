import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const legacyWorker = readFileSync('supabase/functions/process-jobs/index.ts', 'utf8');
const pythonDb = readFileSync('agent/app/db.py', 'utf8');

test('cada escritor de ai_events atribui workspace e canal', () => {
  const legacyInsert = legacyWorker.slice(
    legacyWorker.indexOf('const { data: aiEvent }'),
    legacyWorker.indexOf('// 5. executa cada ação'),
  );
  assert.match(legacyInsert, /workspace_id:\s*workspaceId/);
  assert.match(legacyInsert, /channel:\s*["']whatsapp["']/);

  const pythonInsert = pythonDb.slice(
    pythonDb.indexOf('async def record_ai_event'),
    pythonDb.indexOf('# ---------------------------------------------------------------------------\n# rascunhos'),
  );
  assert.match(pythonInsert, /workspace_id/);
  assert.match(pythonInsert, /channel/);
  assert.match(pythonInsert, /insert into public\.ai_events/);
});
