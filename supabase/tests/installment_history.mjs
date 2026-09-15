// Real PostgreSQL semantics in isolated PGlite; no credentials, no remote writes.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
 await db.exec(`create schema private; create schema auth; create role anon; create role authenticated; create role service_role;
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table accounts(id uuid primary key,workspace_id uuid,user_id uuid,archived boolean default false);
 create table installment_plans(id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,account_id uuid,description text,merchant text,category text,total_cents bigint,installments int,first_occurred_at date);
 create table recurring_transactions(id uuid primary key,auto_confirm boolean);
 create table transactions(id uuid primary key default gen_random_uuid(),workspace_id uuid,user_id uuid,kind text,amount_cents bigint,category text,description text,merchant text,account_id uuid,occurred_at date,source text,status text,installment_plan_id uuid,installment_no int,recurring_id uuid);
 create function private.add_months(d date,n int) returns date language sql as $$select (d+make_interval(months=>n))::date$$;
 insert into accounts values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null,false);`);
 const old = await readFile(new URL('../migrations/0013_cards_and_installments.sql', import.meta.url),'utf8');
 await db.exec(old.slice(old.indexOf('create or replace function public.create_installment_plan('),old.indexOf('/**\n * Paga a fatura:')));
 if (!process.argv.includes('--before')) {
  const files=await readdir(new URL('../migrations/',import.meta.url));
  // ⚠️ Aplicar UMA migration pelo nome deixa o teste preso na definição daquele dia. Este
  // arquivo exercitava só a `_explicit_installment_history`, então a correção de 15/09/2026
  // (a parcela herdar o nome do estabelecimento) podia ser revertida com o teste verde.
  // Cada migration que REDEFINE esta função entra na lista, em ordem.
  for (const sufixo of ['_explicit_installment_history.sql',
                        '_a_parcela_herda_o_nome_do_estabelecimento.sql']) {
   const file=files.find(f=>f.endsWith(sufixo));
   assert.ok(file,`migration ausente: ${sufixo}`);
   await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  }
 }
 const account='10000000-0000-0000-0000-000000000001';
 await assert.rejects(db.query(`select create_installment_plan($1,7056000,48,(current_date-interval '8 months')::date)`,[account]),/pagas|histórico/i,'legacy retrospective creation must ask paid history');
 for(const count of [0,8,48]) {
  const {rows:[{id}]}=await db.query(`select create_installment_plan_with_history($1,7056001,48,(current_date-interval '8 months')::date,$2,'carro') as id`,[account,count]);
  const {rows}=await db.query(`select installment_no,status,amount_cents::int from transactions where installment_plan_id=$1 order by installment_no`,[id]);
  assert.equal(rows.length,48); assert.equal(rows.reduce((sum,r)=>sum+r.amount_cents,0),7056001);
  assert.deepEqual(rows.filter(r=>r.status==='cleared').map(r=>r.installment_no),Array.from({length:count},(_,i)=>i+1));
  await db.query('select _promote_due_transactions()');
  const {rows:[{paid}]}=await db.query(`select count(*)::int as paid from transactions where installment_plan_id=$1 and status='cleared'`,[id]);
  assert.equal(paid,count,'scheduler must preserve explicitly pending past installments');
 }
 await db.exec(`insert into recurring_transactions values ('30000000-0000-0000-0000-000000000001',true),('30000000-0000-0000-0000-000000000002',false);
 insert into transactions(description,status,occurred_at,recurring_id) values
 ('auto past','pending',current_date-1,'30000000-0000-0000-0000-000000000001'),
 ('manual past','pending',current_date-1,'30000000-0000-0000-0000-000000000002'),
 ('auto future','pending',current_date+1,'30000000-0000-0000-0000-000000000001');`);
 await db.query('select _promote_due_transactions()');
 const recurring = await db.query(`select description,status from transactions where recurring_id is not null order by description`);
 assert.deepEqual(recurring.rows, [
  {description:'auto future',status:'pending'},
  {description:'auto past',status:'cleared'},
  {description:'manual past',status:'pending'},
 ],'scheduler must retain explicitly automatic recurrence without clearing manual or future entries');
 for(const count of [-1,49,null]) await assert.rejects(db.query(`select create_installment_plan_with_history($1,7056000,48,current_date,$2)`,[account,count]),/pagas|intervalo/i);
 await assert.rejects(db.query(`select create_installment_plan_with_history($1,1,48,current_date,0)`,[account]),/total|parcela/i);
 // O nome da compra: sem descrição, a parcela herda o ESTABELECIMENTO. Era
 // `coalesce(p_description,'Compra parcelada')`, e por isso "nuuvem wardog" digitado em
 // Estabelecimento virava "Compra parcelada (1/2)" na fatura — o valor contava no ciclo e o
 // nome não existia em tela nenhuma (produção, 15/09/2026).
 {
  const {rows:[{id}]}=await db.query(`select create_installment_plan_with_history($1,10499,2,current_date,0,null,null,'nuuvem wardog') as id`,[account]);
  const {rows}=await db.query(`select description,merchant from transactions where installment_plan_id=$1 order by installment_no`,[id]);
  assert.deepEqual(rows.map(r=>r.description),['nuuvem wardog (1/2)','nuuvem wardog (2/2)'],'sem descrição, a parcela herda o estabelecimento');
  assert.ok(rows.every(r=>r.merchant==='nuuvem wardog'),'o estabelecimento também fica na coluna dele');
 }
 // A descrição continua ganhando do estabelecimento quando as duas existem.
 {
  const {rows:[{id}]}=await db.query(`select create_installment_plan_with_history($1,10499,2,current_date,0,'Presente','lazer','nuuvem') as id`,[account]);
  const {rows}=await db.query(`select description from transactions where installment_plan_id=$1 order by installment_no`,[id]);
  assert.deepEqual(rows.map(r=>r.description),['Presente (1/2)','Presente (2/2)']);
 }
 // Sem nenhum dos dois, o literal de sempre.
 {
  const {rows:[{id}]}=await db.query(`select create_installment_plan_with_history($1,10499,2,current_date,0) as id`,[account]);
  const {rows}=await db.query(`select description from transactions where installment_plan_id=$1 order by installment_no`,[id]);
  assert.deepEqual(rows.map(r=>r.description),['Compra parcelada (1/2)','Compra parcelada (2/2)']);
 }
 await db.query(`update accounts set archived=true where id=$1`,[account]);
 await assert.rejects(db.query(`select create_installment_plan_with_history($1,4800,48,current_date,0)`,[account]),/conta/i);
 console.log('PASS: explicit paid history, amount conservation, scheduler preserves arrears, invalid input rollback, parcela herda o nome');
} finally { await db.close(); }
