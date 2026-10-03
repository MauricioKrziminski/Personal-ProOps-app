"""Selected audited F07 helpers used by F08 races; root discovery made portable.
Original helper source hash is retained in artifact-manifest.json. Execute races_runner.py.
"""
from __future__ import annotations
import concurrent.futures
import json
import pathlib
import subprocess
import threading
import time
from urllib.parse import urlparse
ROOT = next(parent for parent in pathlib.Path(__file__).resolve().parents if (parent/'supabase/migrations').is_dir())
REF = 'utkqoiigimqzeenxkxdl'
BRANCH = 'gabriel/financas-22-melhorias'
def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def emit(event, **data):
    # Deliberately never emit DSNs, raw DB messages, fixture UUIDs, PIDs or payloads.
    print(json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)

def staging_dsn():
    guard = subprocess.run([str(ROOT / 'scripts/supabase-target.sh')], input='',
                           text=True, capture_output=True, timeout=15)
    require(guard.returncode == 0, 'target_guard_refused')
    require((ROOT / 'supabase/.temp/project-ref').read_text().strip() == REF,
            'cli_ref_not_exact_staging')
    app = next((line.split('=', 1)[1].strip().strip('\"\'')
                for line in (ROOT / '.env.local').read_text().splitlines()
                if line.startswith('EXPO_PUBLIC_SUPABASE_URL=')), '')
    require(urlparse(app).hostname == REF + '.supabase.co', 'app_ref_not_exact_staging')
    branch = subprocess.run(['git', 'branch', '--show-current'], cwd=ROOT,
                            text=True, capture_output=True, check=True, timeout=10)
    require(branch.stdout.strip() == BRANCH, 'unexpected_worktree_branch')
    lines = [line.split('=', 1)[1].strip().strip('\"\'')
             for line in (ROOT / 'agent/.env').read_text().splitlines()
             if line.startswith('DATABASE_URL=')]
    require(len(lines) == 1, 'missing_or_duplicate_database_url')
    from psycopg.conninfo import conninfo_to_dict
    parsed = conninfo_to_dict(lines[0])
    host, user = parsed.get('host', ''), parsed.get('user', '')
    require(host == 'db.' + REF + '.supabase.co' or
            (host.endswith('.pooler.supabase.com') and user == 'postgres.' + REF),
            'database_ref_not_exact_staging')
    require('kwriuifcwyvdrxtspjiz' not in lines[0], 'production_dsn_refused')
    require(parsed.get('port', '5432') == '5432', 'session_connection_required')
    emit('target_verified', target=REF, branch=BRANCH, guard='passed')
    return lines[0]

def query(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description is not None else None

def one(conn, sql, params=()):
    return query(conn, sql, params)[0][0]

def connect(dsn):
    import psycopg
    conn = psycopg.connect(dsn, connect_timeout=15, sslmode='require',
                            application_name='proops-f07-isolated-concurrency', prepare_threshold=None)
    query(conn, "set statement_timeout='10s'")
    query(conn, "set lock_timeout='8s'")
    query(conn, "set timezone='America/Sao_Paulo'")
    query(conn, "set default_transaction_isolation='read committed'")
    pid = one(conn, 'select pg_backend_pid()')
    conn.commit()
    return conn, pid

def authenticated(conn, user):
    one(conn, "select set_config('request.jwt.claim.sub', %s, true)", (user,))
    query(conn, 'set local role authenticated')

def start_worker(conn, fn):
    # Daemon plus bounded Future joins avoids an unbounded executor shutdown.
    future = concurrent.futures.Future()
    def run():
        import psycopg
        future.set_running_or_notify_cancel()
        try:
            result = fn()
            conn.commit()  # Only a synthetic API operation; holder commits separately.
            future.set_result({'ok': True, 'result': result})
        except psycopg.Error as error:
            conn.rollback()
            future.set_result({'ok': False, 'sqlstate': error.sqlstate,
                               'message': error.diag.message_primary})
        except BaseException as error:
            try:
                conn.rollback()
            finally:
                future.set_exception(error)
    thread = threading.Thread(target=run, name='f07-two-session-worker', daemon=True)
    thread.start()
    return future, thread, conn

def wait_blocked(observer, observer_pid, waiter_pid, worker):
    future = worker[0]
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        one(observer, 'select pg_stat_clear_snapshot()')
        rows = query(observer, 'select state,wait_event_type,wait_event,pg_blocking_pids(pid) from pg_stat_activity where pid=%s', (waiter_pid,))
        if rows and rows[0][0] == 'active' and rows[0][1] == 'Lock' and observer_pid in rows[0][3]:
            return {'state': 'active', 'wait_event_type': 'Lock', 'wait_event': rows[0][2],
                    'blocked_by_holder': True}
        require(not future.done(), 'worker_finished_before_expected_lock')
        time.sleep(0.04)  # Short bounded polling, never a timing-based proof.
    raise RuntimeError('expected_database_lock_wait_not_observed')

def join(worker):
    try:
        outcome = worker[0].result(timeout=12)
    finally:
        worker[1].join(timeout=1)
    require(not worker[1].is_alive(), 'worker_thread_did_not_finish')
    return outcome

def cleanup(conn, ids):
    from psycopg import sql
    conn.rollback()
    query(conn, 'reset role')
    owned = [row[0] for row in query(conn, 'select id::text from public.workspaces where owner_id=%s', (ids['user'],))]
    scoped = list(set(owned + ids.get('owned_workspaces', []) + [ids['workspace']]))
    require(one(conn, 'select count(*) from public.workspaces where id=any(%s::uuid[]) and owner_id<>%s', (scoped, ids['user'])) == 0, 'cleanup_workspace_ownership_changed')
    require(one(conn, 'select count(*) from public.workspace_members where workspace_id=any(%s::uuid[]) and user_id<>%s', (scoped, ids['user'])) == 0, 'cleanup_unexpected_foreign_members')
    # Record every public/private table with either fixture boundary column, so
    # cleanup verifies goal ledger, assets/valuations, transactions and receipts too.
    tables = query(conn, "select c.table_schema,c.table_name,c.column_name from information_schema.columns c join information_schema.tables t using(table_catalog,table_schema,table_name) where c.table_schema in ('public','private') and t.table_type='BASE TABLE' and c.column_name in ('workspace_id','user_id') and c.udt_name='uuid' order by 1,2,3")
    query(conn, 'delete from private.emergency_reserve_write_receipts where user_id=%s', (ids['user'],))
    query(conn, 'delete from private.payment_write_requests where user_id=%s', (ids['user'],))
    query(conn, 'delete from public.workspaces where owner_id=%s and id=any(%s::uuid[])', (ids['user'], scoped))
    query(conn, 'delete from auth.users where id=%s', (ids['user'],))
    conn.commit()
    remaining = {
        'auth_users': one(conn, 'select count(*) from auth.users where id=%s', (ids['user'],)),
        'profiles': one(conn, 'select count(*) from public.profiles where id=%s', (ids['user'],)),
        'owned_workspaces': one(conn, 'select count(*) from public.workspaces where owner_id=%s or id=any(%s::uuid[])', (ids['user'], scoped)),
    }
    for schema, table, column in tables:
        boundary = sql.SQL('{} = ANY(%s::uuid[])').format(sql.Identifier(column)) if column == 'workspace_id' else sql.SQL('{} = %s::uuid').format(sql.Identifier(column))
        params = (scoped,) if column == 'workspace_id' else (ids['user'],)
        count = one(conn, sql.SQL('select count(*) from {}.{} where ').format(sql.Identifier(schema), sql.Identifier(table)) + boundary, params)
        if count:
            remaining[schema + '.' + table + '.' + column] = count
    conn.rollback()
    emit('cleanup_verified', zero_residue=not any(remaining.values()), checked_boundary_columns=len(tables), residue_counts=remaining)
    require(not any(remaining.values()), 'fixture_cleanup_residue')
