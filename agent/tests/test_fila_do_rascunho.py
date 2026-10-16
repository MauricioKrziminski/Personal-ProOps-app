"""Duas incompletas no mesmo pedido (15/10/2026): uma pergunta por vez, e a outra não some.

"gastei no mercado e no uber" (sem valores) perguntava os dois valores e o rascunho guardava só o mercado: a
resposta do uber não tinha onde cair e ninguém avisava. Hoje a primeira é perguntada, a segunda viaja na fila do
rascunho e é perguntada depois. E o lote que para por erro (cartão que não existe) diz o que ficou de fora.
"""

import pytest

from app import conversation, db
from app.domain import draft
from app.graph import nodes
from app.graph.schemas import FinanceAction

SP = "America/Sao_Paulo"


def _estado(texto="gastei no mercado e no uber", **extra):
    return {"text": texto, "timezone": SP, "results": [], **extra}


def _sem_valor(nome):
    return FinanceAction(type="create_expense", description=nome)


def test_duas_incompletas_perguntam_uma_e_avisam_a_outra():
    linhas = nodes._esclarecimentos(_estado(), [_sem_valor("mercado"), _sem_valor("uber")])
    assert len(linhas) == 2
    assert "mercado" in linhas[0] and "uber" not in linhas[0]
    assert linhas[1] == "Depois eu pergunto o que falta de *uber*."


def test_incompleta_ao_lado_de_uma_pronta_diz_de_qual_e():
    pronta = FinanceAction(type="create_expense", description="mercado", amount_cents=5000)
    (linha,) = nodes._esclarecimentos(_estado(), [pronta, _sem_valor("uber")])
    assert linha.startswith("Sobre *uber*: ")


def test_uma_incompleta_continua_uma_pergunta_so():
    (linha,) = nodes._esclarecimentos(_estado("gastei no mercado"), [_sem_valor("mercado")])
    assert "Depois" not in linha


def test_rascunho_guarda_a_primeira_e_leva_as_outras_na_fila():
    pronta = FinanceAction(type="create_expense", description="café", amount_cents=800)
    r = nodes._rascunho(_estado(), [_sem_valor("mercado"), pronta, _sem_valor("uber")])
    assert r["action"]["description"] == "mercado"
    # a pronta foi ao SIM neste turno: na fila ela seria proposta de novo
    assert [a["description"] for a in r["action"]["_fila"]] == ["uber"]


def test_rascunho_sem_outras_incompletas_nao_tem_fila():
    r = nodes._rascunho(_estado("gastei no mercado"), [_sem_valor("mercado")])
    assert "_fila" not in r["action"]


@pytest.mark.asyncio
async def test_lote_parado_por_erro_diz_o_que_estava_pronto_e_nao_entrou():
    estado = {
        **_estado("gastei 30 no mercado e 100 no uber no cartão bradesco"),
        "finance_actions": [
            {"type": "create_expense", "description": "mercado", "amount_cents": 3000},
            {"type": "create_expense", "description": "uber", "amount_cents": 10000, "account": "bradesco"},
        ],
        "targets": [{}, {"correction_error": "Não achei o cartão bradesco."}],
    }
    ret = await nodes.gate(estado)
    assert ret["halted"] and not ret["approved"]
    assert ret["results"] == ["Não achei o cartão bradesco.",
                              "Ainda não registrei *mercado*: me manda de novo depois disso."]


# --- o turno seguinte: completar roda a fila junto; esquecer pergunta o próximo -----------------------------

SESSAO = {
    "id": "44444444-4444-4444-4444-444444444444", "channel": "whatsapp", "phone": "5551999999999",
    "user_id": "11111111-1111-1111-1111-111111111111", "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": SP, "thread_id": "t", "session_epoch": 1,
}
UBER = {"type": "create_expense", "description": "uber"}
RASCUNHO = {
    "id": "d1", "phone": SESSAO["phone"], "slot": "amount", "missing": "Qual o valor do mercado?",
    "raw_text": "gastei no mercado e no uber",
    "action": {"type": "create_expense", "description": "mercado", "_fila": [UBER]},
}


@pytest.fixture
def turno(monkeypatch):
    from types import SimpleNamespace
    import app.graph.build as build

    class Checkpoint:
        async def aget_state(self, config):
            return SimpleNamespace(values={})

        async def aupdate_state(self, config, values):
            return None

    async def nada(*a, **k):
        return None

    async def rascunho(_sessao_id):
        return RASCUNHO

    rodados = []

    async def rodar(sessao, lote, conteudo, acoes, thread, config, uso=None, **_):
        rodados.append(acoes)
        return "Qual o valor do uber?"

    monkeypatch.setattr(build, "graph", lambda: Checkpoint())
    for nome in ("open_pending", "expire_drafts", "expire_pending", "delete_draft", "record_ai_event"):
        monkeypatch.setattr(db, nome, nada)
    monkeypatch.setattr(db, "open_draft", rascunho)
    monkeypatch.setattr(conversation, "_rodar_com_acoes", rodar)
    return monkeypatch, rodados


@pytest.mark.asyncio
async def test_completar_roda_a_acao_e_a_fila_juntas(turno):
    monkeypatch, rodados = turno

    async def interpretar(texto, rasc, uso=None):
        return {"acao": "completar", "slot": "amount", "amount_cents": 5000}

    monkeypatch.setattr(draft, "interpretar", interpretar)
    r = await conversation.run_turn(SESSAO, source_message_id="w2", conteudo={"text": "50"})
    assert r == "Qual o valor do uber?"
    (acoes,) = rodados
    assert [a["description"] for a in acoes] == ["mercado", "uber"]
    assert acoes[0]["amount_cents"] == 5000 and "_fila" not in acoes[0]


@pytest.mark.asyncio
async def test_esquecer_com_fila_pergunta_o_proximo(turno):
    monkeypatch, rodados = turno

    async def interpretar(texto, rasc, uso=None):
        return {"acao": "descartar"}

    monkeypatch.setattr(draft, "interpretar", interpretar)
    r = await conversation.run_turn(SESSAO, source_message_id="w2", conteudo={"text": "esquece o mercado"})
    assert rodados == [[UBER]]
    assert r == "👍 Beleza, esqueci aquele lançamento.\n\nQual o valor do uber?"
