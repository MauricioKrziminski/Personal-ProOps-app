"""Popula um workspace com dados de demonstração — para OLHAR o app, nunca para produção.

Existe porque as telas do app só se avaliam com conteúdo: metade dos blocos (orçamento estourado,
dívida, meta, patrimônio, recorrente, lembrete de hoje) simplesmente não aparece com a base vazia,
e revisar o design sem eles é revisar meia tela.

Idempotente por NOME: cada objeto é procurado antes de ser criado, então rodar duas vezes não
duplica. Nada é apagado.

    .venv/bin/python scripts/seed_demo.py --phone 5535998744200 --env .env.staging

⚠️ O script RECUSA rodar se o `DATABASE_URL` não for o de staging, a menos que `--i-know` seja
passado. Escrever demonstração em produção é o tipo de erro que não tem desfazer.
"""

from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timedelta

import psycopg

STAGING_HOST_HINT = "aws-0-sa-east-1"


def carrega_env(caminho: str) -> dict[str, str]:
    env: dict[str, str] = {}
    with open(caminho) as fh:
        for linha in fh:
            linha = linha.strip()
            if linha and not linha.startswith("#") and "=" in linha:
                chave, valor = linha.split("=", 1)
                env[chave.strip()] = valor.strip()
    return env


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--phone", required=True, help="telefone com DDI, como está em profiles.phone")
    p.add_argument("--env", default=".env.staging")
    p.add_argument("--i-know", action="store_true", help="permite rodar fora do staging")
    args = p.parse_args()

    env = carrega_env(args.env)
    url = env.get("DATABASE_URL") or os.environ["DATABASE_URL"]
    if STAGING_HOST_HINT not in url and not args.i_know:
        raise SystemExit(
            f"DATABASE_URL não parece ser o staging ({STAGING_HOST_HINT}). "
            "Use --i-know se for mesmo isso que você quer."
        )

    hoje = date.today()
    inicio_mes = hoje.replace(day=1)
    fim_mes = (inicio_mes + timedelta(days=32)).replace(day=1) - timedelta(days=1)

    with psycopg.connect(url, connect_timeout=30) as conn, conn.cursor() as cur:
        cur.execute("select id from public.profiles where phone = %s", (args.phone,))
        linha = cur.fetchone()
        if not linha:
            raise SystemExit(f"nenhum profile com phone={args.phone}")
        uid = linha[0]

        cur.execute("select id from public.workspaces where owner_id = %s order by created_at", (uid,))
        ws = cur.fetchone()
        if not ws:
            raise SystemExit("o profile não tem workspace")
        ws = ws[0]
        print(f"workspace {ws} · user {uid}")

        def conta(nome: str, **campos) -> str:
            cur.execute(
                "select id from public.accounts where workspace_id=%s and name=%s", (ws, nome)
            )
            achou = cur.fetchone()
            if achou:
                return achou[0]
            colunas = ["workspace_id", "user_id", "name", *campos.keys()]
            valores = [ws, uid, nome, *campos.values()]
            cur.execute(
                f"insert into public.accounts ({', '.join(colunas)}) "
                f"values ({', '.join(['%s'] * len(colunas))}) returning id",
                valores,
            )
            print(f"  + conta {nome}")
            return cur.fetchone()[0]

        cartao_viagem = conta(
            "Cartão da viagem",
            type="credit_card",
            initial_balance_cents=0,
            closing_day=5,
            due_day=12,
            credit_limit_cents=400000,
        )
        cartao_casa = conta(
            "Cartão da casa",
            type="credit_card",
            initial_balance_cents=0,
            closing_day=20,
            due_day=27,
            credit_limit_cents=600000,
        )
        poupanca = conta("Poupança", type="savings", initial_balance_cents=1850000)

        # --- compras nos cartões novos: o trigger `set_invoice` resolve a fatura sozinho -------
        def gasto(conta_id: str, descricao: str, centavos: int, dia: int, categoria: str) -> None:
            quando = inicio_mes.replace(day=min(dia, fim_mes.day))
            cur.execute(
                "select 1 from public.transactions where workspace_id=%s and description=%s",
                (ws, descricao),
            )
            if cur.fetchone():
                return
            cur.execute(
                """insert into public.transactions
                   (workspace_id, user_id, kind, amount_cents, category, description,
                    account_id, occurred_at, source, status)
                   values (%s,%s,'expense',%s,%s,%s,%s,%s,'app','cleared')""",
                (ws, uid, centavos, categoria, descricao, conta_id, quando),
            )
            print(f"  + gasto {descricao}")

        gasto(cartao_viagem, "Passagem aérea", 128000, 2, "viagem")
        gasto(cartao_viagem, "Hotel Serra", 64500, 8, "viagem")
        gasto(cartao_casa, "Marcenaria", 98000, 4, "casa")
        gasto(cartao_casa, "Ferramentas", 44300, 11, "casa")

        # --- conta a pagar VENCIDA: é ela que acende a seção "Atrasado" da Hoje ---------------
        cur.execute(
            "select 1 from public.transactions where workspace_id=%s and description=%s",
            (ws, "Aluguel"),
        )
        if not cur.fetchone():
            cur.execute(
                """insert into public.transactions
                   (workspace_id, user_id, kind, amount_cents, category, description,
                    occurred_at, due_at, source, status)
                   values (%s,%s,'expense',180000,'moradia','Aluguel',%s,%s,'app','pending')""",
                (ws, uid, inicio_mes, inicio_mes),
            )
            print("  + conta vencida Aluguel")

        cur.execute(
            "select 1 from public.transactions where workspace_id=%s and description=%s",
            (ws, "Energia"),
        )
        if not cur.fetchone():
            vence = hoje + timedelta(days=5)
            cur.execute(
                """insert into public.transactions
                   (workspace_id, user_id, kind, amount_cents, category, description,
                    occurred_at, due_at, source, status)
                   values (%s,%s,'expense',21430,'moradia','Energia',%s,%s,'app','pending')""",
                (ws, uid, vence, vence),
            )
            print("  + conta a vencer Energia")

        # --- orçamentos ---------------------------------------------------------------------
        # Os tetos são calculados sobre o que a base JÁ TEM gasto no mês, senão o orçamento nasce
        # em 0% e as duas telas que dependem dele (a seção "passando do orçamento" da Hoje e o
        # contador do topo) ficam vazias — que é exatamente o que este script existe para evitar.
        cur.execute(
            """select category, sum(amount_cents) from public.transactions
               where workspace_id=%s and kind='expense' and category is not null
                 and occurred_at >= date_trunc('month', current_date)
               group by 1 order by 2 desc limit 3""",
            (ws,),
        )
        # ~93% no maior (estoura o alerta), ~78% no segundo, folgado no terceiro.
        fracoes = (0.93, 0.78, 0.45)
        tetos = [
            (cat, max(1000, int(round(float(total) / fracoes[i] / 1000) * 1000)))
            for i, (cat, total) in enumerate(cur.fetchall())
        ]
        for categoria, teto in tetos:
            cur.execute(
                "select 1 from public.budgets where workspace_id=%s and category=%s and month is null",
                (ws, categoria),
            )
            if cur.fetchone():
                continue
            cur.execute(
                """insert into public.budgets (workspace_id, user_id, category, limit_cents, rollover)
                   values (%s,%s,%s,%s,false)""",
                (ws, uid, categoria, teto),
            )
            print(f"  + orçamento {categoria}")

        # --- metas, com aporte pelo LEDGER (nunca `+=` na coluna) ---------------------------
        def meta(nome: str, alvo: int, guardado: int, prazo: date) -> None:
            cur.execute("select id from public.goals where workspace_id=%s and name=%s", (ws, nome))
            achou = cur.fetchone()
            if achou:
                return
            cur.execute(
                """insert into public.goals (workspace_id, user_id, name, target_cents, deadline)
                   values (%s,%s,%s,%s,%s) returning id""",
                (ws, uid, nome, alvo, prazo),
            )
            gid = cur.fetchone()[0]
            cur.execute(
                """insert into public.goal_contributions
                   (workspace_id, user_id, goal_id, amount_cents, occurred_at, note)
                   values (%s,%s,%s,%s,%s,'aporte inicial')""",
                (ws, uid, gid, guardado, inicio_mes),
            )
            print(f"  + meta {nome}")

        meta("Reserva de emergência", 3000000, 1850000, hoje + timedelta(days=365))
        meta("Troca do notebook", 900000, 240000, hoje + timedelta(days=180))

        # --- dívida: taxa em FRAÇÃO mensal (1,99% a.m. = 0.0199) ----------------------------
        cur.execute("select 1 from public.debts where workspace_id=%s and name=%s", (ws, "Financiamento do carro"))
        if not cur.fetchone():
            cur.execute(
                """insert into public.debts
                   (workspace_id, user_id, name, kind, principal_cents, remaining_cents,
                    interest_rate_monthly, installments, installments_paid, installment_cents,
                    due_day, started_at)
                   values (%s,%s,'Financiamento do carro','loan',4800000,3120000,
                           0.0199,48,18,124500,15,%s)""",
                (ws, uid, inicio_mes - timedelta(days=540)),
            )
            print("  + dívida Financiamento do carro")

        # --- patrimônio: valor entra pelo histórico, não só na coluna -----------------------
        def bem(nome: str, classe: str, valor: int, passivo: bool = False) -> None:
            cur.execute("select id from public.assets where workspace_id=%s and name=%s", (ws, nome))
            if cur.fetchone():
                return
            cur.execute(
                """insert into public.assets
                   (workspace_id, user_id, name, class, is_liability, current_value_cents, acquired_at)
                   values (%s,%s,%s,%s,%s,%s,%s) returning id""",
                (ws, uid, nome, classe, passivo, valor, inicio_mes - timedelta(days=900)),
            )
            aid = cur.fetchone()[0]
            cur.execute(
                """insert into public.asset_valuations (workspace_id, asset_id, value_cents, as_of)
                   values (%s,%s,%s,%s)""",
                (ws, aid, valor, hoje),
            )
            print(f"  + patrimônio {nome}")

        bem("Apartamento", "real_estate", 42000000)
        bem("Carro", "vehicle", 7800000)
        bem("Tesouro Selic", "investment", 2650000)

        # --- recorrentes: RRULE, igual aos lembretes ----------------------------------------
        def recorrente(descricao: str, centavos: int, rrule: str, dia: int, categoria: str) -> None:
            cur.execute(
                "select 1 from public.recurring_transactions where workspace_id=%s and description=%s",
                (ws, descricao),
            )
            if cur.fetchone():
                return
            proxima = datetime.combine(
                inicio_mes.replace(day=min(dia, fim_mes.day)) + timedelta(days=31), datetime.min.time()
            )
            cur.execute(
                """insert into public.recurring_transactions
                   (workspace_id, user_id, kind, amount_cents, category, description,
                    rrule, dtstart, next_run_at, auto_confirm)
                   values (%s,%s,'expense',%s,%s,%s,%s,%s,%s,true)""",
                (ws, uid, centavos, categoria, descricao, rrule, inicio_mes, proxima),
            )
            print(f"  + recorrente {descricao}")

        recorrente("Assinatura de streaming", 5590, "FREQ=MONTHLY;BYMONTHDAY=8", 8, "lazer")
        recorrente("Internet", 12990, "FREQ=MONTHLY;BYMONTHDAY=15", 15, "moradia")

        # --- lembretes de HOJE: sem eles a seção do meio da tela Hoje não existe -------------
        def lembrete(titulo: str, hora: int, minuto: int, canal: str) -> None:
            cur.execute(
                "select 1 from public.reminders where workspace_id=%s and title=%s", (ws, titulo)
            )
            if cur.fetchone():
                return
            quando = datetime.combine(hoje, datetime.min.time()).replace(hour=hora, minute=minuto)
            cur.execute(
                """insert into public.reminders
                   (workspace_id, user_id, title, next_run_at, channel, active, source)
                   values (%s,%s,%s,%s,%s,true,'app')""",
                (ws, uid, titulo, quando, canal),
            )
            print(f"  + lembrete {titulo}")

        lembrete("Ligar para o contador sobre o IRPF", 15, 0, "whatsapp")
        lembrete("Comprar filtro de água", 18, 30, "push")
        lembrete("Renovar o seguro do carro", 9, 0, "whatsapp")

        # --- notas: pasta, fixada, etiqueta ---------------------------------------------------
        def pasta(nome: str, icone: str) -> str:
            cur.execute(
                "select id from public.note_folders where workspace_id=%s and name=%s", (ws, nome)
            )
            achou = cur.fetchone()
            if achou:
                return achou[0]
            cur.execute(
                """insert into public.note_folders (workspace_id, user_id, name, icon)
                   values (%s,%s,%s,%s) returning id""",
                (ws, uid, nome, icone),
            )
            print(f"  + pasta {nome}")
            return cur.fetchone()[0]

        # `note_folders_name_check` exige minúsculas e sem espaço nas pontas.
        f_mercado = pasta("mercado", "cart")
        f_trabalho = pasta("trabalho", "briefcase")

        # `tags` é coluna GERADA (sai das hashtags do conteúdo) — não se escreve nela.
        def nota(conteudo: str, folder: str | None, fixada: bool, origem: str) -> None:
            cur.execute(
                "select 1 from public.notes where workspace_id=%s and content=%s", (ws, conteudo)
            )
            if cur.fetchone():
                return
            cur.execute(
                """insert into public.notes
                   (workspace_id, user_id, content, folder_id, pinned, source)
                   values (%s,%s,%s,%s,%s,%s)""",
                (ws, uid, conteudo, folder, fixada, origem),
            )
            print("  + nota")

        nota(
            "Lista do supermercado & feira\nazeite extravirgem · café em grão · filtro de água",
            f_mercado,
            True,
            "whatsapp",
        )
        nota(
            "Reunião com o contador — levar as notas fiscais de agosto",
            f_trabalho,
            False,
            "whatsapp",
        )
        nota(
            "Ideias para o app\nresumo semanal por áudio no domingo à noite",
            f_trabalho,
            False,
            "app",
        )

        conn.commit()
        print("pronto.")
        _ = poupanca


if __name__ == "__main__":
    main()
