#!/usr/bin/env python3
"""Copia o workspace de PRODUÇÃO para o STAGING, sob um usuário novo do staging.

    agent/.venv/bin/python scripts/clone-prod-para-staging.py <email> <senha>

Existe para o Gabriel testar com os dados REAIS dele sem abrir produção. Produção é lida em
transação read-only; o alvo é o staging e o ref é conferido antes de qualquer escrita — o hook
`PreToolUse` só enxerga o CLI do supabase, e isto aqui escreve por psycopg.

## O que copia e o que não copia

Copia o DADO DO PRODUTO (workspace, contas, lançamentos, faturas, parcelas, dívidas,
recorrentes, orçamentos, metas, notas, lembretes, patrimônio, assinatura).

NÃO copia a infra do agente (`messages_queue`, `user_sessions`, `pending_actions`,
`executed_actions`, `ai_events`, `agent_routing`, `jobs`, `messages_raw`, `app_chat_messages`):
essas tabelas são chaveadas por telefone/thread e por `ai_events` passa a contagem do paywall —
levar conversa de produção para o staging confunde as duas coisas sem devolver nada.

## Por que os UUIDs de produção ficam

Só o `user_id` é trocado (o do staging é outro porque `auth.users` é outro banco). Workspace,
conta e transação mantêm o id de produção: não há colisão no staging e toda FK continua
apontando para o lugar certo sem tabela de tradução. A troca é um replace de 36 bytes no fluxo
do COPY — UUID não aparece por acidente.

## Por que session_replication_role = replica

Mesmo motivo do `checkpoint.py`: `set_invoice` remanejaria a fatura de cada compra e
`sync_debt_payment` recontaria cada parcela. `replica` desliga trigger e FK, então o que chega é
o que foi lido. ⚠️ Ele desligar a FK NÃO torna o remap opcional — sem o remap a linha entra e
fica pendurada num usuário que não existe.
"""
from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from checkpoint import PROD_REF, STAGING_REF, alvo, colunas  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent

# Ordem só documenta a dependência; com `replica` ligada ela não é obrigatória.
TABELAS = [
    "workspaces", "workspace_members", "accounts", "card_invoices", "installment_plans",
    "debts", "recurring_transactions", "transactions", "budgets", "goals",
    "goal_contributions", "note_folders", "notes", "reminders", "categorization_rules",
    "assets", "asset_valuations", "net_worth_snapshots", "subscriptions",
    "import_batches", "import_items", "draft_actions", "alerts_sent",
]


def env_local(chave: str) -> str:
    for linha in (RAIZ / ".env.local").read_text().splitlines():
        if linha.startswith(f"{chave}="):
            return re.sub(r"\s+#.*$", "", linha.split("=", 1)[1]).strip().strip('"')
    sys.exit(f".env.local não tem {chave}")


def criar_usuario(email: str, senha: str, cur) -> str:
    """Devolve o usuário do Auth do staging, criando-o só se ainda não existir.

    O signup é o endpoint público (anon key) de propósito: o `service_role` saiu do repositório
    junto com as Edge Functions e não vai voltar por causa de um script de teste.

    ⚠️ **A consulta antes do signup é o que torna o script re-executável.** O GoTrue recusa
    e-mail repetido com 422, e quando a confirmação está ligada ele responde 200 com um usuário
    ofuscado, sem id utilizável — dos dois jeitos a segunda execução morria antes de repor o
    clone.
    """
    cur.execute("select id from auth.users where email = %s", (email,))
    if achado := cur.fetchone():
        return str(achado[0])
    url, anon = env_local("EXPO_PUBLIC_SUPABASE_URL"), env_local("EXPO_PUBLIC_SUPABASE_ANON_KEY")
    if STAGING_REF not in url:
        sys.exit(f"EXPO_PUBLIC_SUPABASE_URL não aponta para {STAGING_REF} — abortando")
    req = urllib.request.Request(
        f"{url}/auth/v1/signup",
        data=json.dumps({"email": email, "password": senha,
                         "data": {"display_name": "Gabriel"}}).encode(),
        headers={"apikey": anon, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            corpo = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"signup falhou: {e.code} {e.read().decode()[:300]}")
    uid = (corpo.get("user") or corpo).get("id")
    if not uid:
        sys.exit(f"signup não devolveu id: {corpo}")
    return uid


def main(email: str, senha: str) -> None:
    url_prod, _ = alvo(prod=True)
    url_stg, _ = alvo(prod=False)

    with psycopg.connect(url_prod, connect_timeout=30) as p, p.cursor() as cp:
        cp.execute("set default_transaction_read_only = on")
        cp.execute("select id, owner_id from workspaces")
        linhas = cp.fetchall()
        if len(linhas) != 1:
            sys.exit(f"produção tem {len(linhas)} workspaces — este script assume um só")
        ws, uid_prod = linhas[0]
        print(f"produção {PROD_REF}: workspace {ws}, usuário {uid_prod}")

        # Lê tudo ANTES de escrever: se a leitura falhar, o staging não foi tocado.
        dados: dict[str, tuple[list[str], bytes]] = {}
        for t in TABELAS:
            cols = colunas(cp, t)
            filtro = "id" if t == "workspaces" else "workspace_id"
            lista = ", ".join(f'"{c}"' for c in cols)
            buf = io.BytesIO()
            with cp.copy(f'copy (select {lista} from public."{t}" where {filtro} = %s) to stdout',
                         (ws,)) as copia:
                for bloco in copia:
                    buf.write(bloco)
            dados[t] = (cols, buf.getvalue())

    with psycopg.connect(url_stg, connect_timeout=30) as s:
        with s.cursor() as cs:
            uid_stg = criar_usuario(email, senha, cs)
            print(f"staging {STAGING_REF}: usuário {uid_stg} ({email})")
            cs.execute("update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) "
                       "where id = %s", (uid_stg,))

            # ⚠️ Os DELETEs vêm ANTES de `replica`, e a ordem é o bug que eles já causaram:
            # `replica` desliga TODO trigger de FK, inclusive o `on delete cascade`. Apagando o
            # workspace vazio com ela ligada, o `workspace_members` e o `subscriptions` dele
            # ficavam pendurados num workspace que não existe mais — e `my_workspace_ids()`
            # devolvia os dois.
            #
            # O trigger de signup cria um workspace 'Pessoal' vazio; ele sai para o usuário não
            # abrir o app num workspace que não é o clonado. O segundo delete é a re-execução,
            # que limpa o clone anterior antes de repor.
            cs.execute("delete from workspaces where owner_id = %s and id <> %s", (uid_stg, ws))
            cs.execute("delete from workspaces where id = %s", (ws,))

            de, para = str(uid_prod).encode(), uid_stg.encode()
            cs.execute("set session_replication_role = replica")
            for t in TABELAS:
                cols, bruto = dados[t]
                corpo = bruto.replace(de, para)
                lista = ", ".join(f'"{c}"' for c in cols)
                with cs.copy(f'copy public."{t}" ({lista}) from stdin') as copia:
                    copia.write(corpo)
                print(f"  {t}: {corpo.count(b'\n') if corpo else 0}")
            # Sequência atrasada geraria id repetido no primeiro insert depois do clone.
            cs.execute("""
                select quote_ident(s.relnamespace::regnamespace::text)||'.'||quote_ident(s.relname),
                       quote_ident(t.relname), quote_ident(a.attname)
                from pg_class s
                join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
                join pg_class t on t.oid = d.refobjid
                join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
                where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace
            """)
            for seq, tab, col in cs.fetchall():
                cs.execute(f"select setval('{seq}', coalesce((select max({col}) from public.{tab}), 1))")
            cs.execute("set session_replication_role = origin")
        s.commit()
    print(f"\npronto — entre no app do staging com {email}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
