"""Staging-only database invariants; every fixture write is rolled back.

Run from agent/: PYTHONPATH=. .venv/bin/python scripts/verify_staging_finance.py
No global scheduler, WhatsApp, existing-data writes, or production connection.
"""
from datetime import date, datetime, timezone
from uuid import uuid4
import psycopg
from psycopg.conninfo import conninfo_to_dict
from app.config import get_settings

STAGING_REF = 'utkqoiigimqzeenxkxdl'


def staging_connection_url():
    url = get_settings().database_url
    if STAGING_REF not in url:
        raise RuntimeError('Only explicit staging DATABASE_URL is allowed')
    info = conninfo_to_dict(url)
    host, user = info.get('host', ''), info.get('user', '')
    if not (host == f'db.{STAGING_REF}.supabase.co' or
            (host.endswith('.pooler.supabase.com') and user == f'postgres.{STAGING_REF}')):
        raise RuntimeError('Staging identity not established from host/user')
    return url


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    stage, conn = 'staging guard', None
    workspace = uuid4()
    name = f'qa-finance-rollback-{uuid4().hex}'
    try:
        url = staging_connection_url()
        stage = 'connect'
        conn = psycopg.connect(url, autocommit=True, connect_timeout=15, prepare_threshold=None)
        # Explicit transaction starts before ANY statement. Never use a connection context
        # whose normal exit could commit fixtures. force_rollback applies on success too.
        with conn.transaction(force_rollback=True):
            conn.execute("SET LOCAL statement_timeout = '15s'")
            conn.execute("SET LOCAL lock_timeout = '3s'")
            stage = 'fixture workspace'
            author_row = conn.execute('SELECT id FROM public.profiles ORDER BY created_at LIMIT 1').fetchone()
            check(author_row is not None, 'One existing staging profile required')
            author = author_row[0]
            conn.execute('INSERT INTO public.workspaces(id,name,owner_id) VALUES (%s,%s,%s)',
                         (workspace, name, author))
            cards = []
            for label, closing, due in [('A', 10, 20), ('B', 5, 15)]:
                cards.append(conn.execute('''INSERT INTO public.accounts
                    (workspace_id,user_id,name,type,closing_day,due_day)
                    VALUES (%s,%s,%s,'credit_card',%s,%s) RETURNING id''',
                    (workspace, author, f'{name}-{label}', closing, due)).fetchone()[0])
            bank = conn.execute('''INSERT INTO public.accounts(workspace_id,user_id,name,type)
                VALUES (%s,%s,%s,'checking') RETURNING id''',
                (workspace, author, f'{name}-bank')).fetchone()[0]
            stage = 'WhatsApp-origin transaction edits'
            tx = conn.execute('''INSERT INTO public.transactions
                (workspace_id,user_id,kind,amount_cents,account_id,occurred_at,source,status,description)
                VALUES (%s,%s,'expense',10000,%s,'2026-09-08','whatsapp','pending','rollback fixture')
                RETURNING id''', (workspace, author, cards[0])).fetchone()[0]

            def invoice_state():
                row = conn.execute('''SELECT t.amount_cents,t.source,t.due_at,t.invoice_id,i.due_date
                    FROM public.transactions t LEFT JOIN public.card_invoices i ON i.id=t.invoice_id
                    WHERE t.id=%s AND t.workspace_id=%s''', (tx, workspace)).fetchone()
                check(row is not None, 'Edited row exists')
                count = conn.execute('SELECT count(*) FROM public.transactions WHERE workspace_id=%s',
                                     (workspace,)).fetchone()[0]
                check(count == 1, 'Edits retain exactly one transaction')
                check(row[1] == 'whatsapp', 'Origin preserved')
                return row

            row = invoice_state()
            check(row[2] == row[4] == date(2026, 9, 20), 'Initial invoice deadline')
            conn.execute('UPDATE public.transactions SET amount_cents=12500 WHERE id=%s AND workspace_id=%s',
                         (tx, workspace))
            check(invoice_state()[0] == 12500, 'Amount updated in place')
            conn.execute("UPDATE public.transactions SET occurred_at='2026-09-12' WHERE id=%s AND workspace_id=%s",
                         (tx, workspace))
            row = invoice_state()
            check(row[2] == row[4] == date(2026, 10, 20), 'Date recomputes deadline')
            conn.execute('UPDATE public.transactions SET account_id=%s WHERE id=%s AND workspace_id=%s',
                         (cards[1], tx, workspace))
            row = invoice_state()
            check(row[2] == row[4] == date(2026, 10, 15), 'Card recomputes deadline')
            conn.execute('UPDATE public.transactions SET account_id=%s WHERE id=%s AND workspace_id=%s',
                         (bank, tx, workspace))
            row = invoice_state()
            check(row[2] is None and row[3] is None, 'Bank clears inherited invoice/deadline')
            print('PASS transaction: WhatsApp origin, amount/date/account edits, one row, coherent invoice', flush=True)

            stage = 'financing payment, edit and reversal'
            debt = conn.execute('''INSERT INTO public.debts
                (workspace_id,user_id,name,kind,principal_cents,remaining_cents,interest_rate_monthly,
                 installments,installment_cents,account_id)
                VALUES (%s,%s,%s,'financing',100000,100000,0.01,12,11000,%s) RETURNING id''',
                (workspace, author, f'{name}-debt', bank)).fetchone()[0]
            balance = conn.execute("SELECT public.pay_debt_installment(%s,11000,%s,'2026-09-08')",
                                   (debt, bank)).fetchone()[0]
            check(balance == 90000, 'Principal deducted once')
            payments = conn.execute('''SELECT id,amount_cents,account_id,debt_principal_cents,debt_interest_cents
                FROM public.transactions WHERE debt_id=%s AND workspace_id=%s''',
                (debt, workspace)).fetchall()
            check(len(payments) == 1, 'One payment created')
            payment = payments[0]
            check(payment[1:] == (11000, bank, 10000, 1000), 'Allocation and account correct')
            conn.execute('UPDATE public.transactions SET amount_cents=21000 WHERE id=%s AND workspace_id=%s',
                         (payment[0], workspace))
            state = conn.execute('SELECT remaining_cents,installments_paid FROM public.debts WHERE id=%s',
                                 (debt,)).fetchone()
            check(state == (80000, 1), 'Latest amount edit revises principal once')
            check(conn.execute('SELECT count(*) FROM public.transactions WHERE debt_id=%s',
                               (debt,)).fetchone()[0] == 1, 'No duplicate payment')
            conn.execute('DELETE FROM public.transactions WHERE id=%s AND workspace_id=%s',
                         (payment[0], workspace))
            state = conn.execute('SELECT remaining_cents,installments_paid FROM public.debts WHERE id=%s',
                                 (debt,)).fetchone()
            check(state == (100000, 0), 'Delete restores balance and paid count')
            print('PASS financing: RPC creates once, latest amount edit updates balance, delete restores balance', flush=True)

            stage = 'recurring fixture storage'
            recurring = conn.execute('''INSERT INTO public.recurring_transactions
                (workspace_id,user_id,kind,amount_cents,description,account_id,rrule,next_run_at,auto_confirm)
                VALUES (%s,%s,'expense',7500,'rollback recurring',%s,'FREQ=MONTHLY;BYMONTHDAY=8',%s,false)
                RETURNING id''', (workspace, author, bank, datetime(2026, 9, 8, 12, tzinfo=timezone.utc))).fetchone()[0]
            conn.execute('''UPDATE public.recurring_transactions SET amount_cents=8000,
                rrule='FREQ=MONTHLY;BYMONTHDAY=15' WHERE id=%s AND workspace_id=%s''',
                (recurring, workspace))
            state = conn.execute('''SELECT amount_cents,rrule,auto_confirm FROM public.recurring_transactions
                WHERE id=%s AND workspace_id=%s''', (recurring, workspace)).fetchone()
            check(state == (8000, 'FREQ=MONTHLY;BYMONTHDAY=15', False), 'Recurring edit persisted inside transaction')
            print('PASS recurring: fixture created/edited with explicit auto_confirm=false', flush=True)
            print('SKIP scheduler: materialize_horizon and _promote_due_transactions are global', flush=True)

        stage = 'rollback verification'
        # Only read-only statements outside the rollback transaction. Identifiers are fixed.
        for table in ['workspaces', 'accounts', 'transactions', 'card_invoices', 'debts', 'recurring_transactions']:
            column = 'id' if table == 'workspaces' else 'workspace_id'
            query = psycopg.sql.SQL('SELECT count(*) FROM public.{} WHERE {}=%s').format(
                psycopg.sql.Identifier(table), psycopg.sql.Identifier(column))
            check(conn.execute(query, (workspace,)).fetchone()[0] == 0, f'Zero remaining fixtures: {table}')
        print('PASS rollback: zero fixture rows remain across all six tables', flush=True)
        print('LIMIT: direct DB connection; authenticated RLS, app interaction, WhatsApp delivery not exercised', flush=True)
    except Exception as exc:
        # No DSN, SQL parameters, profile ID or traceback is emitted.
        print(f'FAIL stage={stage} class={type(exc).__name__} sqlstate={getattr(exc, "sqlstate", None)}', flush=True)
        raise SystemExit(1) from None
    finally:
        if conn is not None:
            conn.close()


if __name__ == '__main__':
    main()
