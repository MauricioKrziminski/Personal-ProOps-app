// Isolated PostgreSQL (PGlite) regression harness. No credentials or remote database.
// node supabase/tests/finance_invariants.mjs /absolute/path/to/pglite/dist/index.js [--before]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    create schema private; create schema auth;
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table accounts(id uuid primary key, workspace_id uuid, user_id uuid, type text, closing_day int, due_day int, archived boolean default false);
    create table card_invoices(id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, account_id uuid, reference_month date, closing_date date, due_date date, unique(account_id,reference_month));
    create table debts(id uuid primary key, workspace_id uuid, user_id uuid, name text, remaining_cents bigint, interest_rate_monthly numeric, account_id uuid, installments int, installments_paid int default 0, archived boolean default false);
    create table transactions(id uuid primary key default gen_random_uuid(), workspace_id uuid, user_id uuid, account_id uuid, invoice_id uuid, occurred_at date, due_at date, kind text, amount_cents bigint, category text, description text, source text, status text, debt_id uuid);
  `);
  const cards = await readFile(new URL('../migrations/0013_cards_and_installments.sql', import.meta.url), 'utf8');
  await db.exec(cards.slice(cards.indexOf('create or replace function private.day_in_month'), cards.indexOf('-- ── cartão:')));
  if (process.argv.includes('--before')) {
    await db.exec(cards.slice(cards.indexOf('create or replace function public.tg_transactions_set_invoice'), cards.indexOf('/**\n * Cria a compra parcelada')));
  } else {
    await db.exec(await readFile(new URL('../migrations/0057_finance_edit_and_debt_accounts.sql', import.meta.url), 'utf8'));
  }
  const ws='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002';
  const cardA='10000000-0000-0000-0000-000000000001', cardB='10000000-0000-0000-0000-000000000002', bank='10000000-0000-0000-0000-000000000003', foreign='10000000-0000-0000-0000-000000000004';
  await db.query(`insert into accounts(id,workspace_id,type,closing_day,due_day) values ($1,$5,'credit_card',10,20),($2,$5,'credit_card',5,15),($3,$5,'checking',null,null),($4,$6,'checking',null,null)`,[cardA,cardB,bank,foreign,ws,other]);
  const {rows:[tx]}=await db.query(`insert into transactions(workspace_id,account_id,occurred_at,kind,amount_cents) values($1,$2,'2026-09-08','expense',10000) returning id`,[ws,cardA]);
  await db.query(`update transactions set occurred_at='2026-09-12' where id=$1`,[tx.id]);
  let {rows:[row]}=await db.query(`select t.due_at::text, c.due_date::text from transactions t join card_invoices c on c.id=t.invoice_id where t.id=$1`,[tx.id]);
  assert.equal(row.due_at, '2026-10-20', 'date edit must replace inherited invoice deadline');
  assert.equal(row.due_at,row.due_date);
  await db.query(`update transactions set account_id=$1 where id=$2`,[cardB,tx.id]);
  ({rows:[row]}=await db.query(`select due_at::text from transactions where id=$1`,[tx.id]));
  assert.equal(row.due_at,'2026-10-15','card switch must use new deadline');
  await db.query(`update transactions set account_id=$1 where id=$2`,[bank,tx.id]);
  ({rows:[row]}=await db.query(`select due_at,invoice_id from transactions where id=$1`,[tx.id]));
  assert.equal(row.due_at,null); assert.equal(row.invoice_id,null);
  await db.query(`update transactions set account_id=$1 where id=$2`,[cardA,tx.id]);
  await db.query(`update transactions set account_id=$1,due_at='2026-12-01' where id=$2`,[bank,tx.id]);
  ({rows:[row]}=await db.query(`select due_at::text from transactions where id=$1`,[tx.id]));
  assert.equal(row.due_at,'2026-12-01','explicit bank pending deadline is preserved');
  await assert.rejects(db.query(`update transactions set account_id=$1 where id=$2`,[foreign,tx.id]),/workspace/);
  const debt='20000000-0000-0000-0000-000000000001';
  await db.query(`insert into debts(id,workspace_id,name,remaining_cents,interest_rate_monthly,account_id,installments) values($1,$2,'Carro',100000,0.01,$3,12)`,[debt,ws,bank]);
  await assert.rejects(db.query(`update debts set account_id=$1 where id=$2`,[cardA,debt]),/conta ativa/);
  await assert.rejects(db.query(`select pay_debt_installment($1,11000,$2)`,[debt,foreign]),/inválida|workspace/);
  await assert.rejects(db.query(`select pay_debt_installment($1,1000)`,[debt]),/amortizar/);
  await assert.rejects(db.query(`select pay_debt_installment($1,101001)`,[debt]),/quitação/);
  await db.query(`select pay_debt_installment($1,11000)`,[debt]);
  ({rows:[row]}=await db.query(`select remaining_cents::int,installments_paid from debts where id=$1`,[debt]));
  assert.deepEqual(row,{remaining_cents:90000,installments_paid:1});
  ({rows:[row]}=await db.query(`select count(*)::int as count,min(amount_cents)::int as amount,min(account_id::text) as payer from transactions where debt_id=$1`,[debt]));
  assert.deepEqual(row,{count:1,amount:11000,payer:bank});
  const {rows:[payment]} = await db.query('select id from transactions where debt_id=$1',[debt]);
  await db.query('update transactions set amount_cents=21000 where id=$1',[payment.id]);
  ({rows:[row]}=await db.query('select remaining_cents::int,installments_paid from debts where id=$1',[debt]));
  assert.deepEqual(row,{remaining_cents:80000,installments_paid:1},'latest amount correction adjusts principal once');
  await db.query('update transactions set debt_principal_cents=999999 where id=$1',[payment.id]);
  ({rows:[row]}=await db.query('select debt_principal_cents::int as principal from transactions where id=$1',[payment.id]));
  assert.equal(row.principal,20000,'API patch cannot forge allocation');
  await db.query('select pay_debt_installment($1,10800)',[debt]);
  await assert.rejects(db.query('update transactions set amount_cents=22000 where id=$1',[payment.id]),/mais recente/);
  await assert.rejects(db.query("update transactions set occurred_at=current_date + 1 where id=$1",[payment.id]),/ordem de amortização/);
  await db.query('update transactions set account_id=null where id=$1',[payment.id]);
  await db.query('delete from transactions where debt_id=$1 and debt_payment_no=2',[debt]);
  await db.query('delete from transactions where id=$1',[payment.id]);
  ({rows:[row]}=await db.query('select remaining_cents::int,installments_paid from debts where id=$1',[debt]));
  assert.deepEqual(row,{remaining_cents:100000,installments_paid:0},'reverse latest payments restores initial principal');
  await db.query('select pay_debt_installment($1,11000)',[debt]);
  await db.exec('alter table transactions disable trigger sync_debt_payment');
  await db.query('update transactions set debt_payment_no=null,debt_principal_cents=null,debt_interest_cents=null,debt_balance_after_cents=null where debt_id=$1',[debt]);
  await db.exec('alter table transactions enable trigger sync_debt_payment');
  await assert.rejects(db.query('update transactions set amount_cents=12000 where debt_id=$1',[debt]),/antigo sem histórico/);
  await db.query('update transactions set account_id=null where debt_id=$1',[debt]);
  console.log('PASS: invoice date/card changes, inherited vs explicit deadline, cross-workspace rejection, debt account, amount bounds, amortization and single expense.');
} finally { await db.close(); }
