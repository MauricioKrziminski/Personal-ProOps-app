"""Scheduler flow oracles; PostgreSQL lock/snapshot proof remains integration QA."""
from datetime import UTC, datetime
from uuid import uuid4
import re
import pytest
from app.jobs import scheduler
START = datetime(2026, 9, 4, 12, tzinfo=UTC)
NOW = datetime(2026, 10, 3, 12, tzinfo=UTC)
def current_series():
    return dict(id=uuid4(), user_id=uuid4(), workspace_id=uuid4(), kind='income', amount_cents=2500,
                currency='BRL', category='receitas', description='Título atual', merchant=None, account_id=uuid4(),
                rrule='FREQ=MONTHLY;BYMONTHDAY=4', next_run_at=START, dtstart=START, end_date=None,
                auto_confirm=True, materialized_until=None, timezone='America/Sao_Paulo', edit_revision=7)
class Boundary:
    """Independent version fixtures + command CAS response, not a SQL engine.
    Legacy VALUES bindings exercise RED; corrected writes keep financial values in SQL.
    """
    def __init__(self, monkeypatch, *, obsolete=False, null_history=False, adoption=False):
        self.row=current_series(); self.obsolete=obsolete; self.adoption=adoption
        self.ledger={}; self.updates=[]; self.commands=[]; self.cursor=None
        self.history=dict(kind='expense',amount_cents=1000,category='alimentação',description='Título antigo',
                          account_id=uuid4(),payment_method='cash',subcategory_id=uuid4())
        if null_history:
            self.history.update(category=None,description=None,account_id=None,payment_method=None,subcategory_id=None)
        monkeypatch.setattr(scheduler.db,'fetch',self.fetch)
        monkeypatch.setattr(scheduler.db,'fetch_one',self.one)
        monkeypatch.setattr(scheduler.db,'execute',self.execute)
        monkeypatch.setattr(scheduler,'MAX_OCCURRENCES_PER_SERIES',2)
    async def fetch(self,sql,*args):
        return [dict(self.row)] if 'from public.recurring_transactions' in sql else []
    async def one(self,sql,*args):
        if 'insert into public.transactions' not in sql: return None
        self.commands.append((sql,args))
        for value in (self.row['kind'],self.row['amount_cents'],self.row['description'],self.row['account_id']):
            assert value not in args,'stale Python financial fields crossed SQL boundary'
        assert 'for share' in sql.lower() and re.search(r'r\.edit_revision\s*=\s*%s',sql),'CAS must guard locked base R'
        for field in ('kind','amount_cents','category','description','account_id'):
            assert re.search(rf'case when v\.recurring_id is not null then v\.{field} else r\.{field} end',sql,re.I),'historical tuple missing/null-overwritten'
        assert 'private.recurring_history_versions' in sql
        if self.obsolete:
            # FUTURE commits after fetch returned revision7, before command locks R.
            self.row['edit_revision'] += 1
            self.row['amount_cents'] = 9999
            self.obsolete = False
        if args[1]!=self.row['edit_revision']: return {'intent_current':False,'created':False}
        day=args[4]
        if self.adoption and day=='2026-09-04' and day not in self.ledger:
            self.ledger[day]={**self.history,'subcategory_id':None,'subcategory_snapshot_set':True,'adopted':True}
            self.row['edit_revision']+=1
            return {'intent_current':True,'created':False}
        if day in self.ledger:return {'intent_current':True,'created':False}
        values=self.history if day<'2026-10-03' else {**self.row,'payment_method':'pix','subcategory_id':uuid4()}
        self.ledger[day]={key:values[key] for key in self.history}
        return {'intent_current':True,'created':True}
    async def execute(self,sql,*args):
        if 'insert into public.transactions' in sql:
            self.ledger[args[10]]=dict(kind=args[2],amount_cents=args[3],category=self.history['category'],
                description=args[7],account_id=args[9],payment_method=self.history['payment_method'],subcategory_id=self.history['subcategory_id'])
            return 1
        self.updates.append((sql,args))
        if 'materialized_until' in sql and ('edit_revision' not in sql or args[-1]==self.row['edit_revision']):self.cursor=args[1]
        return 1
@pytest.mark.asyncio
async def test_delayed_first_materialization_keeps_whole_old_tuple_then_future(monkeypatch):
    server=Boundary(monkeypatch)
    assert await scheduler.materialize_horizon(NOW)==2
    past=server.ledger['2026-09-04']
    assert {key:past[key] for key in server.history}==server.history
    assert server.ledger['2026-10-04']['kind']=='income'
    assert server.ledger['2026-10-04']['amount_cents']==2500
    assert server.ledger['2026-10-04']['category']=='receitas'
    assert server.cursor==datetime(2026,10,4,12,tzinfo=UTC)
@pytest.mark.asyncio
async def test_genuine_null_history_does_not_take_current_defaults(monkeypatch):
    server=Boundary(monkeypatch,null_history=True);await scheduler.materialize_horizon(NOW)
    for field in ('category','description','account_id','payment_method','subcategory_id'):
        assert server.ledger['2026-09-04'][field] is None
@pytest.mark.asyncio
async def test_edit_after_fetch_aborts_without_write_cursor_or_false_error(monkeypatch):
    server=Boundary(monkeypatch,obsolete=True)
    assert await scheduler.materialize_horizon(NOW)==0
    assert server.ledger=={} and server.cursor is None
    assert not server.updates,'stale intent must not publish cursor or error'
@pytest.mark.asyncio
async def test_adoption_preserves_original_null_and_parent_bump_retries_without_duplicate(monkeypatch):
    server=Boundary(monkeypatch,adoption=True)
    assert await scheduler.materialize_horizon(NOW)==0
    assert list(server.ledger)==['2026-09-04'] and server.ledger['2026-09-04']['subcategory_id'] is None
    assert server.cursor is None
    assert await scheduler.materialize_horizon(NOW)==1
    assert len(server.ledger)==2 and server.ledger['2026-09-04']['adopted'] is True
    assert server.cursor==datetime(2026,10,4,12,tzinfo=UTC)

@pytest.mark.asyncio
async def test_edit_after_last_insert_cannot_publish_old_cursor(monkeypatch):
    server = Boundary(monkeypatch)
    monkeypatch.setattr(scheduler, 'MAX_OCCURRENCES_PER_SERIES', 1)
    original = server.one
    async def racing_one(sql, *args):
        result = await original(sql, *args)
        server.row['edit_revision'] += 1  # Another edit after this statement commits.
        return result
    monkeypatch.setattr(scheduler.db, 'fetch_one', racing_one)
    assert await scheduler.materialize_horizon(NOW) == 1
    assert len(server.ledger) == 1 and server.cursor is None
    assert len(server.updates) == 1 and 'edit_revision = %s' in server.updates[0][0]
    assert 'last_error = %s' not in server.updates[0][0]

@pytest.mark.asyncio
async def test_atomic_adoption_leaves_original_child_and_parent_untouched(monkeypatch):
    row = current_series()
    captured = []
    async def one(sql, *args):
        captured.append(sql)
        return {'intent_current': True, 'created': False}
    monkeypatch.setattr(scheduler.db, 'fetch_one', one)
    result = await scheduler._materialize_occurrence(row, '2026-09-04', True)
    assert result['created'] is False
    sql = captured[0]
    adoption = sql.split('), adopted as (')[1].split('), inserted as (')[0]
    assert 'subcategory_snapshot_set=true' in adoption
    assert not re.search(r'\b(category|subcategory_id|amount_cents|kind)\s*=', adoption)
    assert 'not exists(select 1 from adopted)' in sql
    assert 'c.workspace_id=t.workspace_id and c.parent_key=private.fold(t.category)' in sql

@pytest.mark.asyncio
async def test_failed_old_statement_cannot_attach_error_to_newer_intent(monkeypatch):
    server = Boundary(monkeypatch)
    async def failed_one(sql, *args):
        server.row['edit_revision'] += 1
        raise RuntimeError('old materialization failed after a concurrent edit')
    monkeypatch.setattr(scheduler.db, 'fetch_one', failed_one)
    assert await scheduler.materialize_horizon(NOW) == 0
    assert len(server.updates) == 1
    sql, args = server.updates[0]
    assert 'edit_revision = %s' in sql and args[-1] == 7
