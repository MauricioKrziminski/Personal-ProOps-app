#!/usr/bin/env python3
"""Authorized STAGING-only F08 two-session acceptance; fresh isolated fixtures, finally cleanup.

Uses the audited F07 scope/session/lock-observation/cleanup helpers. No source,
migration or existing QA row is changed. --execute is required for network work.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import signal
import tempfile
import uuid

spec = importlib.util.spec_from_file_location('f08_races_audited_helpers', str(Path(__file__).with_name('races_helpers.py')))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
MIGRATIONS = ['20261003164859', '20261003164902', '20261003172501']
MANIFEST = Path(tempfile.gettempdir())/'proops-f08-races-fixtures.json'


def persist_manifest(fixtures, cleaned=False):
    # Exact synthetic UUIDs are retained for recovery; no DSN or credential is stored.
    MANIFEST.write_text(json.dumps({'target': h.REF, 'fixtures': fixtures, 'cleaned': cleaned}, indent=2))
    MANIFEST.chmod(0o600)


def fixture(conn, ids):
    h.query(conn, 'insert into auth.users(id,email) values(%s,%s)',
            (ids['user'], 'f08-races-' + ids['user'] + '@example.invalid'))
    h.query(conn, 'insert into public.profiles(id) values(%s) on conflict do nothing', (ids['user'],))
    h.query(conn, "insert into public.workspaces(id,owner_id,name) values(%s,%s,'F08 isolated race fixture')", (ids['workspace'], ids['user']))
    h.query(conn, "insert into public.workspace_members(workspace_id,user_id,role) values(%s,%s,'owner')", (ids['workspace'], ids['user']))
    h.query(conn, "insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values(%s,%s,%s,'F08 race cash','checking',10000)",
            (ids['account'], ids['workspace'], ids['user']))
    h.query(conn, "insert into public.goals(id,workspace_id,user_id,name,target_cents,deadline) values(%s,%s,%s,'F08 race included',10000,current_date+90),(%s,%s,%s,'F08 race excluded',5000,null)",
            (ids['goal'], ids['workspace'], ids['user'], ids['goal2'], ids['workspace'], ids['user']))
    h.authenticated(conn, ids['user'])
    h.require(h.one(conn, 'select public.goal_deposit(%s,100,current_date)', (ids['goal'],)) == 100, 'fixture_initial_deposit_wrong')
    h.query(conn, 'reset role')
    ids['owned_workspaces'] = [row[0] for row in h.query(conn, 'select id::text from public.workspaces where owner_id=%s order by id', (ids['user'],))]
    h.require(ids['workspace'] in ids['owned_workspaces'], 'fixture_workspace_not_owned')
    h.require(h.one(conn, 'select count(*) from public.workspace_members where user_id=%s and workspace_id<>all(%s::uuid[])',
                    (ids['user'], ids['owned_workspaces'])) == 0, 'fixture_has_foreign_membership')
    h.require(h.one(conn, "select coalesce(encrypted_password,'')='' and email_confirmed_at is null and phone_confirmed_at is null from auth.users where id=%s", (ids['user'],)), 'fixture_must_not_have_login_credential')
    h.require(h.one(conn, 'select count(*) from auth.identities where user_id=%s', (ids['user'],)) == 0, 'fixture_auth_identity_created')
    h.require(h.one(conn, 'select count(*) from auth.sessions where user_id=%s', (ids['user'],)) == 0, 'fixture_auth_session_created')
    conn.commit()
    h.emit('fixture_committed', case=ids['case'], new_users=1, no_password_identity_or_session=True,
           owned_workspaces=len(ids['owned_workspaces']), accounts=1, goals=2, contributions=1)


def payload(conn, ids):
    h.authenticated(conn, ids['user'])
    fingerprint = h.one(conn, 'select private.goal_planning_fingerprint(%s)', (ids['workspace'],))
    today = h.one(conn, 'select current_date::text')
    h.query(conn, 'reset role')
    return {'workspace_id': ids['workspace'], 'expected_revision': None, 'goals_fingerprint': fingerprint,
            'items': [{'goal_id': ids['goal'], 'included': True, 'monthly_cents': 2000, 'first_on': today},
                      {'goal_id': ids['goal2'], 'included': False, 'monthly_cents': None, 'first_on': None}]}


def command(conn, ids, data, request, operation='save'):
    from psycopg.types.json import Jsonb
    h.authenticated(conn, ids['user'])
    function = 'public.save_goal_plan' if operation == 'save' else 'public.resolve_goal_plan_attempt'
    result = h.one(conn, f'select {function}(%s,%s)', (Jsonb(data), request))
    h.query(conn, 'reset role')
    return result


def financial_snapshot(conn, ids):
    from psycopg import sql
    # All public workspace rows other than the two intent tables: includes cash,
    # goals/contributions, allocation backing, debts, recurrence and invoice sources.
    tables = h.query(conn, "select c.table_schema,c.table_name from information_schema.columns c join information_schema.tables t using(table_catalog,table_schema,table_name) where c.table_schema='public' and t.table_type='BASE TABLE' and c.column_name='workspace_id' and c.udt_name='uuid' and c.table_name not in ('goal_plans','goal_plan_items') order by 1,2")
    snapshot = {}
    for schema, table in tables:
        statement = sql.SQL("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from {}.{} t where workspace_id=%s").format(sql.Identifier(schema), sql.Identifier(table))
        snapshot[schema + '.' + table] = h.one(conn, statement, (ids['workspace'],))
    snapshot['cash_total'] = str(h.one(conn, 'select private.cash_total(array[%s::uuid],current_date)', (ids['workspace'],)))
    return snapshot


def rows(conn, ids):
    return {
        'plans': h.query(conn, 'select to_jsonb(p) from public.goal_plans p where workspace_id=%s', (ids['workspace'],)),
        'items': h.query(conn, 'select to_jsonb(i) from public.goal_plan_items i where workspace_id=%s order by goal_id', (ids['workspace'],)),
        'sealed': h.query(conn, 'select to_jsonb(s) from private.goal_plan_write_receipts s where user_id=%s order by request_id', (ids['user'],)),
        'generic': h.query(conn, 'select to_jsonb(g) from private.payment_write_requests g where user_id=%s order by request_id', (ids['user'],)),
    }


def counts(conn, ids, request):
    return [h.one(conn, 'select count(*) from private.goal_plan_write_receipts where user_id=%s and request_id=%s', (ids['user'], request)),
            h.one(conn, 'select count(*) from private.payment_write_requests where user_id=%s and request_id=%s', (ids['user'], request))]


def run_case(number, a, apid, b, bpid, ids, active):
    data, request = payload(a, ids), str(uuid.uuid4())
    ids['requests'] = [request]
    before = financial_snapshot(a, ids)
    h.require(not any(rows(a, ids).values()), 'new_fixture_has_preexisting_plan_or_receipt')
    cancel = {'workspace_id': ids['workspace'], 'cancelled': True}
    success = {'workspace_id': ids['workspace'], 'edit_revision': 1}
    first_operation = 'resolve' if number == 3 else 'save'
    second_operation = 'resolve' if number == 4 else 'save'
    first = command(a, ids, data, request, first_operation)
    expected = cancel if number == 3 else success
    h.require(first == expected, 'holder_result_not_exact')
    winner_rows = rows(a, ids)
    second_request, second_data = request, data
    if number == 2:
        second_request = str(uuid.uuid4())
        ids['requests'].append(second_request)
        second_data = dict(data, items=[dict(data['items'][0], monthly_cents=2100), data['items'][1]])
    worker = h.start_worker(b, lambda: command(b, ids, second_data, second_request, second_operation))
    active.append(worker)
    wait = h.wait_blocked(a, apid, bpid, worker)
    h.require(wait['wait_event'] == 'advisory', 'expected_request_or_workspace_advisory_not_observed')
    # This is the release latch, after a distinct backend is proved waiting on A.
    a.commit()
    outcome = h.join(worker)
    active.clear()
    if number == 2:
        h.require(not outcome['ok'] and outcome['sqlstate'] == 'PT409'
                  and outcome['message'] == 'Plano alterado. Confira novamente', 'CAS_loser_not_exact_PT409')
        h.require(counts(a, ids, second_request) == [0, 0], 'CAS_loser_left_a_receipt')
    else:
        h.require(outcome['ok'] and outcome['result'] == first == expected, 'contenders_disagree_on_sealed_result')
    after_rows = rows(a, ids)
    h.require(after_rows == winner_rows, 'waiting_contender_mutated_plan_or_receipts')
    h.require(len(after_rows['sealed']) == 1 and after_rows['sealed'][0][0]['result'] == expected, 'sealed_receipt_not_unique_or_exact')
    h.require(after_rows['sealed'][0][0]['payload'] == {'operation': 'save_goal_plan', 'input': data}, 'sealed_payload_wrong')
    if number == 3:
        h.require(not after_rows['plans'] and not after_rows['items'] and not after_rows['generic'], 'late_save_applied_after_terminal_cancel')
        h.require(counts(a, ids, request) == [1, 0], 'cancel_receipt_counts_wrong')
    else:
        h.require(len(after_rows['plans']) == 1 and after_rows['plans'][0][0]['edit_revision'] == 1, 'plan_or_revision_duplicated')
        h.require(len(after_rows['items']) == 2 and counts(a, ids, request) == [1, 1], 'item_or_receipt_count_wrong')
        saved_items = {row[0]['goal_id']: row[0] for row in after_rows['items']}
        h.require(saved_items[ids['goal']]['monthly_cents'] == 2000 and saved_items[ids['goal2']]['included'] is False,
                  'CAS_changed_winner_intent')
        h.require(after_rows['generic'][0][0]['result'] == expected, 'generic_result_disagrees_with_seal')
    h.require(financial_snapshot(a, ids) == before, 'command_changed_financial_rows')
    # Replay both APIs after commit: no new revision, rows, receipt or financial effect.
    h.require(command(a, ids, data, request, 'save') == expected, 'committed_save_replay_wrong')
    h.require(command(a, ids, data, request, 'resolve') == expected, 'committed_resolution_replay_wrong')
    h.require(rows(a, ids) == after_rows and financial_snapshot(a, ids) == before, 'replay_mutated_any_scoped_rows')
    a.rollback()
    labels = {1: 'same_request_same_input', 2: 'different_requests_same_revision',
              3: 'resolve_before_late_save', 4: 'save_before_concurrent_resolve'}
    h.emit('case_passed', case=number, scenario=labels[number], observed_overlap=wait,
           public_tables_unchanged=len(before) - 1, cash_unchanged=True,
           result='cancelled' if number == 3 else 'revision_1',
           plan_count=len(after_rows['plans']), item_count=len(after_rows['items']),
           sealed_count=len(after_rows['sealed']), generic_count=len(after_rows['generic']),
           loser_sqlstate='PT409' if number == 2 else None,
           loser_receipts=0 if number == 2 else None, exact_sealed_replay_both_APIs=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        h.emit('preview', target=h.REF, branch=h.BRANCH, real_connections=2, scenarios=4,
               network_executed=False, cleanup='finally: exact new users/workspaces, FK cascades and UUID boundary audit')
        return 0
    connections, active, fixtures = [], [], []
    error = cleanup_error = None
    passed = 0
    phase = 'preflight'
    previous_handler = signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        dsn = h.staging_dsn()
        a, apid = h.connect(dsn)
        connections.append(a)
        b, bpid = h.connect(dsn)
        connections.append(b)
        h.require(apid != bpid, 'two_distinct_backend_sessions_required')
        for conn in connections:
            h.query(conn, "set application_name='proops-f08-isolated-races'")
            conn.commit()
        phase = 'applied_schema'
        h.require(h.one(a, 'select count(*) from supabase_migrations.schema_migrations where version=any(%s::text[])', (MIGRATIONS,)) == 3,
                  'all_three_F08_migrations_must_be_applied')
        h.require(h.one(a, "select to_regprocedure('public.save_goal_plan(jsonb,uuid)') is not null and to_regprocedure('public.resolve_goal_plan_attempt(jsonb,uuid)') is not null"), 'F08_APIs_missing')
        a.rollback()
        h.emit('connections_verified', distinct_backends=True, transaction_isolation='read committed', applied_F08_migrations=3,
               statement_timeout_seconds=10, lock_timeout_seconds=8)
        for number in (1, 2, 3, 4):
            ids = {key: str(uuid.uuid4()) for key in ['user', 'workspace', 'account', 'goal', 'goal2']}
            ids['case'] = number
            fixtures.append(ids)
            persist_manifest(fixtures)
            phase = f'fixture_{number}'
            fixture(a, ids)
            persist_manifest(fixtures)
            phase = f'case_{number}'
            run_case(number, a, apid, b, bpid, ids, active)
            passed += 1
            persist_manifest(fixtures)
    except BaseException as exc:
        error = exc
        h.emit('run_failed', phase=phase, error_type=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None),
               reason=str(exc) if isinstance(exc, RuntimeError) else 'sanitized_exception')
    finally:
        try:
            for conn in connections:
                if not active or conn is not active[0][2]:
                    conn.rollback()
            if active:
                worker = active[0]
                if not worker[0].done():
                    worker[2].cancel()
                try:
                    h.join(worker)
                finally:
                    h.require(not worker[1].is_alive(), 'cleanup_has_live_worker')
                    active.clear()
            if connections:
                for ids in fixtures:
                    h.cleanup(connections[0], ids)
                persist_manifest(fixtures, cleaned=True)
            else:
                h.emit('cleanup_skipped', zero_residue=True, reason='no_connection_or_fixture')
        except BaseException as exc:
            cleanup_error = exc
            h.emit('cleanup_failed', error_type=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None),
                   reason=str(exc) if isinstance(exc, RuntimeError) else 'sanitized_exception', zero_residue=False)
        finally:
            for conn in connections:
                conn.close()
            signal.signal(signal.SIGTERM, previous_handler)
    success = error is None and cleanup_error is None and passed == 4
    h.emit('completed', passed=success, scenarios_passed=passed, staging_only=True,
           fixtures=len(fixtures), cleanup_passed=cleanup_error is None and bool(connections))
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
