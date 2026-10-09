"""Fast-path do "sim" exato (sem modelo) e o "o outro" que deixou de cancelar."""

import pytest

from app.domain import confirm
from app.services import ia

LISTA = [{"id": "t1", "label": "R$ 45 mercado"}, {"id": "t2", "label": "R$ 45 padaria"}]
CONFIRMACAO = {"id": "p1", "thread_id": "t", "summary": "registrar gasto de R$ 45",
               "action": {"kind": "confirmation", "action_type": "create_expense"}}
ESCOLHA = {"id": "p2", "thread_id": "t", "summary": "apagar",
           "action": {"kind": "choice", "action_type": "delete_transaction", "candidates": LISTA}}
AVISO = {"id": "p3", "thread_id": "t", "summary": "acima do limite",
         "action": {"kind": "soft_warning", "action_type": "create_installment_purchase",
                    "candidates": [{"id": "confirm", "label": "Confirmar mesmo assim"},
                                   {"id": "change_card", "label": "Trocar de Cartão"}]}}


@pytest.fixture
def sem_modelo(monkeypatch):
    def nunca(*a, **k):
        raise AssertionError("o fast-path não pode chamar o modelo")

    monkeypatch.setattr(ia, "structured", nunca)


@pytest.mark.parametrize("texto", ["sim", "SIM!!", "Sim.", "s", "ss", "  pode  sim ", "👍 ok",
                                   "Confirmo!", "isso", "certo", "PODE"])
def test_aprovacao_exata(texto):
    assert confirm.resposta_exata(texto) is True


@pytest.mark.parametrize("texto", ["não", "Não.", "NAO!", "n", "cancela", "Cancelar 🚫"])
def test_recusa_exata(texto):
    assert confirm.resposta_exata(texto) is False


@pytest.mark.parametrize("texto", [
    "sim?", "acho que sim", "sim, mas muda pra 50", "sim sim", "não sei", "pode ser",
    "sim e outra coisa", "", None, "gastei 45", "talvez", "ok mas no cartão",
])
def test_o_que_nao_casa_inteiro_cai_no_modelo(texto):
    assert confirm.resposta_exata(texto) is None


async def test_sim_exato_aprova_confirmacao_sem_modelo_e_sem_contar_chamada(sem_modelo):
    uso = {}
    assert await confirm.decide({"text": "Sim!"}, CONFIRMACAO, uso) == {"approved": True}
    assert uso == {}


async def test_nao_exato_recusa_sem_modelo(sem_modelo):
    assert await confirm.decide({"text": "não"}, CONFIRMACAO, {}) == {"approved": False}


async def test_sim_exato_no_aviso_de_limite_aprova_o_item(sem_modelo):
    assert await confirm.decide({"text": "ok"}, AVISO, {}) == {"approved": True}


async def test_sim_exato_NUNCA_resolve_pergunta_de_escolha(sem_modelo):
    decisao = await confirm.decide({"text": "sim"}, ESCOLHA, {})
    assert decisao.get("approved") is not True
    assert decisao["keep_pending"] is True
    for c in LISTA:
        assert c["label"] in decisao["clarification"]


async def test_nao_exato_cancela_a_escolha_sem_modelo(sem_modelo):
    assert await confirm.decide({"text": "não"}, ESCOLHA, {}) == {"approved": False}


async def test_condicional_e_duvida_ainda_vao_ao_classificador(monkeypatch):
    chamadas = []

    async def aviso(texto, resumo, **kw):
        chamadas.append(texto)
        return {"decision": "unclear"}

    monkeypatch.setattr(confirm, "_classificar_aviso", aviso)
    for texto in ("sim, mas muda pra 50", "sim?", "acho que sim"):
        r = await confirm.decide({"text": texto}, CONFIRMACAO, {})
        assert r["keep_pending"] is True
    assert chamadas == ["sim, mas muda pra 50", "sim?", "acho que sim"]


# --- M5 ----------------------------------------------------------------------


def test_outro_e_outra_nao_sao_nenhuma():
    assert confirm.interpret_choice("outro", 2) is None
    assert confirm.interpret_choice("outra", 2) is None
    assert confirm.interpret_choice("nenhuma", 2) == 0
    assert confirm.interpret_choice("nenhuma dessas", 2) == 0


async def test_o_outro_chega_ao_classificador_semantico_e_nao_cancela(monkeypatch):
    from unittest.mock import AsyncMock

    from app.graph.schemas import CandidateChoice

    modelo = AsyncMock(return_value=CandidateChoice(index=2))
    monkeypatch.setattr(ia, "structured",
                        lambda *a, **kw: type("M", (), {"ainvoke": modelo})())
    uso = {}
    decisao = await confirm.decide({"text": "o outro"}, ESCOLHA, uso)
    assert decisao == {"approved": True, "candidate_id": "t2"}
    assert modelo.await_count == 1 and uso["llm_calls"] == 1
