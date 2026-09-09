#!/usr/bin/env python3
"""Checkpoint dos dados: tira uma cópia exata e devolve o banco a ela.

    agent/.venv/bin/python scripts/checkpoint.py backup                 # staging
    agent/.venv/bin/python scripts/checkpoint.py backup --prod
    agent/.venv/bin/python scripts/checkpoint.py restore .checkpoints/<pasta>
    agent/.venv/bin/python scripts/checkpoint.py list

Existe para o Gabriel poder mexer na conta REAL para testar e voltar tudo como estava. O
`restore` é destrutivo por definição: ele apaga o que existe e repõe o que foi salvo.

## Por que COPY e não JSON

`COPY` é o formato do próprio Postgres: numeric não vira float, timestamptz não perde o fuso,
jsonb volta igual, e NULL não se confunde com string vazia. Um dump em JSON precisa de um
conversor por tipo, e é aí que um centavo vira 0.010000000000000002.

## Por que session_replication_role

Restaurar tabela por tabela esbarra em chave estrangeira (`transactions` aponta para `accounts`,
que aponta para `workspaces`) e nos TRIGGERS — `set_invoice` remanejaria a fatura de cada compra,
`sync_debt_payment` recontaria cada parcela, `set_paid_at` reescreveria datas. `replica` desliga
os dois, então o que volta é exatamente o que foi salvo, e não o que os gatilhos achariam.

⚠️ NÃO cobre `auth.users` (login) nem o schema `langgraph` (conversas do agente). O primeiro é
identidade e não dado de produto; o segundo se refaz sozinho.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import psycopg

RAIZ = Path(__file__).resolve().parent.parent
PROD_REF = "kwriuifcwyvdrxtspjiz"
STAGING_REF = "utkqoiigimqzeenxkxdl"


def url_de(env: str) -> str:
    arquivo = RAIZ / "agent" / env
    if not arquivo.exists():
        sys.exit(f"não achei {arquivo}")
    for linha in arquivo.read_text().splitlines():
        if linha.startswith("DATABASE_URL="):
            return re.sub(r"\s+#.*$", "", linha.split("=", 1)[1]).strip().strip('"')
    sys.exit(f"{arquivo} não tem DATABASE_URL")


def alvo(prod: bool) -> tuple[str, str]:
    url = url_de(".env.production" if prod else ".env")
    ref = PROD_REF if prod else STAGING_REF
    if ref not in url:
        sys.exit(f"o DATABASE_URL não aponta para {ref} — abortando por segurança")
    return url, ref


def tabelas(cur) -> list[str]:
    cur.execute("""
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name
    """)
    return [r[0] for r in cur.fetchall()]


def colunas(cur, tabela: str) -> list[str]:
    # Nomeadas de propósito: uma coluna nova numa migration futura não pode fazer o COPY
    # casar valor com a coluna errada em silêncio.
    #
    # ⚠️ Coluna de IDENTIDADE entra. Ela parece derivada e não é: `app_chat_messages.sequence` é
    # `generated always as identity` e ORDENA as mensagens do chat. Excluindo-a, o restore
    # renumerava tudo de 1 — a conversa voltava com a ordem inventada, e sem erro nenhum.
    # `COPY FROM` grava o valor fornecido em coluna de identidade (equivale a
    # `overriding system value`), então basta nomeá-la.
    #
    # Coluna GERADA (`is_generated <> 'NEVER'`) fica fora porque o Postgres a recusa no COPY e
    # ela se recalcula sozinha — é o caso de `notes.search_tsv` e `notes.tags`.
    cur.execute("""
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = %s
          and is_generated = 'NEVER'
        order by ordinal_position
    """, (tabela,))
    return [r[0] for r in cur.fetchall()]


def versao_do_schema(cur) -> str:
    cur.execute("""
        select coalesce(max(version), '(nenhuma)') from supabase_migrations.schema_migrations
    """)
    return cur.fetchone()[0]


def backup(prod: bool, destino: Path | None) -> None:
    url, ref = alvo(prod)
    carimbo = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    pasta = destino or (RAIZ / ".checkpoints" / f"{carimbo}-{'producao' if prod else 'staging'}")
    pasta.mkdir(parents=True, exist_ok=True)

    manifesto: dict = {"ref": ref, "quando": carimbo, "tabelas": {}}
    with psycopg.connect(url, connect_timeout=30) as conn, conn.cursor() as cur:
        conn.execute("set default_transaction_read_only = on")
        manifesto["schema_migration"] = versao_do_schema(cur)
        for t in tabelas(cur):
            cols = colunas(cur, t)
            lista = ", ".join(f'"{c}"' for c in cols)
            linhas = 0
            with gzip.open(pasta / f"{t}.copy.gz", "wb") as saida:
                with cur.copy(f'copy (select {lista} from public."{t}") to stdout') as copia:
                    for bloco in copia:
                        saida.write(bloco)
            cur.execute(f'select count(*) from public."{t}"')
            linhas = cur.fetchone()[0]
            manifesto["tabelas"][t] = {"colunas": cols, "linhas": linhas}
            print(f"  {t}: {linhas}")

    (pasta / "manifesto.json").write_text(json.dumps(manifesto, indent=2, ensure_ascii=False))
    total = sum(v["linhas"] for v in manifesto["tabelas"].values())
    print(f"\ncheckpoint de {ref} ({manifesto['schema_migration']}): "
          f"{len(manifesto['tabelas'])} tabelas, {total} linhas\n{pasta}")


def restore(pasta: Path, prod: bool) -> None:
    manifesto = json.loads((pasta / "manifesto.json").read_text())
    url, ref = alvo(prod)
    if manifesto["ref"] != ref:
        sys.exit(f"este checkpoint é de {manifesto['ref']} e o alvo é {ref} — abortando")
    if prod and os.environ.get("PROOPS_PROD_OK") != "1":
        sys.exit("isto APAGA e repõe os dados de PRODUÇÃO. Repita com PROOPS_PROD_OK=1 na frente.")

    with psycopg.connect(url, connect_timeout=30) as conn:
        with conn.cursor() as cur:
            atual = versao_do_schema(cur)
            if atual != manifesto["schema_migration"]:
                sys.exit(f"o checkpoint é do schema {manifesto['schema_migration']} e o banco está "
                         f"em {atual}. Restaurar assim mistura dado velho com schema novo.")
            nomes = list(manifesto["tabelas"])
            alvos = ", ".join(f'public."{t}"' for t in nomes)
            # `replica` desliga FK e trigger; o truncate único resolve a ordem entre as tabelas.
            cur.execute("set session_replication_role = replica")
            cur.execute(f"truncate table {alvos} cascade")
            for t in nomes:
                info = manifesto["tabelas"][t]
                lista = ", ".join(f'"{c}"' for c in info["colunas"])
                with gzip.open(pasta / f"{t}.copy.gz", "rb") as entrada:
                    with cur.copy(f'copy public."{t}" ({lista}) from stdin') as copia:
                        while bloco := entrada.read(1 << 16):
                            copia.write(bloco)
                print(f"  {t}: {info['linhas']}")
            # Sequência que ficou para trás geraria id repetido no primeiro insert depois do restore.
            cur.execute("""
                select quote_ident(s.relnamespace::regnamespace::text) || '.' || quote_ident(s.relname),
                       quote_ident(t.relname), quote_ident(a.attname)
                from pg_class s
                join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
                join pg_class t on t.oid = d.refobjid
                join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
                where s.relkind = 'S' and t.relnamespace = 'public'::regnamespace
            """)
            for seq, tab, col in cur.fetchall():
                cur.execute(f"select setval('{seq}', coalesce((select max({col}) from public.{tab}), 1))")
            cur.execute("set session_replication_role = origin")
        conn.commit()
    print(f"\n{ref} devolvido ao checkpoint de {manifesto['quando']}")


def listar() -> None:
    raiz = RAIZ / ".checkpoints"
    if not raiz.exists():
        print("nenhum checkpoint ainda"); return
    for p in sorted(raiz.iterdir()):
        m = p / "manifesto.json"
        if m.exists():
            d = json.loads(m.read_text())
            total = sum(v["linhas"] for v in d["tabelas"].values())
            print(f"{p.name}  {d['ref']}  {total} linhas  schema {d['schema_migration']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cmd, prod = args[0], "--prod" in args
    resto = [a for a in args[1:] if not a.startswith("--")]
    if cmd == "backup":
        backup(prod, Path(resto[0]) if resto else None)
    elif cmd == "restore":
        if not resto:
            sys.exit("uso: restore <pasta do checkpoint> [--prod]")
        restore(Path(resto[0]), prod)
    elif cmd == "list":
        listar()
    else:
        sys.exit(__doc__)
