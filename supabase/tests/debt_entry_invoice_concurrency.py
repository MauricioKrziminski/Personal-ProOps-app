#!/usr/bin/env python3
"""Two-session invoice/delete regression, STAGING ONLY, synthetic commits then exact cleanup.

This runner intentionally differs from sql-test.py: two sessions need visible fixtures.
It never commits public/private DDL. RPC copies live only in each session's pg_temp;
SET LOCAL ROLE authenticated exercises the real tables, triggers and RLS.
Baseline: python ...py (expected exit 1, stale balance).
Candidate: python ...py --candidate supabase/migrations/<invoice-lock-migration>.sql
Each operation and fixture commit is explicit, with rollback/cleanup in finally.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import json
import pathlib
import re
import subprocess
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

ROOT = pathlib.Path(__file__).resolve().parents[2]
M = ROOT / 'supabase/migrations'
REF = 'utkqoiigimqzeenxkxdl'
PAY = M / '20260926180000_pagamento_e_adiamento_da_fatura_se_desfazem.sql'
ROLL = M / '20260911060000_a_taxa_do_rotativo_se_aprende_nao_se_fixa.sql'
SETTLE = M / '0046_invoice_settle_and_paid_at.sql'
DELETE = M / '20261001191024_protect_debt_entry_invoice_on_delete.sql'
CORE = M / '20261001155149_preserve_purchase_entry_on_conversion.sql'
CONVERT = M / '20260930164920_purchase_down_payment.sql'
REQUEST = M / '20261001192212_idempotent_record_conversion.sql'


def db_url():
    subprocess.run([str(ROOT / 'scripts/supabase-target.sh')], input='', text=True, check=True)
    for line in (ROOT / 'agent/.env').read_text().splitlines():
        if line.startswith('DATABASE_URL='):
            value = line.split('=', 1)[1].strip().strip('"')
            if REF not in value or 'kwriuifcwyvdrxtspjiz' in value:
                raise RuntimeError('DATABASE_URL must point exactly to staging')
            return value
    raise RuntimeError('DATABASE_URL missing')


def function(path, name):
    text = path.read_text()
    match = re.search(r'create or replace function\s+' + re.escape(name) + r'\(', text, re.I)
    if not match:
        raise RuntimeError(f'{name} missing in {path.name}')
    body = re.search(r'\bas\s+(\$[\w]*\$)', text[match.start():], re.I)
    assert body
    tag = body.group(1)
    start = match.start()
    end = text.index(tag, start + body.end()) + len(tag)
    return text[start:end] + ';'


def connect(url):
    conn = psycopg.connect(url, autocommit=False, connect_timeout=15)
    conn.execute("set local timezone='America/Sao_Paulo'")
    conn.execute("set local statement_timeout='15s'")
    conn.execute("set local lock_timeout='12s'")
    return conn


def install(conn, candidate):
    # No CREATE OR REPLACE on a shared schema: all function names are session-local.
    conn.execute('create temporary table concurrency_session_marker(n int)')
    for path, old, new in [
        (candidate or PAY, 'public.pay_invoice', 'pg_temp.pay_invoice'),
        (candidate or ROLL, 'public.roll_invoice', 'pg_temp.roll_invoice'),
        (candidate or SETTLE, 'public.settle_invoice', 'pg_temp.settle_invoice'),
        (DELETE, 'public.delete_debt', 'pg_temp.delete_debt'),
        (CORE, 'private.converter_registro_sem_entrada', 'pg_temp.converter_core'),
        (CONVERT, 'public.converter_registro', 'pg_temp.converter_legacy'),
        (REQUEST, 'public.converter_registro', 'pg_temp.converter_request'),
    ]:
        sql = function(path, old).replace(old + '(', new + '(', 1)
        if new.endswith('converter_core'):
            sql = sql.replace('public.delete_debt(', 'pg_temp.delete_debt(')
        if new.endswith('converter_legacy'):
            sql = sql.replace('private.converter_registro_sem_entrada(', 'pg_temp.converter_core(')
        if new.endswith('converter_request'):
            sql = sql.replace('public.converter_registro(', 'pg_temp.converter_legacy(')
        conn.execute(sql)
    schema = conn.execute('select nspname from pg_namespace where oid=pg_my_temp_schema()').fetchone()[0]
    conn.execute(psycopg.sql.SQL('grant usage on schema {} to authenticated').format(psycopg.sql.Identifier(schema)))


def auth(conn, user):
    conn.execute('set local role authenticated')
    conn.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(user),))
    assert conn.execute('select current_user,auth.uid()').fetchone() == ('authenticated', user)


def fixture(admin):
    ids = {key: uuid.uuid4() for key in ('user','workspace','cash','card','debt','request')}
    u,w,a,c,d = (ids[k] for k in ('user','workspace','cash','card','debt'))
    # Inventory is emitted before the first commit, even if creation or cleanup fails.
    print('FIXTURE ' + json.dumps({k:str(v) for k,v in ids.items()}), flush=True)
    admin.execute('insert into auth.users(id,email) values(%s,%s)', (u,f'invoice-race-{u}@example.invalid'))
    admin.execute('insert into public.profiles(id) values(%s) on conflict do nothing', (u,))
    admin.execute("insert into public.workspaces(id,owner_id,name,created_at) values(%s,%s,%s,now()-interval '2 days')", (w,u,f'Invoice race QA {w}'))
    admin.execute("insert into public.workspace_members(workspace_id,user_id,role) values(%s,%s,'owner')", (w,u))
    admin.execute("insert into public.accounts(id,workspace_id,user_id,name,type) values(%s,%s,%s,'Race cash QA','checking')",(a,w,u))
    admin.execute("insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id) values(%s,%s,%s,'Race card QA','credit_card',5,12,500000,%s)",(c,w,u,a))
    auth(admin,u)
    admin.execute("insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,account_id,due_day,first_due_date) values(%s,%s,%s,%s,'financing','fixed_installments',40000,40000,0,4,0,10000,%s,4,current_date+10)",(d,w,u,f'Race debt QA {d}',a))
    e = admin.execute("select private.insert_purchase_down_payment('financiamento',%s,jsonb_build_object('amount_cents',20000,'account_id',%s::uuid,'occurred_at',current_date-40))",(d,c)).fetchone()[0]
    inv = admin.execute('select invoice_id from public.transactions where id=%s',(e,)).fetchone()[0]
    ids.update(entry=e,invoice=inv)
    print('FIXTURE COMPLETE ' + json.dumps({k:str(v) for k,v in ids.items()}), flush=True)
    admin.commit()  # Explicit synthetic fixture publication, authorized for this runner.
    return ids


def cleanup(admin, ids):
    admin.rollback()
    # Exact owner fixture workspace(s), including any workspace created by auth trigger.
    users=[ids['user']] + ([ids['other_user']] if 'other_user' in ids else [])
    for user in users:
        owned = admin.execute('select id from public.workspaces where owner_id=%s',(user,)).fetchall()
        for (w,) in owned:
            admin.execute('delete from public.workspaces where id=%s and owner_id=%s',(w,user))
        admin.execute('delete from auth.users where id=%s',(user,))
    admin.commit()  # Explicit exact fixture cleanup, not a context-manager commit.
    for user in users:
        assert admin.execute('select count(*) from auth.users where id=%s',(user,)).fetchone()[0]==0
        assert admin.execute('select count(*) from public.workspaces where owner_id=%s',(user,)).fetchone()[0]==0
    admin.rollback()
    print('CLEANED '+str(ids['user']),flush=True)


def wait_blocked(observer, waiter_pid, future):
    deadline = time.monotonic()+8
    observer_pid=observer.execute('select pg_backend_pid()').fetchone()[0]
    while time.monotonic()<deadline:
        # pg_stat_activity.wait_event is hidden for authenticated; blocking PIDs
        # provide live lock evidence without elevated role or cached statistics.
        blockers = observer.execute('select pg_blocking_pids(%s)',(waiter_pid,)).fetchone()[0]
        if observer_pid in blockers:
            print(f'LOCK PROOF waiter={waiter_pid} blockers={blockers}',flush=True)
            return
        if future.done():
            raise RuntimeError(f'Worker ended before lock: {future.result()}')
        time.sleep(.04)
    raise RuntimeError('Second connection did not reach the expected invoice lock')


def remove(conn, ids, path):
    if path=='delete_debt':
        return conn.execute('select pg_temp.delete_debt(%s)',(ids['debt'],)).fetchone()[0]
    dest={'tipo':'recorrente','dados':{'kind':'expense','description':'Race destination QA '+str(ids['request']),
          'amount_cents':30000,'account_id':str(ids['cash']),'rrule':'FREQ=MONTHLY;BYMONTHDAY=4',
          'next_run_at':'2027-01-04T12:00:00-03:00'}}
    return conn.execute('select pg_temp.converter_request(%s,%s,%s,%s)',
        (Jsonb({'tipo':'divida','id':str(ids['debt'])}),'todas',Jsonb(dest),ids['request'])).fetchone()[0]


def settle(conn, ids, operation):
    if operation=='pay':
        return conn.execute('select pg_temp.pay_invoice(%s,%s,current_date,null)',(ids['invoice'],ids['cash'])).fetchone()[0]
    return conn.execute('select pg_temp.roll_invoice(%s,0,0)',(ids['invoice'],)).fetchone()[0]


def attempt(fn, conn, ids, operation):
    try:
        result=fn(conn,ids,operation)
        conn.commit()  # Only the own synthetic operation may be confirmed.
        return {'ok':True,'result':result}
    except psycopg.Error as error:
        conn.rollback()
        return {'ok':False,'code':error.sqlstate,'error':error.diag.message_primary}


def snapshot(admin, ids):
    admin.rollback()
    w,d,e,i = (ids[k] for k in ('workspace','debt','entry','invoice'))
    result={
        'debt':admin.execute('select to_jsonb(t) from public.debts t where id=%s',(d,)).fetchone(),
        'entry':admin.execute('select to_jsonb(t) from public.transactions t where id=%s',(e,)).fetchone(),
        'invoice':admin.execute('select to_jsonb(t) from public.card_invoices t where id=%s',(i,)).fetchone(),
        'transfers':admin.execute('select coalesce(sum(amount_cents),0) from public.transactions where workspace_id=%s and pays_invoice_id=%s',(w,i)).fetchone()[0],
        'rollover':admin.execute('select coalesce(sum(amount_cents),0) from public.transactions where workspace_id=%s and rollover_of_invoice_id=%s',(w,i)).fetchone()[0],
        'destinations':admin.execute('select count(*) from public.recurring_transactions where workspace_id=%s',(w,)).fetchone()[0],
        'cache':admin.execute('select count(*) from private.purchase_write_requests where user_id=%s and request_id=%s',(ids['user'],ids['request'])).fetchone()[0],
    }
    admin.rollback()
    return result


def race(url, admin, candidate, path, operation, order):
    ids=None; a=None; b=None; pool=None
    try:
        ids=fixture(admin)
        before=snapshot(admin,ids)
        a=connect(url); b=connect(url)
        install(a,candidate); install(b,candidate)
        auth(a,ids['user']); auth(b,ids['user'])
        a_pid=a.execute('select pg_backend_pid()').fetchone()[0]
        b_pid=b.execute('select pg_backend_pid()').fetchone()[0]
        # RLS sanity: a synthetic nonexistent/foreign ID cannot remove a debt.
        assert a.execute('select pg_temp.delete_debt(%s)',(uuid.uuid4(),)).fetchone()[0]==0
        pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        if order=='delete_first':
            a.execute('select id from public.card_invoices where id=%s for update',(ids['invoice'],))
            future=pool.submit(attempt,settle,b,ids,operation)
            wait_blocked(a,b_pid,future)
            deletion=remove(a,ids,path)
            a.commit()
            money=future.result(timeout=18)
            after=snapshot(admin,ids)
            print(f'RESULT {path}/{operation}/{order}: money={money}; transfer={after["transfers"]}; rollover={after["rollover"]}; entry_exists={bool(after["entry"])}',flush=True)
            assert not after['debt'] and not after['entry']
            assert after['destinations']==(1 if path=='converter_all' else 0)
            assert after['cache']==(1 if path=='converter_all' else 0)
            assert not money['ok'] and money['code']=='P0001', 'stale balance: settlement succeeded after the purchase was removed'
            assert money['error']==('fatura sem lançamentos' if operation=='pay' else 'Não há saldo em aberto nessa fatura')
            assert after['transfers']==0 and after['rollover']==0, 'phantom transfer/rollover'
            assert after['invoice'][0]['paid_cents']==0 and after['invoice'][0]['status'] not in ('paid','rolled')
        else:
            b.execute('select id from public.card_invoices where id=%s for update',(ids['invoice'],))
            money=settle(b,ids,operation)
            future=pool.submit(attempt,remove,a,ids,path)
            wait_blocked(b,a_pid,future)
            b.commit()
            deletion=future.result(timeout=18)
            after=snapshot(admin,ids)
            print(f'RESULT {path}/{operation}/{order}: delete={deletion}; transfer={after["transfers"]}; rollover={after["rollover"]}; entry_exists={bool(after["entry"])}',flush=True)
            assert not deletion['ok'] and deletion['code']=='P0001'
            assert after['entry']==before['entry'] and after['debt']==before['debt'], 'refused deletion changed history'
            assert after['destinations']==0 and after['cache']==0, 'failed conversion retained destination/request'
            assert (after['transfers'],after['rollover'])==((20000,0) if operation=='pay' else (0,20000))
        print(f'PASS {path}/{operation}/{order}',flush=True)
        return True
    except Exception as error:
        print(f'FAIL {path}/{operation}/{order}: {type(error).__name__}: {error}',flush=True)
        return False
    finally:
        # Roll back/unblock before waiting for a worker, even when a lock assertion fails.
        for conn in (a,b):
            if conn and not conn.closed:
                try: conn.cancel()
                except Exception: pass
        if pool: pool.shutdown(wait=True)
        for conn in (a,b):
            if conn and not conn.closed:
                conn.rollback(); conn.close()
        if ids: cleanup(admin,ids)




def financial_rows(conn,ids):
    # Covers both original and rollover-destination invoices, all their facts,
    # timestamps, IDs, payment metadata and links in this own synthetic workspace.
    conn.execute("set local timezone='America/Sao_Paulo'")
    return conn.execute("""select jsonb_build_object(
      'invoices',(select jsonb_agg(to_jsonb(t) order by t.id) from public.card_invoices t where workspace_id=%s),
      'transactions',(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where workspace_id=%s))""",
      (ids['workspace'],ids['workspace'])).fetchone()[0]


def mark_manual(conn,ids,_):
    return conn.execute('select pg_temp.settle_invoice(%s,current_date-1)',(ids['invoice'],)).fetchone()[0]


def manual_race(url,admin,candidate,operation,order):
    ids=None; a=None; b=None; pool=None
    try:
        ids=fixture(admin)
        a=connect(url); b=connect(url)
        install(a,candidate); install(b,candidate)
        auth(a,ids['user']); auth(b,ids['user'])
        a_pid=a.execute('select pg_backend_pid()').fetchone()[0]
        b_pid=b.execute('select pg_backend_pid()').fetchone()[0]
        pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        if order=='manual_first':
            a.execute('select id from public.card_invoices where id=%s for update',(ids['invoice'],))
            future=pool.submit(attempt,settle,b,ids,operation)
            wait_blocked(a,b_pid,future)
            mark_manual(a,ids,None)
            winner_rows=financial_rows(a,ids)
            # Already-paid manual settlement remains idempotent.
            mark_manual(a,ids,None)
            assert financial_rows(a,ids)==winner_rows
            a.commit()
            money=future.result(timeout=18)
            after=snapshot(admin,ids)
            print(f'RESULT settle/{operation}/{order}: money={money}; invoice={after["invoice"][0]}',flush=True)
            assert not money['ok'] and money['code']=='P0001','payment/rollover overwrote manual paid state'
            assert after['transfers']==0 and after['rollover']==0
            assert after['invoice'][0]['status']=='paid' and after['invoice'][0]['settled_manually']
            assert after['invoice'][0]['payment_transaction_id'] is None
        else:
            b.execute('select id from public.card_invoices where id=%s for update',(ids['invoice'],))
            future=pool.submit(attempt,mark_manual,a,ids,None)
            wait_blocked(b,a_pid,future)
            money=settle(b,ids,operation)
            winner_rows=financial_rows(b,ids)
            b.commit()
            manual=future.result(timeout=18)
            after=snapshot(admin,ids)
            print(f'RESULT settle/{operation}/{order}: manual={manual}; invoice={after["invoice"][0]}',flush=True)
            if operation=='pay':
                assert manual['ok'],'settle is idempotent after payment'
                assert after['invoice'][0]['status']=='paid' and not after['invoice'][0]['settled_manually']
                assert after['invoice'][0]['payment_transaction_id']==str(money)
                assert after['transfers']==20000 and after['rollover']==0
            else:
                assert not manual['ok'] and manual['code']=='P0001','manual settle overwrote a freshly rolled invoice'
                assert manual['error']=='Essa fatura já foi para a próxima: desfaça o adiamento antes de marcar como paga.'
                assert after['invoice'][0]['status']=='rolled' and not after['invoice'][0]['settled_manually']
                assert after['rollover']==20000 and after['transfers']==0
            assert after['entry'] and after['debt']
        assert financial_rows(admin,ids)==winner_rows,'losing operation changed invoice/transaction JSON'
        admin.rollback()
        print(f'PASS settle/{operation}/{order}: exact invoice/transaction JSON preserved',flush=True)
        return True
    except Exception as error:
        print(f'FAIL settle/{operation}/{order}: {type(error).__name__}: {error}',flush=True)
        return False
    finally:
        for conn in (a,b):
            if conn and not conn.closed:
                try: conn.cancel()
                except Exception: pass
        if pool: pool.shutdown(wait=True)
        for conn in (a,b):
            if conn and not conn.closed: conn.rollback(); conn.close()
        if ids: cleanup(admin,ids)


def rls_check(url,admin,candidate):
    ids=None; conn=None
    try:
        ids=fixture(admin); before=snapshot(admin,ids)
        ids['other_user']=uuid.uuid4()
        print('RLS OTHER USER '+str(ids['other_user']),flush=True)
        admin.execute('insert into auth.users(id,email) values(%s,%s)',(ids['other_user'],f'invoice-race-foreign-{ids["other_user"]}@example.invalid'))
        admin.execute('insert into public.profiles(id) values(%s) on conflict do nothing',(ids['other_user'],))
        admin.commit()
        conn=connect(url); install(conn,candidate); auth(conn,ids['other_user'])
        assert conn.execute('select pg_temp.delete_debt(%s)',(ids['debt'],)).fetchone()[0]==0
        for fn,args in [('pay_invoice',(ids['invoice'],ids['cash'])),('roll_invoice',(ids['invoice'],)),('settle_invoice',(ids['invoice'],))]:
            conn.execute('savepoint foreign_attempt')
            try:
                if fn=='pay_invoice': conn.execute('select pg_temp.pay_invoice(%s,%s,current_date,null)',args)
                elif fn=='roll_invoice': conn.execute('select pg_temp.roll_invoice(%s,0,0)',args)
                else: conn.execute('select pg_temp.settle_invoice(%s,current_date)',args)
                raise AssertionError('foreign invoice was writable')
            except psycopg.Error as error:
                assert error.sqlstate=='P0001' and 'encontrada' in error.diag.message_primary
                conn.execute('rollback to savepoint foreign_attempt')
        conn.rollback()
        assert snapshot(admin,ids)==before,'RLS probe changed foreign fixture'
        print('PASS RLS foreign user cannot see/settle/roll/delete own other-workspace fixture',flush=True)
        return True
    except Exception as error:
        print(f'FAIL RLS: {type(error).__name__}: {error}',flush=True)
        return False
    finally:
        if conn: conn.rollback(); conn.close()
        if ids: cleanup(admin,ids)



def conversion_rows(conn,ids):
    conn.execute("set local timezone='America/Sao_Paulo'")
    return conn.execute("""select jsonb_build_object(
      'debt',(select to_jsonb(t) from public.debts t where id=%s),
      'series',(select jsonb_agg(to_jsonb(t) order by t.id) from public.recurring_transactions t where workspace_id=%s),
      'facts',(select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where workspace_id=%s),
      'invoices',(select jsonb_agg(to_jsonb(t) order by t.id) from public.card_invoices t where workspace_id=%s),
      'requests',(select jsonb_agg(to_jsonb(t) order by t.request_id) from private.purchase_write_requests t where user_id=%s))""",
      (ids['debt'],ids['workspace'],ids['workspace'],ids['workspace'],ids['user'])).fetchone()[0]


def request_race(url,admin,candidate):
    ids=None; a=None; b=None; pool=None
    try:
        ids=fixture(admin)
        a=connect(url); b=connect(url)
        install(a,candidate); install(b,candidate)
        auth(a,ids['user']); auth(b,ids['user'])
        b_pid=b.execute('select pg_backend_pid()').fetchone()[0]
        first=remove(a,ids,'converter_all')
        winner_rows=conversion_rows(a,ids)
        assert winner_rows['debt'] is None,'All must delete the source before the concurrent retry'
        assert len(winner_rows['series'])==1 and len(winner_rows['requests'])==1
        assert not winner_rows['facts'],'All removed source entry, no duplicate cash fact'
        pool=concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future=pool.submit(attempt,remove,b,ids,'converter_all')
        wait_blocked(a,b_pid,future)
        locks=a.execute("""select mode,granted from pg_locks
            where pid=%s and relation='private.purchase_write_requests'::regclass""",(b_pid,)).fetchall()
        assert ('RowExclusiveLock',True) in locks,'retry must enter the request reservation INSERT'
        # The retry has not reached the conversion core/debt lookup: it waits on
        # the conflicting unique reservation, not on the deleted source record.
        debt_locks=a.execute("select count(*) from pg_locks where pid=%s and relation='public.debts'::regclass",(b_pid,)).fetchone()[0]
        assert debt_locks==0,'retry reached the deleted-origin lookup before serializing its request'
        print(f'RESERVATION LOCK PROOF cache_locks={locks}; deleted_origin_table_locks={debt_locks}',flush=True)
        a.commit()
        retry=future.result(timeout=18)
        assert retry['ok'] and retry['result']==first,'concurrent retry must return exactly the stored IDs/result'
        after=conversion_rows(admin,ids)
        assert after==winner_rows,'concurrent retry duplicated or modified destination/entry/invoice/request rows'
        assert len(after['requests'])==1 and after['requests'][0]['result']==first
        admin.rollback()
        print(f'PASS concurrent converter All retry: source deleted; identical result={first}; cache=1; exact rows preserved',flush=True)
        return True
    except Exception as error:
        print(f'FAIL concurrent request: {type(error).__name__}: {error}',flush=True)
        return False
    finally:
        for conn in (a,b):
            if conn and not conn.closed:
                try: conn.cancel()
                except Exception: pass
        if pool: pool.shutdown(wait=True)
        for conn in (a,b):
            if conn and not conn.closed: conn.rollback(); conn.close()
        if ids: cleanup(admin,ids)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=pathlib.Path)
    parser.add_argument('--manual-only',action='store_true')
    parser.add_argument('--cache-only',action='store_true')
    args=parser.parse_args()
    url=db_url(); admin=connect(url)
    try:
        results=[] if args.manual_only or args.cache_only else [race(url,admin,args.candidate,path,op,order)
                 for path in ('delete_debt','converter_all') for op in ('pay','roll')
                 for order in ('delete_first','settlement_first')]
        if not args.cache_only:
            results += [manual_race(url,admin,args.candidate,op,order) for op in ('pay','roll')
                        for order in ('manual_first','money_first')]
            results += [rls_check(url,admin,args.candidate)]
        if not args.manual_only:
            results += [request_race(url,admin,args.candidate)]
        print(f'FINAL {sum(results)}/{len(results)} passed; candidate={bool(args.candidate)}; every fixture cleaned',flush=True)
        return 0 if all(results) else 1
    finally:
        admin.rollback(); admin.close()


if __name__=='__main__':
    raise SystemExit(main())
