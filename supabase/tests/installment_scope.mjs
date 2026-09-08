// Actual production payment SQL, isolated PostgreSQL semantics, fictional data.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const {query,params}=JSON.parse(execFileSync(root+'agent/.venv/bin/python',[root+'agent/scripts/export_installment_scope_sql.py'],{encoding:'utf8'}));
const uuid=n=>'00000000-0000-0000-0000-'+n.toString(16).padStart(12,'0');
try {
 await db.exec(`create table transactions(id uuid primary key,workspace_id uuid,installment_plan_id uuid,installment_no int,amount_cents bigint,occurred_at date,status text,paid_at date,account_id uuid,invoice_id uuid);`);
 async function reset() {
  await db.exec('truncate transactions');
  for(let i=1;i<=48;i++)await db.query(`insert into transactions values($1,$2,$3,$4,147000,('2026-01-08'::date+make_interval(months=>$4-1))::date,'pending',null,null,null)`,[uuid(i),uuid(2000),uuid(1000),i]);
 }
 const state=async()=> (await db.query('select * from transactions order by id')).rows;
 await reset();
 const before=await state();
 const result=(await db.query(query,params)).rows[0];
 assert.equal(Number(result.matched),8);assert.equal(Number(result.changed),8);
 const after=await state();
 assert.deepEqual(after.slice(8),before.slice(8),'remaining40 must be byte-for-byte unchanged');
 assert.deepEqual(after.map(r=>r.occurred_at),before.map(r=>r.occurred_at),'calendar never shifts');
 assert.deepEqual(after.filter(r=>r.status==='cleared').map(r=>r.installment_no),[1,2,3,4,5,6,7,8]);
 for(const mutation of [
   `update transactions set amount_cents=147001 where installment_no=5`,
   `update transactions set occurred_at=occurred_at+1 where installment_no=5`,
   `update transactions set workspace_id='${uuid(9999)}' where installment_no=5`,
   `delete from transactions where installment_no=5`,
   `update transactions set account_id='${uuid(9000)}' where installment_no=5`,
   `update transactions set invoice_id='${uuid(9001)}' where installment_no=5`,
   `update transactions set status='cleared',paid_at='2026-05-09' where installment_no=5`,
 ]){
  await reset();await db.exec(mutation);const changedBefore=await state();
  const r=(await db.query(query,params)).rows[0];
  assert.equal(Number(r.changed),0);assert.deepEqual(await state(),changedBefore,'stale confirmation must fail atomically');
 }
 await reset();
 await db.query(`update transactions set status='cleared',paid_at='2026-05-09' where installment_no=5`);
 const frozen=JSON.parse(params[0]);frozen[4].status='cleared';frozen[4].paid_at='2026-05-09';
 const r=(await db.query(query,[JSON.stringify(frozen),...params.slice(1)])).rows[0];
 assert.equal(Number(r.changed),7);
 assert.equal((await state())[4].paid_at.toISOString().slice(0,10),'2026-05-09');
 console.log('PASS: exact8 of48, calendar untouched, seven stale/ownership scenarios atomic, already-paid date preserved');
} finally {await db.close();}
