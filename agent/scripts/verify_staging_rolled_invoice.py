"""Staging-only: fatura ADIADA não é fatura aberta para o agente.

Prova contra o Postgres de verdade o que os dublês do pytest não provam — que o
SQL das tools do agente concorda com o `roll_invoice` do banco. Toda fixture é
revertida (`force_rollback`), inclusive em caso de sucesso.

Run from agent/: PYTHONPATH=. .venv/bin/python scripts/verify_staging_rolled_invoice.py
"""
from datetime import date, timedelta
from uuid import uuid4

import psycopg
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

from app.config import get_settings
from app.tools.base import FATURA_ABERTA

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


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print(f'  ok  {msg}')


def main():
    conn = psycopg.connect(staging_connection_url(), autocommit=True,
                           connect_timeout=15, prepare_threshold=None, row_factory=dict_row)
    ws, nome = uuid4(), f'qa-rolled-{uuid4().hex[:8]}'
    try:
        with conn.transaction(force_rollback=True):
            conn.execute("SET LOCAL statement_timeout = '20s'")
            dono = conn.execute('SELECT id FROM public.profiles ORDER BY created_at LIMIT 1').fetchone()['id']
            conn.execute('INSERT INTO public.workspaces(id,name,owner_id) VALUES (%s,%s,%s)', (ws, nome, dono))
            conn.execute('INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES (%s,%s,%s)',
                         (ws, dono, 'owner'))

            cartao = conn.execute(
                """insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,
                                               credit_limit_cents,rotativo_rate_monthly)
                   values (%s,%s,%s,'credit_card',3,10,500000,0.15) returning id""",
                (ws, dono, f'{nome}-card'),
            ).fetchone()['id']

            # Uma compra num ciclo já vencido → o trigger resolve a fatura.
            venceu = date.today() - timedelta(days=40)
            conn.execute(
                """insert into public.transactions(workspace_id,user_id,account_id,kind,
                                                   amount_cents,description,occurred_at,status)
                   values (%s,%s,%s,'expense',100000,'compra do teste',%s,'cleared')""",
                (ws, dono, cartao, venceu),
            )
            inv = conn.execute(
                'select id, status, due_date from public.card_invoices where account_id = %s', (cartao,)
            ).fetchone()
            check(inv is not None, 'o trigger set_invoice criou a fatura')

            aberto = conn.execute('select private.invoice_open_cents(%s) as v', (inv['id'],)).fetchone()['v']
            check(aberto == 100000, f'fatura abre com R$ 1.000,00 (veio {aberto})')

            # --- ADIA ---
            res = conn.execute('select public.roll_invoice(%s) as r', (inv['id'],)).fetchone()['r']
            print(f'  ..  roll_invoice: principal={res["principal_cents"]} juros={res["juros_cents"]} '
                  f'iof={res["iof_cents"]} taxa={res.get("taxa_usada")}')
            depois = conn.execute('select status from public.card_invoices where id = %s',
                                  (inv['id'],)).fetchone()
            check(depois['status'] == 'rolled', "a fatura ficou com status 'rolled'")

            # --- 1) o filtro do agente (pay_invoice / resolver) ignora a adiada ---
            achou = conn.execute(
                f"""select ci.id from public.card_invoices ci
                    where ci.account_id = %s and ci.workspace_id = %s and ci.{FATURA_ABERTA}
                    order by ci.due_date limit 1""",
                (cartao, ws),
            ).fetchone()
            check(achou is None or achou['id'] != inv['id'],
                  'FATURA_ABERTA não devolve a fatura adiada')

            antigo = conn.execute(
                """select ci.id from public.card_invoices ci
                   where ci.account_id = %s and ci.workspace_id = %s and ci.status <> 'paid'
                   order by ci.due_date limit 1""",
                (cartao, ws),
            ).fetchone()
            check(antigo is not None and antigo['id'] == inv['id'],
                  "o filtro ANTIGO (<> 'paid') devolvia a adiada — o bug existia mesmo")

            # --- 2) o limite não conta o mesmo dinheiro duas vezes ---
            linha = conn.execute(
                """select credit_limit_cents, available_limit_cents
                   from public._card_summary(%s) where account_id = %s""",
                (dono, cartao),
            ).fetchone()
            soma_antiga = conn.execute(
                """select coalesce(sum(t.amount_cents),0) as total
                   from public.transactions t
                   join public.card_invoices ci on ci.id = t.invoice_id
                   where ci.account_id = %s and ci.status <> 'paid' and t.workspace_id = %s""",
                (cartao, ws),
            ).fetchone()['total']
            comprometido = linha['credit_limit_cents'] - linha['available_limit_cents']
            print(f'  ..  comprometido: _card_summary={comprometido}  soma antiga={soma_antiga}')
            check(soma_antiga > comprometido,
                  f'a soma antiga inflava o comprometido ({soma_antiga} > {comprometido})')
            check(comprometido == res['principal_cents'] + res['juros_cents'] + res['iof_cents'],
                  'o comprometido é exatamente o que foi para a fatura nova — contado UMA vez')

        print('\nTudo certo. Nada ficou no banco (force_rollback).')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
