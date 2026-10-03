import json, sys, subprocess
from pathlib import Path
import psycopg

root = next(parent for parent in Path(__file__).resolve().parents if (parent/'supabase/migrations').is_dir())
subprocess.run([str(root/'scripts/supabase-target.sh')], stdin=subprocess.DEVNULL, check=True)
url = next(l.split('=',1)[1].strip().strip('"') for l in (root/'agent/.env').read_text().splitlines() if l.startswith('DATABASE_URL='))
assert 'utkqoiigimqzeenxkxdl' in url and 'kwriuifcwyvdrxtspjiz' not in url
mode = sys.argv[1]
assert mode in ('red','green','projection','projection-negative','context','applied')
conn = psycopg.connect(url, connect_timeout=20, autocommit=False)
try:
    conn.execute("set local statement_timeout='90s'")
    present = conn.execute("select to_regclass('public.goal_plans')").fetchone()[0] is not None
    assert present == (mode in ('context','applied')), 'Schema state differs from runner phase'
    if mode == 'red':
        # Behavioral baseline, rolled back: the write returns success but does not persist.
        conn.execute('''
          create table public.goal_plans(workspace_id uuid primary key,edit_revision bigint);
          grant select on public.goal_plans to authenticated;
          create function private.goal_planning_fingerprint(ws uuid) returns text
          language sql stable set search_path='' as $$
            select md5(coalesce(jsonb_agg(jsonb_build_array(id,target_cents,saved_cents,deadline) order by id),'[]'::jsonb)::text)
            from public.goals where workspace_id=ws and not archived and saved_cents<target_cents;
          $$;
          grant execute on function private.goal_planning_fingerprint(uuid) to authenticated;
          create function public.save_goal_plan(p_input jsonb,p_request_id uuid) returns jsonb
          language sql as $$select jsonb_build_object('workspace_id',p_input->'workspace_id','edit_revision',1)$$;
          grant execute on function public.save_goal_plan(jsonb,uuid) to authenticated;
        ''')
    elif mode not in ('context','applied'):
        for filename in ('20261003164859_goal_plans.sql','20261003164902_goal_planning_projection.sql'):
            source=(root/'supabase/migrations'/filename).read_text()
            if mode=='projection-negative' and filename.endswith('_goal_planning_projection.sql'):
                assert 'coalesce(i.planned,0) as planned' in source
                source=source.replace('coalesce(i.planned,0) as planned','0::numeric as planned')
            conn.execute(source)
    if mode=='context': conn.execute((root/'supabase/migrations/20261003172501_goal_planning_workspace_context.sql').read_text())
    names = ['goal_plans.sql','goal_planning_projection.sql'] if mode in ('context','applied') else ['goal_planning_projection.sql'] if mode.startswith('projection') else ['goal_plans.sql']
    for name in names:
        script=(root/'supabase/tests'/name).read_text()
        # The runner owns the transaction: remove psql-only flags and outer begin/rollback.
        script='\n'.join(l for l in script.splitlines() if not l.startswith('\\') and l.strip().lower() not in ('begin;','rollback;'))
        conn.execute(script)
        print(json.dumps({'test':name,'mode':mode,'result':'pass','committed':False}))
except Exception as exc:
    print(json.dumps({'mode':mode,'result':'fail','code':getattr(exc,'sqlstate',None),'message':str(exc)},ensure_ascii=False))
    sys.exit(1)
finally:
    conn.rollback()
    assert (conn.execute("select to_regclass('public.goal_plans')").fetchone()[0] is not None) == present, 'Rollback failed'
    conn.rollback(); conn.close()
