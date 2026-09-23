"""'Crie a pasta X e ponha a nota Y': uma pasta, uma nota, dentro dela, sem erro.

Incidente de 23/09/2026 (produção, `ai_events` 04:43:58 e 04:47:38 UTC): o roteador devolveu
`["cadastros", "notas"]` — certo, a frase tem uma pasta e uma nota — e os DOIS extratores
pegaram a frase inteira. Notas criou a nota (e a pasta, por `ensure_folder`); cadastros criou
a pasta DE NOVO e a nota DE NOVO. Resultado: confirmação com a nota duas vezes, "❌ Deu erro ao
processar uma parte" (unique da pasta) e uma segunda nota sem pasta.

O grafo roda de verdade (router, domínios, alvos, gate, executar); só o modelo e o banco são
dublês. O banco de mentira tem o unique `(workspace_id, name)` de `note_folders` — é ele que
fazia o erro aparecer.
"""

import re

import pytest

from app.graph.schemas import (
    NotesAction,
    NotesActionType,
    NotesPlan,
    ResourceAction,
    ResourceField,
    ResourcePlan,
)


class Banco:
    """O mínimo de Postgres que o caminho de nota e pasta toca."""

    def __init__(self, pastas=()):
        self.pastas: dict[str, str] = {nome: f"pasta-{nome}" for nome in pastas}
        self.notas: list[dict] = []
        self.ordem: list[str] = []

    async def fetch(self, sql, *args):
        if "from public.note_folders" in sql and "where workspace_id = %s and name = %s" in sql:
            nome = args[1]
            return [{"id": self.pastas[nome], "name": nome, "row_version": "1"}] if nome in self.pastas else []
        if "from public.note_folders" in sql and "(id::text = %s or name = %s)" in sql:
            nome = args[2]
            return [{"id": self.pastas[nome], "name": nome}] if nome in self.pastas else []
        if "select name from public.note_folders" in sql:
            return [{"name": n} for n in self.pastas]
        return []

    async def fetch_one(self, sql, *args):
        if "insert into public.note_folders" in sql:
            colunas = re.search(r"note_folders \(([^)]*)\)", sql).group(1).split(", ")
            nome = args[colunas.index("name")]
            if nome in self.pastas:
                if "on conflict" in sql and "do update" in sql:
                    return {"id": self.pastas[nome], "name": nome}
                if "on conflict" in sql:
                    return None
                raise RuntimeError(
                    'duplicate key value violates unique constraint "note_folders_workspace_id_name_key"'
                )
            self.pastas[nome] = f"pasta-{nome}"
            self.ordem.append(f"pasta:{nome}")
            return {"id": self.pastas[nome], "name": nome}
        if "insert into public.notes" in sql:
            colunas = re.search(r"notes\s*\(([^)]*)\)", sql).group(1).replace("\n", " ").split(",")
            colunas = [c.strip() for c in colunas]
            nota = dict(zip(colunas, args))
            self.notas.append(nota)
            self.ordem.append(f"nota:{nota.get('content')}")
            return {"id": f"nota-{len(self.notas)}"}
        return None


def _plano_dos_dois(notas: list[NotesAction], cadastros: list[ResourceAction]):
    """`gemini.structured(schema, modelo)`: cada extrator recebe o SEU plano."""

    def structured(schema, *_a, **_k):
        class Modelo:
            async def ainvoke(self, _mensagens):
                if schema is NotesPlan:
                    return NotesPlan(actions=notas)
                if schema is ResourcePlan:
                    return ResourcePlan(actions=cadastros)
                raise AssertionError(f"schema inesperado: {schema}")

        return Modelo()

    return structured


def _pasta(nome):
    return ResourceAction(type="resource_create", resource="folders", name=nome, fields=[])


def _nota_cadastro(conteudo, pasta=None):
    campos = [ResourceField(name="content", value=conteudo)]
    if pasta:
        campos.append(ResourceField(name="folder_id", value=pasta))
    return ResourceAction(type="resource_create", resource="notes", name=conteudo, fields=campos)


def _nota(conteudo, pasta):
    return NotesAction(type=NotesActionType.CREATE_NOTE, content=conteudo, folder=pasta)


async def _rodar(monkeypatch, dominios, notas, cadastros, banco, texto):
    from importlib import reload

    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    from app.graph import build as graph_module
    from app.graph import nodes
    from app.tools import registry

    async def route(_state):
        return {"domains": dominios, "confidence": 1.0, "llm_calls": 1}

    async def sim(*_a, **_k):
        return True

    async def nada(*_a, **_k):
        return None

    monkeypatch.setattr(nodes, "route", route)
    monkeypatch.setattr(nodes.gemini, "structured", _plano_dos_dois(notas, cadastros))
    monkeypatch.setattr(registry.db, "fetch", banco.fetch)
    monkeypatch.setattr(registry.db, "fetch_one", banco.fetch_one)
    monkeypatch.setattr(registry.db, "reserve_execution", sim)
    monkeypatch.setattr(registry.db, "confirm_execution", nada)
    monkeypatch.setattr(registry.db, "release_execution", nada)
    reload(graph_module)
    grafo = graph_module.build(InMemorySaver())
    config = {"configurable": {"thread_id": "nota-e-pasta"}}
    primeiro = await grafo.ainvoke(
        {
            "workspace_id": "w1", "user_id": "u1", "phone": None,
            "timezone": "America/Sao_Paulo", "text": texto,
            "source_message_id": "wamid.nota", "results": [], "messages": [],
        },
        config,
    )
    pergunta = primeiro["__interrupt__"][0].value
    final = await grafo.ainvoke(Command(resume=True), config)
    return primeiro, pergunta, final


TEXTO_APP = 'crie uma pasta em notas chamada "App" e dentro coloque uma nota falando "X"'


@pytest.mark.asyncio
async def test_pasta_e_nota_com_os_dois_dominios_nao_duplicam_nem_dao_erro(monkeypatch):
    banco = Banco()
    primeiro, pergunta, final = await _rodar(
        monkeypatch,
        ["cadastros", "notas"],
        [_nota("Não consegui editar o valor", "app")],
        [_pasta("App"), _nota_cadastro("Não consegui editar o valor")],
        banco,
        TEXTO_APP,
    )

    # A pergunta cita a nota UMA vez
    assert pergunta["summary"].count("Não consegui editar o valor") == 1, pergunta["summary"]
    # Uma pasta, uma nota, e a nota DENTRO da pasta
    assert list(banco.pastas) == ["app"]
    assert len(banco.notas) == 1, banco.notas
    assert banco.notas[0]["folder_id"] == "pasta-app"
    assert "Deu erro" not in final["reply"], final["reply"]
    # nada de "cadastro incompleto" pendurado para envenenar o próximo turno
    assert not final.get("resource_draft")


@pytest.mark.asyncio
async def test_portfolio_duas_notas_na_pasta_nova(monkeypatch):
    banco = Banco()
    _, pergunta, final = await _rodar(
        monkeypatch,
        ["cadastros", "notas"],
        [_nota("Remover o card Ola Mundo", "portfólio"),
         _nota("aumentar tamanho dos cards", "portfólio")],
        [_pasta("Portfólio"),
         _nota_cadastro("Remover o card Ola Mundo", "portfólio"),
         _nota_cadastro("aumentar tamanho dos cards", "portfólio")],
        banco,
        "Crie uma nova pasta chamada Portfólio e adicione duas notas",
    )

    assert list(banco.pastas) == ["portfólio"]
    assert [n["folder_id"] for n in banco.notas] == ["pasta-portfólio", "pasta-portfólio"]
    assert "Não encontrei pasta" not in final["reply"], final["reply"]
    assert "Deu erro" not in final["reply"], final["reply"]
    # a pasta nasce ANTES das notas que moram nela
    assert banco.ordem[0] == "pasta:portfólio", banco.ordem


@pytest.mark.asyncio
async def test_so_cadastros_cria_a_pasta_e_a_nota_dentro_dela(monkeypatch):
    """O roteador pode mandar só para cadastros. A nota não some, e nasce na pasta do lote."""
    banco = Banco()
    _, pergunta, final = await _rodar(
        monkeypatch,
        ["cadastros"],
        [],
        [_pasta("App"), _nota_cadastro("X", "app")],
        banco,
        TEXTO_APP,
    )

    assert list(banco.pastas) == ["app"]
    assert len(banco.notas) == 1 and banco.notas[0]["folder_id"] == "pasta-app"
    assert "Não encontrei pasta" not in final["reply"]
    assert "Deu erro" not in final["reply"], final["reply"]


@pytest.mark.asyncio
async def test_pasta_que_ja_existe_nao_e_erro_e_a_nota_entra_nela(monkeypatch):
    banco = Banco(pastas=["app"])
    _, pergunta, final = await _rodar(
        monkeypatch,
        ["cadastros", "notas"],
        [_nota("X", "app")],
        [_pasta("App")],
        banco,
        TEXTO_APP,
    )

    assert list(banco.pastas) == ["app"]
    assert len(banco.notas) == 1 and banco.notas[0]["folder_id"] == "pasta-app"
    assert "Deu erro" not in final["reply"], final["reply"]
    assert "já existe" in final["reply"], final["reply"]
    assert not final.get("resource_draft")
