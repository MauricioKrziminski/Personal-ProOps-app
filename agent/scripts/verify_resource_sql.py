"""Read/write ONLY an isolated PGlite process via JSON-lines on stdin/stdout.

Invoked by supabase/tests/resource_invariants.mjs. Real prepare/execute SQL is
forwarded to the harness instead of app.db; no pool or network is opened.
"""
import asyncio
import json
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db
from app.graph.schemas import ResourceAction
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = '00000000-0000-0000-0000-000000000001'
USER = '00000000-0000-0000-0000-000000000002'
ctx = ExecContext(UUID(USER), UUID(WS), None, 'America/Sao_Paulo', 'fixture', 'fixture')

async def query(sql, *params):
    print(json.dumps({'query': sql, 'params': params}, default=str), flush=True)
    result = json.loads(sys.stdin.readline())
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result['rows']

async def one(sql, *params):
    rows = await query(sql, *params)
    return rows[0] if rows else None

db.fetch, db.fetch_one = query, one
CASES = {
    'accounts': {'name':'Conta teste', 'type':'checking', 'initial_balance_cents':'-100', 'archived':'false'},
    'cards': {'name':'Cartao teste','closing_day':'10','due_day':'20','credit_limit_cents':'100000','payment_account_id':'Banco base','archived':'false'},
    'folders': {'name':'Trabalho','parent_id':'pasta base'},
    'goals': {'name':'Meta teste','target_cents':'10000','deadline':'2027-10-01','archived':'false'},
    'reminders': {'title':'Lembrete teste','next_run_at':'2027-10-01T12:00:00-03:00','recurrence':'FREQ=MONTHLY','channel':'both','active':'true'},
    'recurring': {'description':'Serie teste','kind':'expense','amount_cents':'1000','category':'mercado','account_id':'Banco base','rrule':'FREQ=MONTHLY','dtstart':'2027-10-01T12:00:00-03:00','auto_confirm':'false','active':'true'},
    'debts': {'name':'Divida teste','kind':'financing','principal_cents':'100000','remaining_cents':'80000','interest_rate_monthly':'0.01','installments':'12','installments_paid':'2','installment_cents':'8000','due_day':'10','account_id':'Banco base','started_at':'2026-08-01','archived':'false'},
    'budgets': {'category':'mercado','limit_cents':'10000','month':'2027-10-01','rollover':'true'},
    'assets': {'name':'Bem teste','class':'vehicle','current_value_cents':'100000','is_liability':'false','acquired_at':'2026-01-01','archived':'false'},
    'rules': {'pattern':'padaria','match_type':'contains','category':'alimentacao','account_id':'Banco base','priority':'10'},
    'notes': {'content':'Nota teste','folder_id':'pasta base','pinned':'true'},
}

async def main():
    failures = []
    for resource, fields in CASES.items():
        identity = resources.CATALOG[resource][1]
        name = fields[identity]
        try:
            for operation in ('create','update','list','delete'):
                values = dict(fields) if operation in {'create', 'update'} else {}
                if operation == 'update':
                    values[identity] = name + ' alterado'
                    if resource == 'assets':
                        values.pop('current_value_cents')  # dedicated valuation tool owns this field
                action = ResourceAction(type='resource_'+operation, resource=resource,
                    name=name, target_month='2027-10-01' if resource == 'budgets' and operation != 'create' else None,
                    fields=[{'name': k, 'value': v} for k,v in values.items()])
                prepared = await resources.prepare(ctx, action)
                ctx.target = {'prepared':prepared}
                result = await resources.execute(ctx, action)
                if operation == 'update':
                    name = values[identity]
                if operation != 'list':
                    assert result.result_id, (resource, operation, result)
                else:
                    assert name.lower() in result.message.lower(), (resource, result.message)
                if operation == 'delete' and resource == 'notes':
                    rows = await query('select content from notes where id=%s and deleted_at is not null',result.result_id)
                    assert len(rows) == 1, 'note deletion should preserve a tombstone'
                    listing = ResourceAction(type='resource_list',resource='notes')
                    ctx.target = {'prepared':await resources.prepare(ctx,listing)}
                    assert name not in (await resources.execute(ctx,listing)).message
                print(json.dumps({'pass':resource+'/'+operation}), flush=True)
        except Exception as error:
            failures.append(resource + ': ' + str(error))
            print(json.dumps({'failure':failures[-1]}), flush=True)
    # The referenced row changes AFTER prepare but BEFORE the single write.
    for change in ('archived', 'workspace_id', 'type'):
        await query("update accounts set archived=false, workspace_id=%s, type='checking' where name='Banco base'", WS)
        action = ResourceAction(type='resource_create', resource='cards', name='Race card', fields=[
            {'name':'closing_day','value':'10'}, {'name':'due_day','value':'20'},
            {'name':'payment_account_id','value':'Banco base'}])
        ctx.target = {'prepared':await resources.prepare(ctx, action)}
        new_value = True if change == 'archived' else USER if change == 'workspace_id' else 'credit_card'
        if change == 'workspace_id':
            await query('insert into workspaces(id) values(%s) on conflict do nothing',USER)
        await query("update accounts set "+change+"=%s where name='Banco base'", new_value)
        try:
            await resources.execute(ctx, action)
        except Level1Error:
            print(json.dumps({'pass':'reference race '+change}), flush=True)
        else:
            failures.append('reference race accepted: '+change)
    await query("update accounts set archived=false, workspace_id=%s, type='checking' where name='Banco base'", WS)
    action = ResourceAction(type='resource_update', resource='accounts', name='Banco base',
                            fields=[{'name':'name','value':'Unapproved name'}])
    ctx.target = {'prepared':await resources.prepare(ctx, action)}
    await query("update accounts set initial_balance_cents=100 where name='Banco base'")
    try:
        await resources.execute(ctx, action)
    except Level1Error:
        print(json.dumps({'pass':'target xmin race'}),flush=True)
    else:
        failures.append('target xmin race accepted')
    await payment_cases(failures)
    print(json.dumps({'done':True,'failures':failures}), flush=True)
    return bool(failures)

async def payment_cases(failures):
    bank = (await one("select id from accounts where name='Banco base'"))['id']
    debt = (await one("insert into debts(user_id,workspace_id,name,principal_cents,remaining_cents,interest_rate_monthly,installments,account_id) values(%s,%s,'Carro SQL',100000,100000,0.01,12,%s) returning id",USER,WS,bank))['id']
    action = ResourceAction(type='resource_pay',resource='debts',name='Carro SQL',fields=[{'name':'amount_cents','value':'11000'},{'name':'paid_at','value':'2026-09-08'}])
    ctx.target = {'prepared':await resources.prepare(ctx,action)}
    result = await resources.execute(ctx,action)
    assert str(result.result_id)==debt
    row=await one('select remaining_cents,installments_paid from debts where id=%s',debt)
    assert row == {'remaining_cents':90000,'installments_paid':1},row
    payment=await one('select amount_cents,debt_interest_cents,debt_principal_cents,account_id from transactions where debt_id=%s',debt)
    assert payment=={'amount_cents':11000,'debt_interest_cents':1000,'debt_principal_cents':10000,'account_id':bank},payment
    print(json.dumps({'pass':'resource_pay exact interest/principal and single transaction'}),flush=True)
    for changed in ('debt','archived','workspace_id','type'):
        ctx.target={'prepared':await resources.prepare(ctx,action)}
        if changed=='debt':
            await query('update debts set name=name || %s where id=%s',' ',debt)
        else:
            new_value=True if changed=='archived' else USER if changed=='workspace_id' else 'credit_card'
            await query('update accounts set '+changed+'=%s where id=%s',new_value,bank)
        try:
            await resources.execute(ctx,action)
        except Level1Error:
            print(json.dumps({'pass':'resource_pay blocks changed '+changed}),flush=True)
        else:
            failures.append('resource_pay accepted changed '+changed)
        count=await one('select count(*)::int as n from transactions where debt_id=%s',debt)
        assert count['n']==1,count
        await query("update accounts set archived=false,workspace_id=%s,type='checking' where id=%s",WS,bank)
        await query("update debts set name='Carro SQL' where id=%s",debt)
    await query('update debts set account_id=null where id=%s',debt)
    try:
        await resources.prepare(ctx,action)
    except Level1Error as error:
        assert 'conta' in error.mensagem_usuario.lower()
        print(json.dumps({'pass':'resource_pay without account asks before proposing'}),flush=True)
    else:
        failures.append('resource_pay without account accepted')


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
