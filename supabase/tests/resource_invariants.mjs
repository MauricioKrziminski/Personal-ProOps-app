// Execute the production Python resource SQL against migration-derived PGlite tables.
// No credentials, external database, API, or model. Usage:
// node supabase/tests/resource_invariants.mjs /absolute/path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL, fileURLToPath } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const root = fileURLToPath(new URL('../../', import.meta.url));
const migration = async (name) => readFile(new URL('../migrations/'+name, import.meta.url), 'utf8');
const statement = (source, prefix) => {
  source = source.replace(/--[^\n]*/g, '');
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, 'missing migration fragment '+prefix);
  return source.slice(start, source.indexOf(';',start)+1);
};
const history = [];
try {
  await db.exec(`create schema private; create schema auth; create role anon; create role authenticated; create function auth.uid() returns uuid language sql as $$ select null::uuid $$; create table profiles(id uuid primary key); create table workspaces(id uuid primary key);
    create function public.my_default_workspace() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    insert into profiles values('00000000-0000-0000-0000-000000000002');
    insert into workspaces values('00000000-0000-0000-0000-000000000001');`);
  const sources = {
    '0005_finance_core.sql':['accounts','transactions','goals','budgets','recurring_transactions'],
    '0001_init.sql':['notes','reminders'],
    '0038_notes_folders_search.sql':['note_folders'],
    '0023_debts.sql':['debts'],
    '0026_net_worth.sql':['assets'],
    '0017_import_and_rules.sql':['categorization_rules'],
  };
  for (const [file,tables] of Object.entries(sources)) {
    const sql = await migration(file);
    for (const table of tables) {
      const prefix = sql.includes('create table if not exists public.'+table+' (') ? 'create table if not exists public.' : 'create table public.';
      await db.exec(statement(sql,prefix+table+' ('));
    }
  }
  // Same column definition as the dynamic migration 0010 workspace upgrade.
  const workspaceMigration = await migration('0010_workspaces.sql');
  assert.ok(workspaceMigration.includes('add column if not exists workspace_id uuid'));
  for (const table of ['accounts','transactions','goals','budgets','recurring_transactions','notes','reminders']) {
    await db.exec(`alter table public.${table} add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade default public.my_default_workspace() not null`);
  }
  for (const prefix of ['alter table public.accounts drop constraint', 'alter table public.goals drop constraint', 'alter table public.budgets drop constraint', 'create unique index if not exists accounts_ws_name_key', 'create unique index if not exists goals_ws_name_key', 'create unique index if not exists budgets_ws_category_key']) {
    await db.exec(statement(workspaceMigration,prefix));
  }
  const cards = await migration('0013_cards_and_installments.sql');
  for (const prefix of ['alter table public.accounts\n  add column','alter table public.accounts add constraint accounts_card_fields_chk','alter table public.accounts add constraint accounts_payment_self_chk']) {
    await db.exec(statement(cards,prefix));
  }
  for (const [file,prefix] of [
    ['0014_forecast.sql','alter table public.recurring_transactions'],
    ['0015_recurring_dtstart.sql','alter table public.recurring_transactions'],
    ['0022_budgets_month_and_goal_ledger.sql','alter table public.budgets\n  add column'],
    ['0038_notes_folders_search.sql','alter table public.notes\n'],
    ['0049_alert_optout_and_nested_folders.sql','alter table public.note_folders\n'],
  ]) await db.exec(statement(await migration(file),prefix));
  // Full 0057 triggers/RPC, with the exact prerequisite table/column fragments.
  await db.exec(statement(cards,'create table if not exists public.card_invoices ('));
  await db.exec(statement(cards,'create table if not exists public.installment_plans ('));
  await db.exec(statement(cards,'alter table public.transactions\n  add column'));
  await db.exec(statement(await migration('0023_debts.sql'),'alter table public.transactions\n  add column'));
  await db.exec(cards.slice(cards.indexOf('create or replace function private.day_in_month'),cards.indexOf('-- ── cartão:')));
  await db.exec(await migration('0057_finance_edit_and_debt_accounts.sql'));
  const budgets = await migration('0022_budgets_month_and_goal_ledger.sql');
  for(const prefix of ['drop index if exists budgets_ws_category_key','create unique index if not exists budgets_ws_category_default_key','create unique index if not exists budgets_ws_category_month_key']) await db.exec(statement(budgets,prefix));
  await db.exec(`insert into budgets(user_id,workspace_id,category,limit_cents) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','mercado',9000)`);
  await db.exec(`insert into accounts(user_id,workspace_id,name,type) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Banco base','checking');
    insert into note_folders(user_id,workspace_id,name) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','pasta base');`);
  const child = spawn(root+'agent/.venv/bin/python',[root+'agent/scripts/verify_resource_sql.py'],{cwd:root,stdio:['pipe','pipe','inherit']});
  let completed;
  const exited = new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  for await (const line of createInterface({input:child.stdout})) {
    const message = JSON.parse(line);
    if (message.query) {
      let index=0;
      const sql=message.query.replaceAll('%s',()=>'$'+(++index));
      history.push(message);
      try { const result=await db.query(sql,message.params); child.stdin.write(JSON.stringify({rows:result.rows})+'\n'); }
      catch(error) { child.stdin.write(JSON.stringify({error:error.message})+'\n'); }
    } else {
      console.log(message);
      if(message.done) completed=message;
    }
  }
  await writeFile('/tmp/resource-sql-capture.json',JSON.stringify(history,null,2));
  assert.equal(await exited,0,'Python resource operations failed');
  assert.ok(completed?.done);
  assert.deepEqual(completed.failures,[]);
  console.log(`PASS: 11 catalogue resources × CREATE/UPDATE/LIST/DELETE; ${history.length} production SQL statements on migration-derived tables; debt PAY RPC/0057 triggers and stale-proposal guards passed. Capture: /tmp/resource-sql-capture.json`);
} finally { await db.close(); }
