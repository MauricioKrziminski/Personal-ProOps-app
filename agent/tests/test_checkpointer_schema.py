"""O checkpointer TEM que gravar no schema `langgraph`, nunca em `public`.

As tabelas de checkpoint guardam o conteúdo das conversas — valor de gasto, nome
de conta, texto de nota. Em `public`, o PostgREST as serve com a ANON KEY, que é
pública por definição (está dentro do app). A 0040 criou o schema isolado
justamente por isso.

O que quebrou em 31/08/2026: a isolação era feita pelo conninfo
(`options=-csearch_path%3Dlanggraph`), e o pooler do Supabase **ignora esse
parâmetro em silêncio**. Conectava, o search_path continuava `public`, e o
`setup()` criava as três tabelas lá. Confirmado por HTTP 200 em
`/rest/v1/checkpoints` com a chave publishable.
"""

import pytest

from app import db


class _ConexaoFalsa:
    def __init__(self):
        self.comandos: list[str] = []

    async def execute(self, sql, *args):
        self.comandos.append(sql)


@pytest.mark.asyncio
async def test_conexao_do_checkpointer_entra_no_schema_isolado():
    conn = _ConexaoFalsa()
    await db._isolar_checkpointer(conn)
    assert conn.comandos == ["set search_path to langgraph"]


def test_isolacao_nao_depende_do_conninfo():
    """O `options` do conninfo não pode voltar a ser o mecanismo: ele não
    funciona atrás do pooler, e um `Settings.checkpointer_url` reintroduzido
    daria falsa sensação de isolamento."""
    from app.config import Settings

    assert not hasattr(Settings, "checkpointer_url"), (
        "checkpointer_url voltou. O pooler do Supabase ignora "
        "`options=-csearch_path`; a isolação é o `configure` do pool."
    )


def test_pool_do_grafo_e_configurado_para_isolar():
    """Prende a ligação: adiantaria pouco ter a função e não passá-la ao pool."""
    import ast
    import pathlib

    fonte = pathlib.Path(db.__file__).read_text()
    arvore = ast.parse(fonte)
    for no in ast.walk(arvore):
        if (
            isinstance(no, ast.Assign)
            and any(getattr(t, "id", None) == "_graph_pool" for t in no.targets)
            and isinstance(no.value, ast.Call)
        ):
            nomes = {k.arg for k in no.value.keywords}
            assert "configure" in nomes, "o _graph_pool subiu sem `configure`"
            return
    raise AssertionError("não achei a criação do _graph_pool em app/db.py")
