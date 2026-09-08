"""Authenticated simple financing proof in staging; fixtures always rolled back."""
from uuid import uuid4

import psycopg

from verify_staging_finance import check, staging_connection_url


def main():
    workspace = uuid4()
    with psycopg.connect(staging_connection_url(), autocommit=True, connect_timeout=15) as conn:
        with conn.transaction(force_rollback=True):
            conn.execute("set local statement_timeout='15s'")
            author = conn.execute('select id from profiles order by created_at limit 1').fetchone()[0]
            conn.execute('insert into workspaces(id,name,owner_id) values(%s,%s,%s)',
                         (workspace, f'qa-simple-{workspace}', author))
            conn.execute("insert into workspace_members(workspace_id,user_id,role) values(%s,%s,'owner') on conflict do nothing", (workspace, author))
            account = conn.execute("insert into accounts(workspace_id,user_id,name,type,initial_balance_cents) values(%s,%s,'QA conta','checking',10000000) returning id", (workspace, author)).fetchone()[0]
            conn.execute("select set_config('request.jwt.claim.sub',%s,true)", (str(author),))
            conn.execute('set local role authenticated')
            debt = conn.execute("""insert into debts(workspace_id,user_id,name,kind,calculation_mode,
                principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents)
                values(%s,%s,'QA carro','financing','fixed_installments',7056000,5880000,0,48,8,147000) returning id""", (workspace, author)).fetchone()[0]
            schedule = conn.execute('select payment_cents,interest_cents,principal_cents from debt_schedule(%s)', (debt,)).fetchall()
            check(len(schedule) == 40, '40 installments remaining')
            check(all(row == (147000, None, None) for row in schedule), 'contract amount with unknown breakdown')
            check(conn.execute("select interest_rate_monthly,total_interest_cents from payoff_strategy('avalanche') where debt_id=%s", (debt,)).fetchone() == (None, None), 'unknown rate and interest remain null')
            for sql, args in [
                ('select pay_debt_installment(%s,146999,%s)', (debt, account)),
                ("update debts set calculation_mode='amortized' where id=%s", (debt,)),
            ]:
                try:
                    with conn.transaction():
                        conn.execute(sql, args)
                except psycopg.errors.RaiseException:
                    pass
                else:
                    raise AssertionError('invalid simple financing write unexpectedly succeeded')
            conn.execute('select pay_debt_installment(%s,147000,%s)', (debt, account))
            check(conn.execute('select remaining_cents,installments_paid from debts where id=%s', (debt,)).fetchone() == (5733000, 9), 'one installment settled exactly once')
            check(conn.execute('select count(*),sum(amount_cents) from transactions where debt_id=%s and account_id=%s', (debt, account)).fetchone() == (1, 147000), 'one actual payment, exact amount and account')
            conn.execute('reset role')
        for table in ['transactions', 'debts', 'accounts', 'workspace_members']:
            check(conn.execute(f'select count(*) from {table} where workspace_id=%s', (workspace,)).fetchone()[0] == 0, f'no fixture residue in {table}')
        check(conn.execute('select count(*) from workspaces where id=%s', (workspace,)).fetchone()[0] == 0, 'no workspace residue')
    print('PASS authenticated staging simple financing: 48x1470, 8 paid, 40 remaining, unknown interest, exact payment and rollback without residue')


if __name__ == '__main__':
    main()
