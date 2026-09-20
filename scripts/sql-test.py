#!/usr/bin/env python3
"""Roda um `supabase/tests/*.sql` contra o STAGING dentro de uma transação que SEMPRE volta.

    agent/.venv/bin/python scripts/sql-test.py supabase/tests/roll_invoice.sql

## Por que isto existe

O caminho documentado (`docs/AMBIENTES.md`) é `docker exec -i supabase_db_app-proops psql …`, e
ele depende do Supabase local de pé. Quando não está, os testes SQL simplesmente não rodam — que é
como uma migration de dinheiro vai para o staging sem nenhuma prova.

## Por que é seguro apontar para o staging

O controle de transação sai de DENTRO do arquivo e vem para cá: `begin;`/`commit;`/`rollback;` são
removidos do texto e a conexão abre com `autocommit=False`, com `rollback()` + `close()` num
`finally`. Não existe caminho de saída que grave — nem sucesso, nem exceção, nem `sys.exit`.

⚠️ **`with psycopg.connect(...)` COMMITA na saída limpa, e isso não é teoria.** Medido em
20/09/2026 contra o staging: um `insert` dentro de `with psycopg.connect(u, autocommit=False) as
con:` sem `rollback` **ficou gravado**. É por isso que este runner **não usa a conexão como
context manager** — ele abre, e fecha num `finally` com `rollback()` antes do `close()`. Com o
context manager, bastaria alguém mover o `rollback` para fora do bloco (ou um `return` novo passar
por cima) para o teste passar a gravar no banco em silêncio. A trava não pode depender de onde uma
linha está escrita.

⚠️ **Só staging, e a asserção é no REF.** Nome de projeto não basta: são dois projetos com nome
parecido e a confusão já custou duas migrations anunciadas no lugar errado.

⚠️ **Teste que chama função GLOBAL não roda aqui.** `income_pending.sql` chama
`_promote_due_transactions()`, que promove o banco inteiro e devolve a contagem total; com dado
pré-existente a asserção nunca fecha. Esse precisa de banco vazio (Docker local). Não é defeito do
teste nem do código.

⚠️ **O fuso é fixado em `America/Sao_Paulo`**, como `scoped_transaction_edit.sql` faz na primeira
linha: desde a `20260911030000` as funções de finanças avaliam `current_date` em BRT enquanto a
sessão fica em UTC, e entre 21h e a meia-noite um teste que compara com o `current_date` da SESSÃO
falha por um dia sem nada estar errado.
"""
from __future__ import annotations

import pathlib
import re
import sys

import psycopg

RAIZ = pathlib.Path(__file__).resolve().parent.parent
STAGING_REF = "utkqoiigimqzeenxkxdl"


def url() -> str:
    """O DATABASE_URL do staging — `agent/.env` é o ambiente descartável (ver `agent.md`)."""
    arquivo = RAIZ / "agent/.env"
    for linha in arquivo.read_text().splitlines():
        if linha.startswith("DATABASE_URL="):
            valor = linha.split("=", 1)[1].strip().strip('"')
            if STAGING_REF not in valor:
                raise SystemExit(f"recusado: {arquivo} não aponta para o staging ({STAGING_REF})")
            return valor
    raise SystemExit(f"sem DATABASE_URL em {arquivo}")


def corpo(arquivo: pathlib.Path) -> str:
    """O SQL sem as diretivas do psql e sem o controle de transação do próprio arquivo.

    ⚠️ **Controle de transação fora do padrão é RECUSA, nunca filtro silencioso.** Tirar só a
    linha que casa exatamente `begin;`/`commit;`/`rollback;` deixa passar `COMMIT ;`,
    `commit; -- fecha` e qualquer variação — e um `commit` que passa GRAVA no staging, onde o
    rollback de fora não alcança mais. Conferido em 20/09/2026: nenhum dos 28 arquivos de
    `supabase/tests/` tem `commit;` hoje. É por isso mesmo que a trava entra agora, antes de o
    primeiro aparecer.

    O `begin`/`end` SEM ponto-e-vírgula dos blocos plpgsql não é controle de transação e passa
    intacto — o que se procura é a linha inteira.
    """
    fora = {"begin;", "commit;", "rollback;"}
    limpas: list[str] = []
    for numero, linha in enumerate(arquivo.read_text().splitlines(), 1):
        nua = linha.strip()
        if nua.startswith("\\"):
            continue
        if nua.lower() in fora:
            continue
        if re.match(r"^(begin|commit|rollback|end)\s+transaction\b", nua, re.I) or re.match(
            r"^(commit|rollback)\s*;\s*(--.*)?$", nua, re.I
        ):
            raise SystemExit(
                f"recusado: {arquivo.name}:{numero} controla a transação fora do padrão "
                f"(«{nua}»). Quem abre e desfaz é o runner — ver o cabeçalho."
            )
        limpas.append(linha)
    return "\n".join(limpas)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    arquivo = (RAIZ / sys.argv[1]).resolve()
    if not arquivo.is_file():
        raise SystemExit(f"não achei {arquivo}")

    avisos: list[str] = []
    # ⚠️ SEM `with` na conexão, de propósito — ver o ⚠️ do cabeçalho.
    conexao = psycopg.connect(url(), connect_timeout=20, autocommit=False)
    conexao.add_notice_handler(lambda aviso: avisos.append(aviso.message_primary))
    falhou: str | None = None
    try:
        with conexao.cursor() as cursor:
            cursor.execute("set local timezone to 'America/Sao_Paulo'")
            cursor.execute(corpo(arquivo))
    except Exception as erro:  # noqa: BLE001 — qualquer falha é falha do teste
        falhou = f"{type(erro).__name__}: {erro}"
    finally:
        # Nesta ordem, e em QUALQUER saída: é o que garante que nada ficou gravado.
        conexao.rollback()
        conexao.close()

    print("\n".join(avisos))
    if falhou:
        print(f"FALHOU: {arquivo.name}\n  {falhou}")
        sys.exit(1)
    print(f"PASSOU: {arquivo.name}")


main()
