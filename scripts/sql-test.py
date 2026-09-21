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
import uuid

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


def _prefixo_e(sql: str, i: int) -> bool:
    """A aspa simples em `sql[i]` abre uma escape string (`E'...'`)?

    Só backslash DENTRO de `E'...'` escapa. Com `standard_conforming_strings=on` (o padrão do
    Supabase), `'a\\'` FECHA a string comum — tratar barra como escape ali seria o espelho do
    bug: o lexer engoliria um `commit` que o Postgres executa de verdade.
    """
    if i == 0 or sql[i - 1] not in ("E", "e"):
        return False
    if i >= 2 and (sql[i - 2].isalnum() or sql[i - 2] == "_"):
        return False  # o "e" é o fim de outro identificador (ex.: `type'`), não um prefixo
    return True


def instrucoes(sql: str) -> list[str]:
    """Quebra o SQL em instruções de nível superior — ciente de aspas, dollar-quote e comentário.

    Só corta em `;` quando ele está FORA de: string (`'...'`, com `''` como aspa escapada e
    backslash como escape adicional só dentro de `E'...'`), identificador entre aspas duplas
    (`"..."`, com `""` como aspa escapada), dollar-quote (`$$ ... $$` ou `$tag$ ... $tag$`, tag
    casada na abertura e no fechamento) e comentário — de linha (`-- ...`) ou de bloco
    (`/* ... */`, com profundidade: o Postgres aceita `/* /* */ */` aninhado). Devolve cada
    instrução sem os comentários de fora dessas zonas, com espaço aparado, descartando vazias. A
    última instrução pode não ter `;`.

    ⚠️ **Isto NÃO é fronteira de segurança — é só onde `corpo()` tenta cortar.** Já foi lista de
    sinônimos (round 1/2 da Tarefa 0, 20/09/2026) e virou parser; o parser também escapou —
    `select 1 as "x'y", 2; commit; begin; ...` (aspas duplas não existiam aqui), `E'a\\' b'`
    (backslash não tratado) e `1 as x$y$` (`$` é caractere válido de identificador e não abria
    dollar-quote de propósito nenhum: o lexer entrava em dollar-quote por engano, engolindo o
    `commit; begin;` escondido). Escrever um lexer de SQL 100% correto é a MESMA corrida dos
    sinônimos, só mais cara — por isso quem garante que nada escapa não é este parser, é o
    Postgres: `main()` executa cada instrução daqui, uma por vez, com `prepare=True`, e um corte
    ERRADO vira erro do servidor (`cannot insert multiple commands into a prepared statement`),
    não um escape. Os três consertos abaixo (aspas duplas, guarda do dollar-quote, profundidade do
    comentário) reduzem quanto SQL legítimo cai nesse erro chato — não são a trava.

    Dentro de `do $$ ... $$`, nada é examinado: o texto inteiro entre as tags é UMA instrução
    opaca, então `begin`/`end`/`;` internos (inclusive dentro de uma string como
    `raise notice 'a;commit;b'`) nunca viram instruções separadas.
    """
    partes: list[str] = []
    buffer: list[str] = []
    tag_dolar: str | None = None
    dentro_de_string = False
    string_escapada = False
    dentro_de_aspas_duplas = False
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

        if dentro_de_aspas_duplas:
            if ch == '"' and sql[i : i + 2] == '""':
                buffer.append('""')
                i += 2
                continue
            buffer.append(ch)
            i += 1
            if ch == '"':
                dentro_de_aspas_duplas = False
            continue

        if dentro_de_string:
            if string_escapada and ch == "\\" and i + 1 < n:
                buffer.append(ch)
                buffer.append(sql[i + 1])
                i += 2
                continue
            if ch == "'" and sql[i : i + 2] == "''":
                buffer.append("''")
                i += 2
                continue
            buffer.append(ch)
            i += 1
            if ch == "'":
                dentro_de_string = False
            continue

        if ch == '"':
            dentro_de_aspas_duplas = True
            buffer.append(ch)
            i += 1
            continue

        if ch == "'":
            dentro_de_string = True
            string_escapada = _prefixo_e(sql, i)
            buffer.append(ch)
            i += 1
            continue

        if ch == "$":
            anterior = sql[i - 1] if i > 0 else ""
            # ⚠️ `$` é caractere VÁLIDO de identificador em Postgres (depois do primeiro
            # caractere) — `x$y$` é um nome só, não abre dollar-quote. Só tenta abrir quando o
            # caractere anterior não poderia ser parte do mesmo identificador, e a tag (se
            # houver) não começa com dígito — a mesma regra do Postgres para o nome da tag.
            if not re.match(r"[A-Za-z0-9_$]", anterior):
                m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", sql[i:])
                if m:
                    tag_dolar = m.group(1) or ""
                    buffer.append(m.group(0))
                    i += len(m.group(0))
                    continue

        if sql[i : i + 2] == "--":
            fim = sql.find("\n", i)
            i = n if fim == -1 else fim
            continue

        if sql[i : i + 2] == "/*":
            profundidade = 1
            i += 2
            while i < n and profundidade > 0:
                if sql[i : i + 2] == "/*":
                    profundidade += 1
                    i += 2
                elif sql[i : i + 2] == "*/":
                    profundidade -= 1
                    i += 2
                else:
                    i += 1
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


def corpo(arquivo: pathlib.Path) -> list[str]:
    """A LISTA de instruções que `main()` vai executar, uma por vez com `prepare=True`.

    Um `begin` exato (a instrução inteira, normalizada) ABRE o boilerplate do próprio arquivo — é
    removido, nunca enviado ao Postgres, igual sempre foi. Enquanto estiver aberto, um
    `commit`/`rollback` exato FECHA — também removido. Fora dessas duas transições (um
    `begin` enquanto JÁ está aberto, ou um `commit`/`rollback` enquanto NÃO está aberto), a mesma
    palavra é RECUSA — nunca filtro silencioso.

    ⚠️ **Por que par ABERTO/FECHADO, e não "só a PRIMEIRA instrução pode ser begin, só a ÚLTIMA
    pode ser commit/rollback"** (a régua mais simples, testada e devolvida): dois arquivos REAIS
    do repo quebram com ela. `import_near_match.sql` tem DOIS blocos `begin;...rollback;`
    sequenciais no mesmo arquivo (um por cenário, para não vazar dado de um teste para o outro) —
    o segundo `begin;` não é a primeira instrução, seria recusado. `agent_migrations.sql` tem um
    `rollback;` no MEIO (fecha uma seção "0040/0041 verificadas" antiga; seções novas foram
    acrescentadas depois, sem mover o fechamento) — não é a última instrução, o `begin;` de
    abertura seria recusado por não ter par ao final. Isso não é inseguro de relaxar: uma
    instrução classificada como boilerplate é DESCARTADA, nunca chega a rodar como SQL de
    verdade contra o Postgres — não existe um COMMIT real "a mais" só porque o par apareceu de
    novo no meio do arquivo. O que teria que continuar impossível — e continua — é `commit`/
    `rollback`/`begin` aparecerem FORA de uma transição de par válida (a régua que pega
    `select 1; commit;`: nunca existiu um `begin` aberto antes daquele `commit`).
    """
    linhas: list[str] = []
    for linha in arquivo.read_text().splitlines():
        nua = linha.strip()
        if nua.startswith("\\"):
            continue
        linhas.append(linha)
    texto = "\n".join(linhas)

    todas = instrucoes(texto)
    total = len(todas)
    aceitas: list[str] = []
    aberto = False
    for indice, instrucao in enumerate(todas):
        normalizada = re.sub(r"\s+", " ", instrucao.strip().lower())
        if not aberto and normalizada == "begin":
            aberto = True
            continue
        if aberto and normalizada in ("commit", "rollback"):
            aberto = False
            continue
        if _encerra_transacao(normalizada):
            trecho = instrucao.strip()[:60]
            raise SystemExit(
                f"recusado: {arquivo.name}, instrução {indice + 1}/{total} controla a "
                f"transação fora do padrão («{trecho}»). Quem abre e desfaz é o runner — ver "
                f"o cabeçalho."
            )
        aceitas.append(instrucao)
    return aceitas


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    arquivo = (RAIZ / sys.argv[1]).resolve()
    if not arquivo.is_file():
        raise SystemExit(f"não achei {arquivo}")

    # Pode recusar (SystemExit) sem ter tocado o banco — o lexer ainda decide onde cortar.
    aceitas = corpo(arquivo)
    total = len(aceitas)

    avisos: list[str] = []
    # ⚠️ SEM `with` na conexão, de propósito — ver o ⚠️ do cabeçalho.
    conexao = psycopg.connect(url(), connect_timeout=20, autocommit=False)
    conexao.add_notice_handler(lambda aviso: avisos.append(aviso.message_primary))
    marca = uuid.uuid4().hex
    falhou: str | None = None
    encerrou_sozinha = False
    indice_atual = 0
    try:
        with conexao.cursor() as cursor:
            cursor.execute("set local timezone to 'America/Sao_Paulo'")
            # ⚠️ Camada 2 (revisão da Tarefa 0, round 3): um marcador ALEATÓRIO por execução,
            # gravado com `SET LOCAL`. Qualquer COMMIT descarta um `SET LOCAL` — inclusive um
            # `begin` escondido logo em seguida, que abriria uma transação NOVA sem o marcador.
            # Sorteado a cada execução: com valor fixo, um arquivo malicioso forjaria o
            # `set_config` depois do commit escondido e a comparação passaria calada.
            cursor.execute("select set_config('sql_test.marca', %s, true)", (marca,))
            for indice_atual, instrucao in enumerate(aceitas, 1):
                # ⚠️ Camada 1: cada instrução roda SOZINHA, com `prepare=True` (protocolo
                # estendido). O revisor MEDIU: o servidor recusa mais de um comando por Parse
                # (`cannot insert multiple commands into a prepared statement`) — um corte
                # ERRADO do lexer (`instrucoes()` continua decidindo onde cortar) deixa de ser
                # um escape e vira um erro do servidor, nunca SQL rodando sem passar pela
                # checagem de `_encerra_transacao`.
                cursor.execute(instrucao, prepare=True)
            cursor.execute("select current_setting('sql_test.marca', true)")
            valor = (cursor.fetchone() or [None])[0]
            # ⚠️ `!= marca`, nunca `is None`: `current_setting(..., true)` devolve `''` (vazio),
            # não `null`, quando a config não existe mais.
            if valor != marca:
                encerrou_sozinha = True
            # Camada 3 (round 2, mantida): independente das outras duas. Com `autocommit=False`
            # a transação TEM que continuar `INTRANS`; se virou `IDLE`, algo a encerrou por
            # fora — não importa como foi escrito. `INERROR` (uma exceção foi levantada) já cai
            # no `FALHOU` de baixo, não se confunde com este caminho.
            elif conexao.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
                encerrou_sozinha = True
    except Exception as erro:  # noqa: BLE001 — qualquer falha é falha do teste
        if indice_atual:
            trecho = aceitas[indice_atual - 1].strip()[:60]
            falhou = (
                f"instrução {indice_atual}/{total} («{trecho}»): "
                f"{type(erro).__name__}: {erro}"
            )
        else:
            falhou = f"{type(erro).__name__}: {erro}"
    finally:
        # Nesta ordem, e em QUALQUER saída: é o que garante que nada ficou gravado (quando ainda
        # havia o que desfazer — as três camadas acima existem para o caso em que já era tarde).
        conexao.rollback()
        conexao.close()

    print("\n".join(avisos))
    if encerrou_sozinha:
        print(
            f"FALHOU: {arquivo.name} encerrou a transação por conta própria — o que veio antes "
            f"PODE TER SIDO GRAVADO no staging. Confira à mão."
        )
        sys.exit(1)
    if falhou:
        print(f"FALHOU: {arquivo.name}\n  {falhou}")
        sys.exit(1)
    print(f"PASSOU: {arquivo.name}")


main()
