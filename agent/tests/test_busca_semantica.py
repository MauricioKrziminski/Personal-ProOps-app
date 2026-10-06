"""Busca semântica de lançamento: o termo que não casa por texto ("almoço") acha pelo sentido.

Sem rede e sem banco: o embedding e a consulta aos vetores são dublês. O que se prova aqui é a
DECISÃO (found / ambiguous / none), o isolamento (só o workspace do contexto chega ao banco), a
queda para o lexical quando o embedding falha e o job de manutenção.
"""

import pytest

from app import db
from app.graph.schemas import FinanceAction, FinanceActionType
from app.jobs import embeddings as job
from app.services import embeddings as emb
from app.tools import finance, resolve

JANELA = [
    {"id": "rest", "kind": "expense", "amount_cents": 3500, "category": "alimentação",
     "description": "Restaurante Fulano", "merchant": None, "occurred_at": "2026-10-05"},
    {"id": "posto", "kind": "expense", "amount_cents": 9000, "category": "transporte",
     "description": "Gasolina", "merchant": "Posto X", "occurred_at": "2026-10-05"},
    {"id": "pizza", "kind": "expense", "amount_cents": 6000, "category": "alimentação",
     "description": "Pizzaria", "merchant": None, "occurred_at": "2026-10-04"},
]


@pytest.fixture
def mundo(monkeypatch):
    """Janela fixa; `achados` e `vetor` configuráveis; guarda o que chegou ao banco."""
    estado = {"achados": [], "vetor": [1.0] + [0.0] * 767, "chamadas": []}

    async def janela(workspace_id, action):
        return [dict(t) for t in JANELA]

    async def consulta(texto):
        return estado["vetor"]

    async def semelhantes(workspace_id, vetor, limite, de, ate):
        estado["chamadas"].append((workspace_id, limite, de, ate))
        return estado["achados"]

    monkeypatch.setattr(finance, "reference_window", janela)
    monkeypatch.setattr(emb, "embed_consulta", consulta)
    monkeypatch.setattr(db, "transacoes_semelhantes", semelhantes)
    return estado


def achados(*pares):
    return [{"transaction_id": i, "similaridade": s} for i, s in pares]


def acao(**campos):
    return FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, **campos)


@pytest.mark.asyncio
async def test_um_candidato_com_folga_vira_found(mundo):
    mundo["achados"] = achados(("rest", 0.80), ("pizza", 0.70), ("posto", 0.30))
    estado, cands = await resolve.por_transacao("ws-1", acao(description="almoço"), False)
    assert estado == "found" and [c["id"] for c in cands] == ["rest"]


@pytest.mark.asyncio
async def test_candidatos_proximos_viram_ambiguous_com_o_que_distingue(mundo):
    mundo["achados"] = achados(("rest", 0.80), ("pizza", 0.78), ("posto", 0.30))
    estado, cands = await resolve.por_transacao("ws-1", acao(description="almoço"), False)
    assert estado == "ambiguous" and [c["id"] for c in cands] == ["rest", "pizza"]
    assert cands[0]["when"] and cands[0]["amount_cents"] == 3500  # data e valor para escolher


@pytest.mark.asyncio
async def test_empate_tem_no_maximo_cinco(mundo, monkeypatch):
    muitos = [{**JANELA[0], "id": f"r{i}"} for i in range(8)]

    async def janela(workspace_id, action):
        return muitos

    monkeypatch.setattr(finance, "reference_window", janela)
    mundo["achados"] = achados(*[(f"r{i}", 0.80) for i in range(8)])
    estado, cands = await resolve.por_transacao("ws-1", acao(description="almoço"), False)
    assert estado == "ambiguous" and len(cands) == resolve.MAX_SEMANTICOS


@pytest.mark.asyncio
async def test_abaixo_do_limiar_continua_nao_achei(mundo):
    mundo["achados"] = achados(("rest", resolve.SIMILARIDADE_MINIMA - 0.01))
    assert await resolve.por_transacao("ws-1", acao(description="almoço"), False) == ("none", [])


@pytest.mark.asyncio
async def test_so_o_que_esta_na_janela_entra(mundo):
    mundo["achados"] = achados(("fora-da-janela", 0.95))
    assert await resolve.por_transacao("ws-1", acao(description="almoço"), False) == ("none", [])


@pytest.mark.asyncio
async def test_so_o_workspace_do_contexto_chega_ao_banco(mundo):
    mundo["achados"] = achados(("rest", 0.9))
    await resolve.por_transacao("ws-do-contexto", acao(description="almoço"), False)
    assert [c[0] for c in mundo["chamadas"]] == ["ws-do-contexto"]


@pytest.mark.asyncio
async def test_a_data_dita_vai_como_janela_da_busca(mundo):
    mundo["achados"] = achados(("rest", 0.9))
    estado, _ = await resolve.por_transacao(
        "ws", acao(description="almoço", occurred_at="2026-10-05"), False)
    assert estado == "found"
    assert mundo["chamadas"][0][2:] == ("2026-10-05", "2026-10-05")


@pytest.mark.asyncio
async def test_sem_data_a_janela_e_a_das_linhas_alcancaveis(mundo):
    mundo["achados"] = achados(("rest", 0.9))
    await resolve.por_transacao("ws", acao(description="almoço"), False)
    assert mundo["chamadas"][0][2:] == ("2026-10-04", "2026-10-05")


@pytest.mark.asyncio
async def test_sem_termo_a_semantica_nunca_e_consultada(mundo):
    mundo["achados"] = achados(("rest", 0.99))
    estado, cands = await resolve.por_transacao("ws", acao(), True)
    assert mundo["chamadas"] == []
    assert estado == "found" and cands[0]["id"] == "rest"  # recência de hoje: a mais recente


@pytest.mark.asyncio
async def test_texto_que_casa_dispensa_a_semantica(mundo):
    estado, cands = await resolve.por_transacao("ws", acao(description="gasolina"), False)
    assert mundo["chamadas"] == [] and estado == "found" and cands[0]["id"] == "posto"


@pytest.mark.asyncio
async def test_embedding_que_falha_cai_no_lexical(mundo, monkeypatch):
    async def sem_vetor(texto):
        return None

    monkeypatch.setattr(emb, "embed_consulta", sem_vetor)
    assert await resolve.por_transacao("ws", acao(description="almoço"), False) == ("none", [])
    assert mundo["chamadas"] == []


@pytest.mark.asyncio
async def test_banco_que_falha_cai_no_lexical(mundo, monkeypatch):
    async def quebra(*_a):
        raise RuntimeError("sem banco")

    monkeypatch.setattr(db, "transacoes_semelhantes", quebra)
    assert await resolve.por_transacao("ws", acao(description="almoço"), False) == ("none", [])


# ---------------------------------------------------------------------------
# cliente de embedding
# ---------------------------------------------------------------------------


def test_normalizar_da_norma_unitaria_e_recusa_tamanho_errado():
    v = emb.normalizar([3.0, 4.0] + [0.0] * (emb.DIMENSOES - 2))
    assert v is not None and abs(sum(x * x for x in v) - 1) < 1e-9
    assert emb.normalizar([1.0, 2.0]) is None
    assert emb.normalizar([0.0] * emb.DIMENSOES) is None


@pytest.mark.asyncio
async def test_consulta_que_levanta_devolve_none(monkeypatch):
    class Quebrado:
        async def aembed_query(self, *a, **k):
            raise RuntimeError("429")

    monkeypatch.setattr(emb, "_embeddings", lambda: Quebrado())
    assert await emb.embed_consulta("almoço") is None


@pytest.mark.asyncio
async def test_documentos_com_um_item_fora_de_forma_devolvem_none(monkeypatch):
    class Torto:
        async def aembed_documents(self, textos, **k):
            return [[1.0] * emb.DIMENSOES, [1.0]]

    monkeypatch.setattr(emb, "_embeddings", lambda: Torto())
    assert await emb.embed_documentos(["a", "b"]) is None


# ---------------------------------------------------------------------------
# job de manutenção
# ---------------------------------------------------------------------------


@pytest.fixture
def banco_do_job(monkeypatch):
    estado = {"pendentes": [], "gravados": [], "pedidos": []}
    monkeypatch.setattr(job, "_descansa_ate", 0.0)

    async def pendentes(modelo, limite):
        estado["pedidos"].append((modelo, limite))
        return estado["pendentes"][:limite]

    async def grava(linhas, modelo):
        estado["gravados"].extend(linhas)
        # o banco passa a considerar prontos os gravados (hash igual)
        prontos = {l["transaction_id"] for l in linhas}
        estado["pendentes"] = [p for p in estado["pendentes"] if p["transaction_id"] not in prontos]
        return len(linhas)

    monkeypatch.setattr(db, "transacoes_sem_vetor", pendentes)
    monkeypatch.setattr(db, "gravar_vetores", grava)
    return estado


def pendente(i):
    return {"transaction_id": f"t{i}", "workspace_id": "ws", "texto": f"texto {i}", "hash": f"h{i}"}


@pytest.mark.asyncio
async def test_job_embeda_o_lote_com_teto_e_e_idempotente(banco_do_job, monkeypatch):
    banco_do_job["pendentes"] = [pendente(i) for i in range(job.LOTE + 5)]
    vistos = []

    async def docs(textos):
        vistos.append(list(textos))
        return [[1.0] + [0.0] * (emb.DIMENSOES - 1) for _ in textos]

    monkeypatch.setattr(emb, "embed_documentos", docs)
    assert await job.run() == {"embedded": job.LOTE}
    assert len(vistos[0]) == job.LOTE and vistos[0][0] == "texto 0"  # o texto vem do banco
    g = banco_do_job["gravados"][0]
    assert g["hash"] == "h0" and g["vetor"].startswith("[1,") and g["workspace_id"] == "ws"
    assert await job.run() == {"embedded": 5}  # o resto na rodada seguinte
    assert await job.run() == {"embedded": 0}  # nada pendente: não chama o Gemini
    assert len(vistos) == 2


@pytest.mark.asyncio
async def test_job_sem_pendente_nao_chama_o_gemini(banco_do_job, monkeypatch):
    async def nao_chama(textos):
        raise AssertionError("não devia chamar")

    monkeypatch.setattr(emb, "embed_documentos", nao_chama)
    assert await job.run() == {"embedded": 0}


@pytest.mark.asyncio
async def test_job_com_embedding_fora_do_ar_nao_grava_e_descansa(banco_do_job, monkeypatch):
    banco_do_job["pendentes"] = [pendente(1)]
    chamadas = []

    async def falha(textos):
        chamadas.append(1)
        return None

    monkeypatch.setattr(emb, "embed_documentos", falha)
    assert await job.run() == {"embedded": 0, "falhou": True}
    assert banco_do_job["gravados"] == []
    assert await job.run() == {"embedded": 0, "descansando": True}
    assert len(chamadas) == 1  # a segunda rodada nem tentou
