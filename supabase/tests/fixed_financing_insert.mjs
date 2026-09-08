// O INSERT que o agente monta para um financiamento simples, contra o check real.
//
// `_derive_fixed_installments` existe só para satisfazer
// `debts_fixed_installments_check`. O pytest prova a aritmética; ele não prova
// que a linha entra — e uma violação de check estouraria DEPOIS do "sim" do
// usuário, que é o pior lugar possível.
//
// PGlite fica FORA do projeto de propósito, igual ao `resource_invariants.mjs`:
// é dependência de teste de SQL, não do app. Uso:
//   node supabase/tests/fixed_financing_insert.mjs /caminho/pglite/dist/index.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.ok(process.argv[2], 'informe o caminho do pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);

const migration = (name) => readFile(new URL('../migrations/' + name, import.meta.url), 'utf8');
const statement = (source, prefix) => {
  source = source.replace(/--[^\n]*/g, '');
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, 'fragmento ausente: ' + prefix);
  return source.slice(start, source.indexOf(';', start) + 1);
};

// Os MESMOS valores que `resources.validate_fields` produz, tirados do módulo
// de produção — não uma cópia escrita à mão que pode divergir dele.
const valores = JSON.parse(
  execFileSync(
    root + 'agent/.venv/bin/python',
    ['-c', `import json
from app.graph.schemas import ResourceAction, ResourceField
from app.tools import resources
acao = ResourceAction(type="resource_create", resource="debts", name="carro",
    fields=[ResourceField(name=k, value=str(v)) for k, v in {
        "kind": "financing", "installments": 48,
        "installment_cents": 147000, "installments_paid": 8}.items()])
print(json.dumps(resources.validate_fields(acao)))`],
    { cwd: root + 'agent', encoding: 'utf8' }
  )
);

const db = new PGlite();
await db.exec(`create schema private; create table profiles(id uuid primary key); create table workspaces(id uuid primary key);
  create table accounts(id uuid primary key);
  create function public.my_default_workspace() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
  insert into profiles values('00000000-0000-0000-0000-000000000002');
  insert into workspaces values('00000000-0000-0000-0000-000000000001');`);
await db.exec(statement(await migration('0023_debts.sql'), 'create table if not exists public.debts ('));
await db.exec(statement(await migration('20260908201355_fixed_installment_financing.sql'), 'alter table public.debts'));

const chaves = [...Object.keys(valores), 'user_id', 'workspace_id'];
const parametros = [
  ...Object.values(valores),
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
];
const inserir = (linha) =>
  db.query(
    `insert into public.debts (${chaves.join(', ')}) values (${chaves.map((_, i) => '$' + (i + 1))}) returning id`,
    linha
  );

const { rows } = await inserir(parametros);
assert.equal(rows.length, 1, 'o financiamento simples do agente precisa entrar');

// A trava é o check, não o nosso código: uma derivação torta tem que ser
// RECUSADA pelo banco, senão este teste não prova nada.
const torto = [...parametros];
torto[chaves.indexOf('name')] = 'outro';
torto[chaves.indexOf('remaining_cents')] = 1;
await assert.rejects(() => inserir(torto), /debts_fixed_installments_check/);

const comJuros = [...parametros];
comJuros[chaves.indexOf('name')] = 'terceiro';
comJuros[chaves.indexOf('interest_rate_monthly')] = '0.0199';
await assert.rejects(() => inserir(comJuros), /debts_fixed_installments_check/);

console.log('ok: insert de financiamento simples aceito; derivação torta recusada pelo check');
