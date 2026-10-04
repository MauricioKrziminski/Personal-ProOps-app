import json,subprocess,sys,hashlib
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
root=Path('/Users/gabrielalmeidadias/Documents/Empresas/ProOps/DEV/Personal-ProOps-app');base=Path('/private/tmp/proops-f10-native')
subprocess.run([str(root/'scripts/supabase-target.sh')],stdin=subprocess.DEVNULL,check=True)
url=next(l.split('=',1)[1].strip().strip('"') for l in (root/'agent/.env').read_text().splitlines() if l.startswith('DATABASE_URL='))
assert 'utkqoiigimqzeenxkxdl' in url and 'kwriuifcwyvdrxtspjiz' not in url
before=json.loads((base/'db-before.json').read_text());oldplan=json.loads((base/'plan-before.json').read_text());final=json.loads((base/'plan-after-android.json').read_text())
uid=before['user_id'];ws=before['workspace_id'];assert ws=='b94c2f3e-e1f1-450e-b549-bc570b5e8b0e' and uid=='7ebb1a7e-5588-41b3-b62f-d8ebea5766a3'
assert oldplan['goal_plans']==[] and oldplan['goal_plan_items']==[] and oldplan['sealed']==[]
assert final['read']['state']['edit_revision']==2 and len(final['goal_plans'])==1 and len(final['goal_plan_items'])==2 and len(final['sealed'])==2
receipts=sorted(final['sealed'],key=lambda r:r['result']['edit_revision'])
for i,r in enumerate(receipts):
 assert r['user_id']==uid and r['workspace_id']==ws and r['payload']['operation']=='save_goal_plan_v2'
 assert r['result']=={'workspace_id':ws,'edit_revision':i+1} and r['payload']['input']['workspace_id']==ws
 assert r['payload']['input']['expected_revision']==(None if i==0 else 1)
 assert {item['goal_id'] for item in r['payload']['input']['items']}=={'6e94e5b2-99bb-4654-99f2-3d23bd4520d8','0a6f63e1-9c61-44c1-a0b2-26977a348669'}
ids=[r['request_id'] for r in receipts]
execute=sys.argv[1:] == ['--execute'];assert execute or sys.argv[1:]==['--verify']
with psycopg.connect(url,connect_timeout=20,row_factory=dict_row) as c:
 c.execute("set local statement_timeout='30s'");c.execute("set local lock_timeout='8s'")
 c.execute("select pg_advisory_xact_lock(hashtextextended('financial-allocations:'||%s,0))",(ws,))
 for request in sorted(ids):c.execute("select pg_advisory_xact_lock(hashtextextended('goal-plan-request:'||%s||':'||%s,0))",(uid,request))
 c.execute('select 1 from public.workspaces where id=%s for key share',(ws,))
 c.execute('select 1 from public.goal_plans where workspace_id=%s for update',(ws,))
 c.execute('select 1 from private.goal_plan_write_receipts where user_id=%s and request_id=any(%s::uuid[]) order by request_id for update',(uid,ids))
 # JSON timestamps in the saved plan capture use BRT; financial baseline uses UTC.
 c.execute("set local timezone='America/Sao_Paulo'")
 for table in ('goal_plans','goal_plan_items'):
  current=c.execute(f"select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from public.{table} t where workspace_id=%s",(ws,)).fetchone()['rows'];assert current==final[table],table
 current=c.execute("select coalesce(jsonb_agg(to_jsonb(t) order by request_id),'[]'::jsonb) as rows from private.goal_plan_write_receipts t where workspace_id=%s and user_id=%s",(ws,uid)).fetchone()['rows'];assert current==final['sealed'],'unexpected goal plan receipt or concurrent edit'
 generic=c.execute('select * from private.payment_write_requests where user_id=%s and request_id=any(%s::uuid[]) order by request_id for update',(uid,ids)).fetchall();assert len(generic)==2
 for r in generic:
  sealed=next(x for x in receipts if x['request_id']==str(r['request_id']));assert r['payload']==sealed['payload'] and r['result']==sealed['result']
 c.execute("set local timezone='UTC'")
 financial=[t for t in before['sources'] if t not in ('goal_plans','goal_plan_items')]
 for table in financial:
  rows=c.execute(f'select * from public.{table} where workspace_id=%s order by to_jsonb({table})::text',(ws,)).fetchall();digest=hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest();assert digest==before['sources'][table]['sha256'],table
 cash=str(c.execute('select private.cash_total(array[%s::uuid],current_date) as amount',(ws,)).fetchone()['amount']);assert cash==before['cash_total']
 if execute:
  assert c.execute('delete from public.goal_plans where workspace_id=%s and user_id=%s and edit_revision=2',(ws,uid)).rowcount==1
  assert c.execute('delete from private.goal_plan_write_receipts where workspace_id=%s and user_id=%s and request_id=any(%s::uuid[])',(ws,uid,ids)).rowcount==2
  assert c.execute('delete from private.payment_write_requests where user_id=%s and request_id=any(%s::uuid[])',(uid,ids)).rowcount==2
  for table in ('goal_plans','goal_plan_items'):assert c.execute(f'select count(*) as n from public.{table} where workspace_id=%s',(ws,)).fetchone()['n']==0
  assert c.execute('select count(*) as n from private.goal_plan_write_receipts where workspace_id=%s and user_id=%s',(ws,uid)).fetchone()['n']==0
  assert c.execute('select count(*) as n from private.payment_write_requests where user_id=%s and request_id=any(%s::uuid[])',(uid,ids)).fetchone()['n']==0
  c.commit()
 else:c.rollback()
proof={'executed':execute,'workspace_id':ws,'request_ids':ids,'only_qa_plan_restored':execute,'financial_tables_unchanged':len(financial),'cash_unchanged':True,'generic_receipts_removed':2 if execute else 0,'sealed_receipts_removed':2 if execute else 0}
(base/('cleanup-proof.json' if execute else 'cleanup-verified.json')).write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
