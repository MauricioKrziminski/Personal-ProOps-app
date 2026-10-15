"""Pasta dentro de pasta: o caminho "trabalho / 2026" é a identidade; nome em dois lugares é pergunta."""

from types import SimpleNamespace

from app.graph.schemas import NotesAction
from app.tools import notes
from app.tools.base import ExecContext

ARVORE = [
    {"id": "t", "parent_id": None, "name": "trabalho"},
    {"id": "p", "parent_id": None, "name": "pessoal"},
    {"id": "t26", "parent_id": "t", "name": "2026"},
    {"id": "p26", "parent_id": "p", "name": "2026"},
    {"id": "tq1", "parent_id": "t26", "name": "q1"},
    {"id": "lit", "parent_id": None, "name": "a/b"},
]


def ctx():
    return ExecContext("user", "workspace", None, "America/Sao_Paulo", "x", "app:1")


def test_caminho_anda_nivel_a_nivel():
    for texto in ("trabalho / 2026", "Trabalho/2026"):
        r = notes.resolver(ARVORE, texto)
        assert (r["estado"], r["id"], r["caminho"]) == ("achada", "t26", "trabalho / 2026")


def test_nome_solto_unico_em_qualquer_nivel_e_a_pasta():
    r = notes.resolver(ARVORE, "q1")
    assert (r["estado"], r["id"], r["caminho"]) == ("achada", "tq1", "trabalho / 2026 / q1")


def test_nome_solto_em_dois_lugares_e_ambiguo_e_pergunta():
    r = notes.resolver(ARVORE, "2026")
    assert r["estado"] == "ambigua" and r["opcoes"] == ["pessoal / 2026", "trabalho / 2026"]
    assert notes.pergunta_da_ambiguidade(r) == (
        "Tenho mais de uma pasta chamada *2026*: *pessoal / 2026*, *trabalho / 2026*. Em qual delas "
        "vai a nota? Responde com o caminho (ex.: *pessoal / 2026*) ou diz *sem pasta*.")


def test_inexistente_vira_pasta_na_raiz_e_caminho_parcial_cria_so_o_que_falta():
    r = notes.resolver(ARVORE, "ideias")
    assert (r["estado"], r["parent_id"], r["faltam"]) == ("falta", None, ["ideias"])
    r = notes.resolver(ARVORE, "trabalho / 2027 / q1")
    assert (r["parent_id"], r["faltam"], r["nivel"]) == ("t", ["2027", "q1"], 1)


def test_nome_antigo_com_barra_literal_vale_inteiro():
    r = notes.resolver(ARVORE, "a/b")
    assert (r["estado"], r["id"]) == ("achada", "lit")


def test_descendentes_incluem_a_pasta_e_tudo_abaixo():
    assert set(notes.descendentes(ARVORE, "t")) == {"t", "t26", "tq1"}


class Banco:
    def __init__(self, pastas, falha=None):
        self.pastas, self.falha = list(pastas), falha
        self.inserts, self.notas, self.consultas = [], [], []

    async def fetch(self, sql, *a):
        if "from public.note_folders" in sql:
            return [dict(p) for p in self.pastas]
        self.consultas.append((sql, a))
        return [{"id": "n1", "content": "ata", "updated_at": None, "folder_id": "tq1"}]

    async def fetch_one(self, sql, *a):
        if "insert into public.note_folders" in sql:
            assert "on conflict do nothing" in sql and "on conflict (" not in sql
            if self.falha:
                raise self.falha
            _ws, _user, pai, nome = a
            nova = {"id": f"id-{nome}", "parent_id": pai, "name": nome}
            self.pastas.append(nova)
            self.inserts.append((pai, nome))
            return {"id": nova["id"], "name": nome}
        if "insert into public.notes" in sql:
            self.notas.append(a)
            return {"id": "n1"}


def usa(monkeypatch, banco):
    for nome in ("fetch", "fetch_one"):
        monkeypatch.setattr(notes.db, nome, getattr(banco, nome))
    async def sem_regra(*_a, **_k):
        return None
    monkeypatch.setattr(notes, "_regra_que_cita", sem_regra)


async def test_ensure_folder_cria_mae_e_filha_e_a_nota_diz_o_caminho(monkeypatch):
    b = Banco([])
    usa(monkeypatch, b)
    r = await notes.create_note(ctx(), NotesAction(type="create_note", content="ata", folder="trabalho / 2027"))
    assert b.inserts == [(None, "trabalho"), ("id-trabalho", "2027")]
    assert "em *trabalho / 2027*" in r.message
    assert b.notas[0][-1] == "id-2027" and b.notas[0][-2] == "2027"  # category legada = só a folha


async def test_erro_de_profundidade_do_banco_avisa_e_a_nota_nao_se_perde(monkeypatch):
    erro = Exception("x")
    erro.sqlstate = "P0001"
    erro.diag = SimpleNamespace(message_primary="Limite de 5 níveis de pastas.", source_function=None)
    b = Banco([], falha=erro)
    usa(monkeypatch, b)
    r = await notes.create_note(ctx(), NotesAction(type="create_note", content="ata", folder="x"))
    assert b.notas and b.notas[0][-1] is None
    assert "Limite de 5 níveis de pastas" in r.message and "sem pasta" in r.message


async def test_sexto_nivel_e_recusado_antes_de_criar_qualquer_pasta(monkeypatch):
    b = Banco([])
    usa(monkeypatch, b)
    r = await notes.create_note(ctx(), NotesAction(type="create_note", content="ata", folder="a/b2/c/d/e/f"))
    assert b.inserts == [] and b.notas[0][-1] is None and "5 níveis" in r.message


async def test_pergunta_antes_do_sim_quando_o_nome_esta_em_dois_lugares(monkeypatch):
    usa(monkeypatch, Banco(ARVORE))
    a = NotesAction(type="create_note", content="ata", folder="2026")
    assert "Tenho mais de uma pasta chamada *2026*" in await notes.pergunta_da_pasta("w", a)
    a.folder = "trabalho / 2026"
    assert await notes.pergunta_da_pasta("w", a) is None


async def test_execucao_ambigua_nao_escolhe_nem_cria(monkeypatch):
    b = Banco(ARVORE)
    usa(monkeypatch, b)
    r = await notes.create_note(ctx(), NotesAction(type="create_note", content="ata", folder="2026"))
    assert b.inserts == [] and b.notas[0][-1] is None and "mais de uma pasta" in r.message


async def test_query_notes_inclui_subpastas_e_mostra_o_caminho(monkeypatch):
    b = Banco(ARVORE)
    usa(monkeypatch, b)
    r = await notes.query_notes(ctx(), NotesAction(type="query_notes", folder="trabalho"))
    sql, args = b.consultas[0]
    assert "n.folder_id = any(%s)" in sql and set(args[-1]) == {"t", "t26", "tq1"}
    assert "trabalho / 2026 / q1" in r.message


async def test_query_notes_com_nome_ambiguo_pergunta(monkeypatch):
    b = Banco(ARVORE)
    usa(monkeypatch, b)
    r = await notes.query_notes(ctx(), NotesAction(type="query_notes", folder="2026"))
    assert b.consultas == [] and "Em qual delas procuro?" in r.message


async def test_notes_node_pergunta_a_pasta_e_a_resposta_completa_a_nota(monkeypatch):
    from app.graph import nodes
    from app.graph.schemas import NotesPlan

    banco = Banco(ARVORE)
    usa(monkeypatch, banco)
    vistas = []

    def modelo(plano):
        class M:
            async def ainvoke(self, msgs):
                vistas.append(msgs)
                return NotesPlan(actions=[plano])
        monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: M())

    async def sem_pastas(_ws):
        return []
    monkeypatch.setattr(nodes, "_pastas_do_workspace", sem_pastas)
    base = {"workspace_id": "w", "timezone": "America/Sao_Paulo", "messages": None}

    modelo(NotesAction(type="create_note", content="ata", folder="2026"))
    ret = await nodes.notes_node({**base, "text": "anota na pasta 2026: ata"})
    (pend,) = ret["notes_draft"]
    assert ret["notes_actions"] == [] and ret["results"] == [pend["_pergunta"]]
    assert "Tenho mais de uma pasta chamada *2026*" in pend["_pergunta"]

    modelo(NotesAction(type="create_note", folder="trabalho / 2026"))  # o modelo devolveu só o caminho
    ret = await nodes.notes_node({**base, "text": "trabalho", "notes_draft": [pend]})
    (acao,) = ret["notes_actions"]
    assert acao["content"] == "ata" and acao["folder"] == "trabalho / 2026" and ret["notes_draft"] == []
    assert "devolva o MESMO create_note" in vistas[-1][1][1]


async def test_rede_mae_que_so_o_modelo_disse_vira_pergunta(monkeypatch):
    usa(monkeypatch, Banco(ARVORE))
    a = NotesAction(type="create_note", content="x", folder="pessoal / 2026")  # o modelo completou a mãe
    p = await notes.pergunta_da_pasta("w", a, "anota na pasta 2026: ligar para o contador")
    assert p and "Tenho mais de uma pasta chamada *2026*" in p
    assert await notes.pergunta_da_pasta("w", a, "anota na pasta 2026 de Pessoal: ligar") is None
    assert await notes.pergunta_da_pasta("w", a, "anota em pessoal/2026: ligar") is None
    # folha não ambígua: pasta nova/única dentro de outra não exige a mãe na frase
    q = NotesAction(type="create_note", content="x", folder="trabalho / 2026 / q1")
    assert await notes.pergunta_da_pasta("w", q, "anota na pasta q1: ata") is None
