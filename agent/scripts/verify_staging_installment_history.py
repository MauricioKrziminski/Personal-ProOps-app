"""Staging-only authenticated RPC proof; all fixture writes forcibly rolled back."""
from uuid import uuid4
import psycopg
from verify_staging_finance import staging_connection_url, check


def main():
    workspace, foreign = uuid4(), uuid4()
    conn = psycopg.connect(staging_connection_url(), autocommit=True, connect_timeout=15)
    try:
        with conn.transaction(force_rollback=True):
            conn.execute("set local statement_timeout='15s'")
            author = conn.execute('select id from profiles order by created_at limit 1').fetchone()[0]
            for ws in [workspace, foreign]:
                conn.execute('insert into workspaces(id,name,owner_id) values(%s,%s,%s)',
                             (ws, f'qa-history-rollback-{ws}', author))
            conn.execute("insert into workspace_members(workspace_id,user_id,role) values(%s,%s,'owner') on conflict do nothing", (workspace, author))
            accounts = []
            for ws in [workspace, foreign]:
                accounts.append(conn.execute("insert into accounts(workspace_id,user_id,name,type,closing_day,due_day) values(%s,%s,%s,'credit_card',10,20) returning id", (ws,author,f'qa-history-{ws}')).fetchone()[0])
            conn.execute("select set_config('request.jwt.claim.sub',%s,true)",(str(author),))
            conn.execute('set local role authenticated')
            for count in [0,8,48]:
                plan = conn.execute("select create_installment_plan_with_history(%s,7056001,48,'2026-01-08',%s,'qa-carro')",(accounts[0],count)).fetchone()[0]
                rows = conn.execute('select installment_no,status,amount_cents,invoice_id from transactions where installment_plan_id=%s order by installment_no',(plan,)).fetchall()
                check(len(rows)==48,'48 rows in authenticated workspace')
                check(sum(r[2] for r in rows)==7056001,'exact total conserved')
                check([r[0] for r in rows if r[1]=='cleared']==list(range(1,count+1)),'exact paid prefix')
                check(all(r[3] for r in rows),'invoice trigger executed')
            check(conn.execute("select count(*) from card_invoices where workspace_id=%s and status='paid'",(workspace,)).fetchone()[0]==0,'invoice-wide status preserved')
            historical_invoice = conn.execute("select id from card_invoices where workspace_id=%s order by due_date limit 1", (workspace,)).fetchone()[0]
            before = conn.execute("select ref_id from upcoming_bills(7) where ref_id=%s and kind='invoice'", (historical_invoice,)).fetchall()
            check(len(before) == 1, 'historical invoice appears in Today before settling')
            wrong_write = conn.execute("update transactions set status='cleared' where id=%s returning id", (historical_invoice,)).fetchall()
            check(wrong_write == [], 'invoice UUID does not update any transaction: old Today false success reproduced')
            conn.execute("select settle_invoice(%s,current_date)", (historical_invoice,))
            check(conn.execute("select ref_id from upcoming_bills(7) where ref_id=%s", (historical_invoice,)).fetchall() == [], 'settled invoice disappears from Today source immediately')
            for sql,args in [
                ("select create_installment_plan_with_history(%s,4800,48,current_date,0)",(accounts[1],)),
                ("select create_installment_plan(%s,4800,48,'2026-01-08')",(accounts[0],)),
                ("select create_installment_plan_with_history(%s,4800,48,current_date,49)",(accounts[0],)),
            ]:
                try:
                    with conn.transaction(): conn.execute(sql,args)
                except psycopg.errors.RaiseException: pass
                else: raise AssertionError('invalid/foreign request unexpectedly succeeded')
            conn.execute('reset role')
        for table in ['accounts','installment_plans','transactions','card_invoices','workspace_members']:
            check(conn.execute(f'select count(*) from public.{table} where workspace_id in (%s,%s)',(workspace,foreign)).fetchone()[0]==0,f'rollback empty {table}')
        check(conn.execute('select count(*) from workspaces where id in (%s,%s)',(workspace,foreign)).fetchone()[0]==0,'rollback workspaces')
        print('PASS staging: Today false-success reproduced, settled invoice removed from upcoming_bills; authenticated RPC, 0/8/48 paid, exact sums, invoice status preserved, foreign account denied; rollback zero fixtures')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
