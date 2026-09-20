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


def instrucoes(sql: str) -> list[str]:
    """Quebra o SQL em instruções de nível superior — ciente de aspas, dollar-quote e comentário.

    Só corta em `;` quando ele está FORA de string (`'...'`, com `''` como aspa escapada),
    dollar-quote (`$$ ... $$` ou `$tag$ ... $tag$`, a tag tem que casar na abertura e no
    fechamento), comentário de linha (`-- ...`) e comentário de bloco (`/* ... */`). Devolve cada
    instrução sem os comentários de fora dessas zonas, com espaço aparado nas pontas, descartando
    as vazias. A última instrução pode não ter `;`.

    ⚠️ **Isto existe porque uma LISTA DE SINÔNIMOS falhou duas vezes seguidas** (revisão da
    Tarefa 0, 20/09/2026): a primeira rodada cobria `commit`/`rollback` sozinhos e escapou por
    `commit work` e `abort` (sinônimos válidos de COMMIT/ROLLBACK que a lista não conhecia) e por
    `commit -- fecha` como última linha sem `;` (o segmento não batia com o texto exato). A
    terceira lentidão seria `end work` ou `prepare transaction` — sempre mais um sinônimo que
    ninguém lembrou. Um PARSER que separa instruções de verdade não depende de conhecer o nome de
    cada comando: quem decide se algo é "controle de transação" é `_encerra_transacao`, pela
    PRIMEIRA PALAVRA da instrução — aqui só a separação precisa estar certa.

    Dentro de `do $$ ... $$`, nada é examinado: o texto inteiro entre as tags é UMA instrução
    opaca, então `begin`/`end`/`;` internos (inclusive dentro de uma string como
    `raise notice 'a;commit;b'`) nunca viram instruções separadas. É isso que torna a regra certa
    sem precisar abrir exceção para `begin`/`end` soltos — eles só aparecem aqui como instrução de
    nível superior quando SÃO de nível superior de verdade.
    """
    partes: list[str] = []
    buffer: list[str] = []
    tag_dolar: str | None = None
    dentro_de_string = False
    i, n = 0, len(sql)

    def fechar() -> None:
        texto = "".join(buffer).strip()
        if texto:
            partes.append(texto)
        buffer.clear()

    while i < n:
        ch = sql[i]

        if tag_dolar is not None:
            fechador = f"${tag_dolar}$"
            if sql.startswith(fechador, i):
                buffer.append(fechador)
                i += len(fechador)
                tag_dolar = None
            else:
                buffer.append(ch)
                i += 1
            continue

        if dentro_de_string:
            if ch == "'" and sql[i : i + 2] == "''":
                buffer.append("''")
                i += 2
                continue
            buffer.append(ch)
            i += 1
            if ch == "'":
                dentro_de_string = False
            continue

        if ch == "'":
            dentro_de_string = True
            buffer.append(ch)
            i += 1
            continue

        m = re.match(r"\$([A-Za-z0-9_]*)\$", sql[i:])
        if m:
            tag_dolar = m.group(1)
            buffer.append(m.group(0))
            i += len(m.group(0))
            continue

        if sql[i : i + 2] == "--":
            fim = sql.find("\n", i)
            i = n if fim == -1 else fim
            continue

        if sql[i : i + 2] == "/*":
            fim = sql.find("*/", i + 2)
            i = n if fim == -1 else fim + 2
            continue

        if ch == ";":
            fechar()
            i += 1
            continue

        buffer.append(ch)
        i += 1

    fechar()
    return partes


_PALAVRAS_QUE_ENCERRAM = {"commit", "end", "abort", "rollback", "begin"}
_FRASES_QUE_ENCERRAM = {"start transaction", "prepare transaction"}


def _encerra_transacao(normalizada: str) -> bool:
    """A instrução (já em minúsculo, espaços colapsados) controla a transação por fora daqui?

    Decide pela PRIMEIRA PALAVRA, contra a lista finita do Postgres — `commit` cobre sozinho
    `commit work`/`commit transaction`/`commit and chain`/`commit prepared` sem precisar listar
    cada um. `rollback to savepoint x` é a única exceção dentro de `rollback`: ele NÃO encerra a
    transação, move um savepoint.
    """
    palavras = normalizada.split(" ")
    primeira = palavras[0] if palavras else ""
    if primeira == "rollback" and normalizada.startswith("rollback to"):
        return False
    if primeira in _PALAVRAS_QUE_ENCERRAM:
        return True
    return " ".join(palavras[:2]) in _FRASES_QUE_ENCERRAM


def corpo(arquivo: pathlib.Path) -> str:
    """O SQL sem as diretivas do psql, sem o controle de transação do próprio arquivo — e sem
    NENHUMA outra instrução de nível superior que controle a transação por fora do runner.

    O `begin;`/`commit;`/`rollback;` do cabeçalho/rodapé do arquivo, sozinhos na LINHA (o padrão
    de todo teste do repo), são removidos aqui — igual sempre foi. Tudo mais passa por
    `instrucoes()` e por `_encerra_transacao`: qualquer instrução de nível superior que comece
    com um verbo que encerra transação é RECUSA, nunca filtro silencioso — inclusive quando ela
    compartilha linha com outra instrução (`select 1; commit;`), usa sinônimo (`commit work`,
    `abort`) ou não tem `;` porque a linha acabou num comentário (`commit -- fecha`).
    """
    fora = {"begin;", "commit;", "rollback;"}
    linhas: list[str] = []
    for linha in arquivo.read_text().splitlines():
        nua = linha.strip()
        if nua.startswith("\\"):
            continue
        if nua.lower() in fora:
            continue
        linhas.append(linha)
    texto = "\n".join(linhas)

    aceitas: list[str] = []
    for instrucao in instrucoes(texto):
        normalizada = re.sub(r"\s+", " ", instrucao.strip().lower())
        if _encerra_transacao(normalizada):
            raise SystemExit(
                f"recusado: {arquivo.name} controla a transação fora do padrão "
                f"(«{instrucao.strip()}»). Quem abre e desfaz é o runner — ver o cabeçalho."
            )
        aceitas.append(instrucao)
    return "\n".join(f"{i};" for i in aceitas)


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
    encerrou_sozinha = False
    try:
        with conexao.cursor() as cursor:
            cursor.execute("set local timezone to 'America/Sao_Paulo'")
            cursor.execute(corpo(arquivo))
        # ⚠️ Defesa em profundidade, independente do parser (revisão da Tarefa 0, 20/09/2026):
        # `instrucoes()` + `_encerra_transacao` são o que TEMOS, não o que o Postgres aceita — já
        # foi lista de duas palavras, depois de cinco, e a próxima rodada seria a sexta. Isto não
        # depende de o parser ter acertado a sintaxe certa: com `autocommit=False`, a transação
        # TEM que continuar aberta (`INTRANS`) depois de qualquer SQL que rodou sem erro. Se ela
        # virou `IDLE`, alguma coisa a encerrou por fora daqui — não importa como foi escrita —,
        # e o que veio antes já pode estar gravado (`conexao.rollback()` do `finally` não desfaz
        # um commit que já aconteceu). `INERROR` é outro caminho (uma exceção foi levantada) e já
        # cai no `FALHOU` de baixo — não confundir os dois.
        if conexao.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
            encerrou_sozinha = True
    except Exception as erro:  # noqa: BLE001 — qualquer falha é falha do teste
        falhou = f"{type(erro).__name__}: {erro}"
    finally:
        # Nesta ordem, e em QUALQUER saída: é o que garante que nada ficou gravado (quando ainda
        # havia o que desfazer — ver o ⚠️ acima para o caso em que já era tarde).
        conexao.rollback()
        conexao.close()

    print("\n".join(avisos))
    if encerrou_sozinha:
        print(
            f"FALHOU: {arquivo.name} encerrou a transação por conta própria — o que veio antes "
            f"do fim PODE TER SIDO GRAVADO no staging. Confira à mão."
        )
        sys.exit(1)
    if falhou:
        print(f"FALHOU: {arquivo.name}\n  {falhou}")
        sys.exit(1)
    print(f"PASSOU: {arquivo.name}")


main()
