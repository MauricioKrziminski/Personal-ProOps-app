"""15/10/2026 — ajuda sobre o app: agradecimento tem resposta curta e "testar o aplicativo do banco novo" não se perde.

A escolha do catálogo é UMA chamada por turno, num nó próprio (o `dominio` reexecuta ao ser respondido); vazio vira
a pergunta de domínio de sempre; modelo fora do ar nunca pergunta."""

from __future__ import annotations

import pytest
from langgraph.types import Command

from app.conhecimento import ajuda
from app.conhecimento.app import AJUDA_GERAL, POR_ID, SUPORTE
from app.graph import nodes
from tests.test_hitl_flow import _config, _estado, _pausa, grafo  # noqa: F401 (fixtures)

CURTA = POR_ID["agradecimento"].resposta


@pytest.fixture
def escolher(monkeypatch):
    """Dublê de `ajuda.escolher`: o que ele devolve (ou levanta) e quantas vezes foi chamado."""
    caixa = {"resposta": [], "chamadas": 0}

    async def falso(_texto):
        caixa["chamadas"] += 1
        if isinstance(caixa["resposta"], Exception):
            raise caixa["resposta"]
        return caixa["resposta"]

    monkeypatch.setattr(ajuda, "escolher", falso)
    return caixa


def geral(texto, **kw):
    return {**_estado([]), "domains": ["geral"], "confidence": 0.9, "text": texto, **kw}


# --- catálogo ----------------------------------------------------------------------------------


def test_agradecimento_e_uma_entrada_curta_sem_rota():
    e = POR_ID["agradecimento"]
    assert e.rota is None and len(e.resposta) < 80 and e.resposta != AJUDA_GERAL
    assert "agradecimento" in ajuda.SISTEMA and "agente_faz" in ajuda.SISTEMA
    assert "agradecimento" in ajuda._lista()


@pytest.mark.parametrize("texto", ["valeu", "Obrigado!", "vlw", "obrigada."])
async def test_agradecimento_simples_responde_curto_sem_modelo(escolher, texto):
    saida = await nodes.general_node({"text": texto, "domains": ["geral"]})
    assert saida["results"] == [CURTA] and escolher["chamadas"] == 0


async def test_saudacao_continua_com_a_apresentacao(escolher):
    saida = await nodes.general_node({"text": "oi", "domains": ["geral"]})
    assert saida["results"] == [AJUDA_GERAL] and escolher["chamadas"] == 0


# --- o grafo: uma chamada, e o que ela achou decide ------------------------------------------


@pytest.mark.asyncio
async def test_agradecimento_longo_acha_a_entrada_curta_em_uma_chamada(grafo, escolher):
    escolher["resposta"] = [POR_ID["agradecimento"]]
    final = await grafo.ainvoke(geral("valeu, ajudou muito"), config={"configurable": {"thread_id": "tri-1"}})
    assert "__interrupt__" not in final
    assert final["results"] == [CURTA] and final["ajuda_ids"] == ["agradecimento"]
    assert escolher["chamadas"] == 1 and final["llm_calls"] == 1


@pytest.mark.asyncio
async def test_entrada_achada_responde_do_catalogo_sem_perguntar(grafo, escolher):
    escolher["resposta"] = [POR_ID["cartoes"]]
    final = await grafo.ainvoke(geral("onde cadastro um cartão novo?"), config={"configurable": {"thread_id": "tri-2"}})
    assert "__interrupt__" not in final
    assert final["results"] == [POR_ID["cartoes"].resposta]
    assert escolher["chamadas"] == 1 and final["llm_calls"] == 1


@pytest.mark.asyncio
async def test_fora_do_app_pergunta_o_dominio_e_a_ajuda_devolve_o_suporte(grafo, escolher):
    cfg = {"configurable": {"thread_id": "tri-3"}}
    escolher["resposta"] = []
    estado = await grafo.ainvoke(geral("testar o aplicativo do banco novo"), config=cfg)
    pausa = _pausa(estado)
    assert pausa["kind"] == "domain" and pausa["summary"] == "Como você quer registrar isso?"
    assert [o["label"] for o in pausa["options"]] == ["Como gasto/receita", "Como nota", "Era uma dúvida sobre o app"]

    final = await grafo.ainvoke(Command(resume="geral"), config=cfg)
    assert final["results"] == [SUPORTE]
    assert escolher["chamadas"] == 1, "responder a pergunta não repete a chamada do modelo"


@pytest.mark.asyncio
async def test_fora_do_app_e_a_pessoa_diz_que_e_uma_nota(grafo, escolher):
    cfg = {"configurable": {"thread_id": "tri-4"}}
    await grafo.ainvoke(geral("testar o aplicativo do banco novo"), config=cfg)
    final = await grafo.ainvoke(Command(resume="notas"), config=cfg)
    assert final["domains"] == ["notas"] and final["confidence"] == 1.0
    assert final["dominio_escolhido"] == "notas", "o parse de notas precisa saber que a nota foi escolhida"
    assert escolher["chamadas"] == 1


@pytest.mark.asyncio
async def test_modelo_fora_do_ar_nao_pergunta_e_vale_a_ajuda_geral(grafo, escolher):
    escolher["resposta"] = RuntimeError("503")
    final = await grafo.ainvoke(geral("testar o aplicativo do banco novo"), config={"configurable": {"thread_id": "tri-5"}})
    assert "__interrupt__" not in final
    assert final["results"] == [AJUDA_GERAL] and final.get("ajuda_ids") is None


@pytest.mark.asyncio
@pytest.mark.parametrize("estado", [
    {"text": "oi"},                                   # saudação: fast-path sem modelo
    {"text": "gastei 45 e valeu", "domains": ["geral", "notas"]},   # outro domínio junto
    {"leitura_da_imagem": {"tipo": "outro", "o_que": "foto"}},      # imagem lida
    {"confidence": 0.4},                              # roteador em dúvida: já pergunta, sem gastar chamada
])
async def test_triagem_nao_chama_o_modelo_fora_do_caso(escolher, estado):
    base = {**geral("testar o aplicativo do banco novo"), **estado}
    assert await nodes.triagem_da_ajuda(base) == {}
    assert escolher["chamadas"] == 0


async def test_triagem_so_vale_para_geral_sozinho(escolher):
    assert await nodes.triagem_da_ajuda({**geral("x"), "domains": ["financas"]}) == {}
    assert escolher["chamadas"] == 0


async def test_ids_inventados_pelo_modelo_nao_viram_resposta(monkeypatch):
    assert ajuda.ids_validos(["nao_existe", "agradecimento"]) == [POR_ID["agradecimento"]]
