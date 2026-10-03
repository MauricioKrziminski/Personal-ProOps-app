"""Restore only the two F08 native-QA writes after recording their evidence."""
import hashlib, json, subprocess, sys
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
root=Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip())
subprocess.run([str(root/'scripts/supabase-target.sh')],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,check=True)
dsn=next(line.split('=',1)[1].strip().strip('"') for line in (root/'agent/.env').read_text().splitlines() if line.startswith('DATABASE_URL='))
assert 'utkqoiigimqzeenxkxdl' in dsn and 'kwriuifcwyvdrxtspjiz' not in dsn
folder=Path('/private/tmp/proops-f08-native')
before=json.loads((folder/'db-before.json').read_text()); saved=json.loads((folder/'db-android-saved.json').read_text())
assert before['plans']==[] and before['items']==[] and before['receipts']==[]
ws=before['workspace_id'];uid='7ebb1a7e-5588-41b3-b62f-d8ebea5766a3'
assert ws=='b94c2f3e-e1f1-450e-b549-bc570b5e8b0e' and saved['state']['edit_revision']==2
assert saved['financial']==before['financial'] and len(saved['receipts'])==2
request_ids=[r['request_id'] for r in saved['receipts']]
def wire(data):return json.loads(json.dumps(data,default=str,sort_keys=True))
c=psycopg.connect(dsn,connect_timeout=20,row_factory=dict_row)
try:
 c.execute("set local statement_timeout='25s'")
 c.execute("set local timezone to 'America/Sao_Paulo'")
 for request in sorted(request_ids):
  c.execute("select pg_advisory_xact_lock(hashtextextended('goal-plan-request:'||%s||':'||%s,0))",(uid,request))
 c.execute("select pg_advisory_xact_lock(hashtextextended('financial-allocations:'||%s,0))",(ws,))
 plan=c.execute('select * from public.goal_plans where workspace_id=%s for update',(ws,)).fetchall()
 assert wire(plan)==saved['plans'], 'Plan changed since saved evidence; no cleanup'
 items=c.execute('select * from public.goal_plan_items where workspace_id=%s order by goal_id',(ws,)).fetchall()
 assert wire(items)==saved['items'], 'Items changed; no cleanup'
 receipts=c.execute('select * from private.goal_plan_write_receipts where user_id=%s order by created_at for update',(uid,)).fetchall()
 assert len(receipts)==2 and [str(r['request_id']) for r in receipts]==request_ids
 for index,r in enumerate(receipts,1):
  assert str(r['workspace_id'])==ws and r['result']=={'workspace_id':ws,'edit_revision':index}
  assert r['payload']['operation']=='save_goal_plan' and r['payload']['input']['workspace_id']==ws
  assert r['payload']['input']['expected_revision']==(None if index==1 else 1)
  assert r['payload']['input']['goals_fingerprint']==before['state']['goals_fingerprint']
  expected=[dict(goal_id=x['goal_id'],included=x['included'],monthly_cents=70000 if x['goal_id']=='0a6f63e1-9c61-44c1-a0b2-26977a348669' and index==1 else x['monthly_cents'],first_on=x['first_on']) for x in saved['items']]
  assert sorted(r['payload']['input']['items'],key=lambda x:x['goal_id'])==sorted(expected,key=lambda x:x['goal_id'])
  generic=c.execute('select payload,result from private.payment_write_requests where user_id=%s and request_id=%s for update',(uid,r['request_id'])).fetchone()
  assert generic and generic['payload']==r['payload'] and generic['result']==r['result']
 assert c.execute('delete from public.goal_plans where workspace_id=%s and user_id=%s and edit_revision=2',(ws,uid)).rowcount==1
 assert c.execute('delete from private.goal_plan_write_receipts where user_id=%s and workspace_id=%s and request_id=any(%s::uuid[])',(uid,ws,request_ids)).rowcount==2
 assert c.execute('delete from private.payment_write_requests where user_id=%s and request_id=any(%s::uuid[])',(uid,request_ids)).rowcount==2
 assert c.execute('select count(*) n from public.goal_plan_items where workspace_id=%s',(ws,)).fetchone()['n']==0
 report={'target':'utkqoiigimqzeenxkxdl','workspace_id':ws,'restored_absent_plan':True,'deleted_plan':1,'deleted_items_by_cascade':2,'deleted_sealed_receipts':2,'deleted_matching_generic_receipts':2,'request_ids':request_ids,'mode':'commit' if '--commit' in sys.argv else 'rollback'}
 if '--commit' in sys.argv:c.commit()
 else:c.rollback()
 (folder/('cleanup-'+report['mode']+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report))
finally:c.rollback();c.close()
