"""Regra "nota que cita X vai para a pasta Y": aplicar na nota, e criar/listar pelo recurso `rules`."""

import pytest

from app.graph.schemas import NotesAction, ResourceAction, ResourceField
from app.tools import notes, resources
from app.tools.base import ExecContext


def ctx():
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "x", "app:1")


class Banco:
    """Pastas existentes + regras de nota; registra o que a nota gravou e os hits."""

    def __init__(self, pastas=(), regra=None):
        self.pastas = {n: f"id-{n}" for n in pastas}
        self.regra = regra  # (palavra, nome da pasta)
        self.notas, self.hits = [], []

    async def fetch(self, sql, *a):
        return []

    async def fetch_one(self, sql, *a):
        if "select 1 as ok from public.note_folders" in sql:
            return {"ok": 1} if a[1] in self.pastas else None
        if "_match_note_rule" in sql:
            if self.regra and self.regra[0] in a[1].lower():
                return {"rule_id": "r1", "folder_id": self.pastas[self.regra[1]]}
            return None
        if "select id, name from public.note_folders where id" in sql:
            nome = next(n for n, i in self.pastas.items() if i == a[0])
            return {"id": a[0], "name": nome}
        if "insert into public.note_folders" in sql:
            self.pastas[a[2]] = f"id-{a[2]}"
            return {"id": self.pastas[a[2]], "name": a[2]}
        if "insert into public.notes" in sql:
            self.notas.append(a)
            return {"id": "n1"}

    async def execute(self, sql, *a):
        if "set hits = hits + 1" in sql:
            self.hits.append(a[0])


def nota(folder=None, content="ideia para o ProOps: agente novo"):
    return NotesAction(type="create_note", content=content, folder=folder)


@pytest.fixture
def banco(monkeypatch):
    def faz(**kw):
        b = Banco(**kw)
        for nome in ("fetch", "fetch_one", "execute"):
            monkeypatch.setattr(notes.db, nome, getattr(b, nome))
        return b
    return faz


@pytest.mark.parametrize("folder", [None, "ideias-inventada"])
async def test_regra_manda_a_nota_quando_pasta_vazia_ou_inventada(banco, folder):
    b = banco(pastas=["proops"], regra=("proops", "proops"))
    r = await notes.create_note(ctx(), nota(folder))
    assert "*proops*" in r.message and b.notas[0][-1] == "id-proops" and b.hits == ["r1"]


async def test_pasta_existente_escolhida_pelo_modelo_fica(banco):
    b = banco(pastas=["proops", "trabalho"], regra=("proops", "proops"))
    r = await notes.create_note(ctx(), nota("trabalho"))
    assert "*trabalho*" in r.message and b.hits == []


async def test_sem_regra_nada_muda(banco):
    b = banco(pastas=["proops"], regra=("proops", "proops"))
    r = await notes.create_note(ctx(), nota(None, "comprar pão"))
    assert "em *" not in r.message and b.hits == []


def acao(**campos):
    return ResourceAction(type="resource_create", resource="rules", name="proops",
                          fields=[ResourceField(name=k, value=v) for k, v in campos.items()])


async def test_recurso_rules_com_pasta_existente(monkeypatch):
    async def fetch(sql, *a):
        return [{"id": "id-proops", "name": "proops"}] if "from public.note_folders" in sql else []
    monkeypatch.setattr(resources.db, "fetch", fetch)
    p = await resources.prepare(ctx(), acao(match_type="contains", pattern="proops", folder_id="proops"))
    assert p["values"]["folder_id"] == "id-proops" and "category" not in p["values"]
    assert p["summary"] == "criar a regra: nota que cita *proops* vai para a pasta *proops*"


async def test_recurso_rules_pasta_inexistente_nasce_junto(monkeypatch):
    async def fetch(sql, *a):
        return []
    monkeypatch.setattr(resources.db, "fetch", fetch)
    p = await resources.prepare(ctx(), acao(match_type="contains", pattern="academia", folder_id="saúde"))
    assert p["pasta_nova"] == "saúde" and "vai ser criada" in p["summary"] and "vai ser criada" not in p["concluido"]


async def test_recurso_rules_categoria_continua(monkeypatch):
    async def fetch(sql, *a):
        return []
    monkeypatch.setattr(resources.db, "fetch", fetch)
    p = await resources.prepare(ctx(), acao(match_type="contains", pattern="uber", category="transporte"))
    assert p["summary"] == "criar a regra: lançamento que cita *uber* vai para a categoria *transporte*"
    assert p["concluido"].startswith("✅ Regra criada: lançamento que cita")


async def test_regra_nao_mistura_pasta_e_categoria_e_exige_um_destino(monkeypatch):
    from app.tools.guards import Level1Error
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), acao(match_type="contains", pattern="x", folder_id="a", category="b"))
    with pytest.raises(Level1Error, match="categoria"):
        await resources.prepare(ctx(), acao(match_type="contains", pattern="x"))


def test_set_rule_usa_o_alvo_do_unique_novo():
    """A `20261013150000` trocou o unique por um índice com `(folder_id is null)`: o ON CONFLICT
    antigo, de três colunas, não casa com índice nenhum e o Postgres recusa com 42P10."""
    import inspect

    from app.tools import finance

    fonte = inspect.getsource(finance.set_rule)
    assert "on conflict (workspace_id, match_type, pattern, (folder_id is null))" in fonte


# --- regra resolvida ANTES do SIM, e "fora da pasta" vence a regra (14/10/2026) ---------------

from app.graph import nodes, policy  # noqa: E402


def frase(a):
    return policy.describe_for_confirmation(a, None)


async def test_regra_congelada_antes_do_sim_e_frase_diz_a_pasta(banco):
    b = banco(pastas=["proops"], regra=("proops", "proops"))
    a = nota(None)
    await nodes._congela_pasta_da_regra("workspace", a)
    assert a.folder == "proops" and b.hits == []  # sem hits: a pessoa pode recusar
    assert frase(a).endswith("na pasta proops")


async def test_sem_pasta_nao_consulta_regra_e_grava_sem_pasta(banco, monkeypatch):
    b = banco(pastas=["proops"], regra=("proops", "proops"))
    consultas = []
    antigo = notes.db.fetch_one

    async def espia(sql, *a):
        consultas.append(sql)
        return await antigo(sql, *a)
    monkeypatch.setattr(notes.db, "fetch_one", espia)
    a = NotesAction(type="create_note", content="ideia para o ProOps", sem_pasta=True)
    await nodes._congela_pasta_da_regra("workspace", a)
    assert a.folder is None and "fora das pastas" in frase(a)
    r = await notes.create_note(ctx(), a)
    assert "em *" not in r.message and b.notas[0][-1] is None and b.notas[0][-2] is None
    assert b.hits == [] and not any("_match_note_rule" in c for c in consultas)


async def test_hits_conta_quando_a_pasta_ja_e_a_da_regra(banco):
    b = banco(pastas=["proops"], regra=("proops", "proops"))
    r = await notes.create_note(ctx(), nota("proops"))
    assert "*proops*" in r.message and b.hits == ["r1"]


async def test_pasta_existente_diferente_da_regra_nao_e_sobrescrita(banco):
    b = banco(pastas=["proops", "trabalho"], regra=("proops", "proops"))
    a = nota("trabalho")
    await nodes._congela_pasta_da_regra("workspace", a)
    assert a.folder == "trabalho"
    r = await notes.create_note(ctx(), a)
    assert "*trabalho*" in r.message and b.hits == []


def test_pendente_antigo_sem_sem_pasta_continua_valido():
    assert NotesAction.model_validate({"type": "create_note", "content": "x"}).sem_pasta is False
