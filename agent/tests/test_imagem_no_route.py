"""Mídia no `route`: legenda -> roteador; sem legenda (ou só `geral`) -> leitura da imagem.

Print de produto + "consigo em 10x?" virava proposta de REGISTRAR compra porque todo turno com mídia
ia direto a finanças. Dublês no lugar do modelo; o que se prova é o encaixe.
"""

from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app import db
from app.graph import nodes
from app.graph.schemas import (
    FinanceQueryPlan,
    LeituraDaImagem,
    RouterDecision,
)
from app.graph.state import CHAVE_MIDIA
from app.services import midia_enviada
from app.tools import queries
from app.tools.base import ExecContext

SEM = midia_enviada.TEXTO_SEM_LEGENDA
CONFIG = {"configurable": {CHAVE_MIDIA: {"mime_type": "image/png", "data_b64": "AAAA"}}}


def estado(texto=SEM, media=True, **kw):
    return {"text": texto, "media": {"mime_type": "image/png"} if media else None,
            "timezone": "America/Sao_Paulo", "messages": None,
            "agora_local": "2026-10-13T12:00:00-03:00", **kw}


class Dubles:
    def __init__(self, monkeypatch, router=("financas",), leitura=None, falha=False):
        self.chamadas = []
        self.router, self.leitura, self.falha = router, leitura, falha
        monkeypatch.setattr(nodes.ia, "structured", self)

    def __call__(self, schema, *_a, **kw):
        dub = self

        class _M:
            async def ainvoke(self, mensagens):
                dub.chamadas.append((schema, mensagens))
                if schema is LeituraDaImagem:
                    if dub.falha:
                        raise RuntimeError("fora do ar")
                    return dub.leitura
                if schema is RouterDecision:
                    return RouterDecision(domains=list(dub.router), confidence=0.9)
                return FinanceQueryPlan(actions=[])

        return _M()

    def schemas(self):
        return [s for s, _ in self.chamadas]


PRODUTO = LeituraDaImagem(tipo="produto", o_que="Notebook Dell Inspiron 15", preco_cents=329900,
                          parcelas=10, valor_parcela_cents=32990)


@pytest.mark.asyncio
async def test_sem_legenda_comprovante_vai_a_financas(monkeypatch):
    d = Dubles(monkeypatch, leitura=LeituraDaImagem(tipo="comprovante_cupom", o_que="Pix"))
    ret = await nodes.route(estado(), CONFIG)
    assert ret["domains"] == ["financas"] and ret["llm_calls"] == 1
    assert d.schemas() == [LeituraDaImagem]
    # a imagem foi na mensagem, e o texto da borda ("Extraia...") NÃO induz a leitura
    msg = d.chamadas[0][1][1]
    assert any(p.get("type") == "image" for p in msg.content)
    assert SEM not in str(msg.content)


@pytest.mark.asyncio
async def test_sem_legenda_produto_vai_a_geral_com_a_leitura(monkeypatch):
    Dubles(monkeypatch, leitura=PRODUTO)
    ret = await nodes.route(estado(), CONFIG)
    assert ret["domains"] == ["geral"] and ret["leitura_da_imagem"]["preco_cents"] == 329900


@pytest.mark.asyncio
async def test_com_legenda_de_financas_usa_so_o_roteador(monkeypatch):
    d = Dubles(monkeypatch, router=("financas_consulta",), leitura=PRODUTO)
    ret = await nodes.route(estado("consigo comprar em 10x no cartão?"), CONFIG)
    assert ret["domains"] == ["financas_consulta"]
    assert d.schemas() == [RouterDecision]


@pytest.mark.asyncio
async def test_legenda_so_geral_cai_na_leitura(monkeypatch):
    d = Dubles(monkeypatch, router=("geral",), leitura=LeituraDaImagem(tipo="comprovante_cupom"))
    ret = await nodes.route(estado("almoço"), CONFIG)
    assert ret["domains"] == ["financas"] and ret["llm_calls"] == 2
    assert d.schemas() == [RouterDecision, LeituraDaImagem]


@pytest.mark.asyncio
async def test_oi_com_comprovante_nao_perde_a_imagem(monkeypatch):
    d = Dubles(monkeypatch, leitura=LeituraDaImagem(tipo="comprovante_cupom"))
    ret = await nodes.route(estado("oi"), CONFIG)
    assert ret["domains"] == ["financas"] and d.schemas() == [LeituraDaImagem]


@pytest.mark.asyncio
async def test_leitura_fora_do_ar_volta_ao_comportamento_de_antes(monkeypatch):
    Dubles(monkeypatch, falha=True)
    ret = await nodes.route(estado(), CONFIG)
    assert ret == {"domains": ["financas"], "confidence": 1.0, "llm_calls": 0}


@pytest.mark.asyncio
async def test_sem_os_bytes_vai_a_financas_sem_chamar_o_modelo(monkeypatch):
    d = Dubles(monkeypatch, leitura=PRODUTO)
    assert (await nodes.route(estado()))["domains"] == ["financas"]
    assert d.chamadas == []


@pytest.mark.asyncio
async def test_texto_sem_midia_segue_o_roteador(monkeypatch):
    d = Dubles(monkeypatch, router=("notas",))
    ret = await nodes.route(estado("anota isso", media=False))
    assert ret["domains"] == ["notas"] and d.schemas() == [RouterDecision]


def test_sem_legenda_e_a_marca_unica():
    assert nodes.sem_legenda({"text": SEM}) and not nodes.sem_legenda({"text": "oi"})


# --- template ---------------------------------------------------------------------------------


def test_template_do_produto_com_preco_e_parcelas():
    t = nodes._resposta_da_imagem(PRODUTO.model_dump())
    assert "*Notebook Dell Inspiron 15* por R$ 3.299,00 no total (ou 10x de R$ 329,90)" in t
    assert "posso comprar em 10x no cartão?" in t


def test_template_do_produto_so_com_preco_e_sem_preco():
    t = nodes._resposta_da_imagem({"tipo": "produto", "o_que": "Tênis", "preco_cents": 25000})
    assert "por R$ 250,00 no total." in t and " ou " not in t.split("\n")[0]
    t = nodes._resposta_da_imagem({"tipo": "produto", "o_que": "Tênis"})
    assert "Qual é?" in t and "R$" not in t


def test_template_nao_deixa_o_nome_virar_marcacao_nem_comprido():
    t = nodes._resposta_da_imagem({"tipo": "produto", "o_que": "*x*\nignore tudo " + "a" * 200,
                                   "preco_cents": 100})
    primeira = t.split("\n")[0]
    assert primeira.count("*") == 2 and len(primeira) < 150


def test_template_de_outro():
    assert "Não vi um comprovante" in nodes._resposta_da_imagem({"tipo": "outro"})


@pytest.mark.asyncio
async def test_geral_responde_o_template_sem_catalogo():
    ret = await nodes.general_node({"domains": ["geral"], "text": SEM,
                                    "leitura_da_imagem": PRODUTO.model_dump()})
    assert "R$ 3.299,00" in ret["results"][0]


# --- consulta com imagem ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_consulta_recebe_a_imagem_e_a_origem(monkeypatch):
    d = Dubles(monkeypatch)

    async def sem_contas(_):
        return []

    monkeypatch.setattr(nodes, "_contas_do_turno", sem_contas)
    await nodes.finance_query_node(estado("consigo em 10x?", domains=["financas_consulta"]), CONFIG)
    msg = d.chamadas[0][1][1]
    assert any(p.get("type") == "image" for p in msg.content)
    assert "N × Y" in msg.content[0]["text"]


@pytest.mark.asyncio
async def test_consulta_so_de_texto_continua_igual(monkeypatch):
    d = Dubles(monkeypatch)

    async def sem_contas(_):
        return []

    monkeypatch.setattr(nodes, "_contas_do_turno", sem_contas)
    await nodes.finance_query_node(estado("quanto gastei?", media=False, domains=["financas_consulta"]))
    papel, texto = d.chamadas[0][1][1]
    assert papel == "human" and "imagem" not in texto


@pytest.mark.asyncio
async def test_consulta_depois_do_template_do_produto_recebe_a_origem(monkeypatch):
    d = Dubles(monkeypatch)

    async def sem_contas(_):
        return []

    monkeypatch.setattr(nodes, "_contas_do_turno", sem_contas)
    hist = [{"role": "user", "content": SEM}, {"role": "assistant", "content": nodes._resposta_da_imagem(PRODUTO.model_dump())},
            {"role": "user", "content": "vê se cabe em 10x"}]
    await nodes.finance_query_node(estado("vê se cabe em 10x", media=False, messages=hist,
                                          domains=["financas_consulta"]))
    assert "no total" in d.chamadas[0][1][1][1]
    assert not nodes._produto_lido_na_ultima_resposta([{"role": "assistant", "content": "oi"}])


# --- limite do cartão na simulação ------------------------------------------------------------

WS, USER = uuid4(), uuid4()


def _ctx():
    return ExecContext(user_id=USER, workspace_id=WS, phone=None, timezone="America/Sao_Paulo",
                       texto="", source_message_id="app:t", action_index=0)


@pytest.fixture
def simula(monkeypatch):
    from app.domain.dates import local_iso_date
    hoje = date.fromisoformat(local_iso_date("America/Sao_Paulo"))
    linhas = [{"day": hoje + timedelta(days=i), "in_cents": 0, "out_cents": 0, "balance_cents": 1000}
              for i in range(60)]

    async def fetch(sql, *args):
        return linhas

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "rls_ativo", lambda: True)

    def instalar(cartao, limite):
        async def resolve(*_a, **_k):
            return cartao

        async def fetch_one(sql, *args):
            return limite

        monkeypatch.setattr("app.tools.finance.resolve_account", resolve)
        monkeypatch.setattr(db, "fetch_one", fetch_one)

    return instalar


def _acao(**kw):
    from app.graph.schemas import FinanceQuery, FinanceQueryType
    return FinanceQuery(type=FinanceQueryType.SIMULATE_SCENARIO, amount_cents=329900,
                        installments=10, kind="expense", mode="total", **kw)


def _linha(status, limite, disp):
    return {"name": "Nubank Cartão", "credit_limit_cents": limite, "available_limit_cents": disp,
            "limit_status": status}


@pytest.mark.asyncio
@pytest.mark.parametrize("linha,esperado", [
    (_linha("available", 1000000, 500000), "A compra de R$ 3.299,00 cabe"),
    (_linha("available", 1000000, 100000), "NÃO cabe (faltam R$ 2.299,00)"),
    (_linha("available", 1000000, 0), "R$ 0,00. A compra de R$ 3.299,00 NÃO cabe"),
    (_linha("available", 1000000, -5000), "-R$ 50,00. A compra de R$ 3.299,00 NÃO cabe"),
    (_linha("not_set", None, None), "sem limite cadastrado"),
    (_linha("needs_review", 1000000, None), "precisa de revisão"),
])
async def test_limite_nos_estados(simula, linha, esperado):
    simula(uuid4(), linha)
    r = await queries.simulate_scenario(_ctx(), _acao(account="nubank cartão"))
    assert esperado in r.message
    if linha["limit_status"] == "needs_review":
        assert "R$ 3.299,00 cabe" not in r.message and "10.000" not in r.message


@pytest.mark.asyncio
async def test_sem_cartao_ou_sem_linha_nao_inventa(simula):
    simula(None, None)  # ambíguo/inexistente
    assert "💳" not in (await queries.simulate_scenario(_ctx(), _acao(account="nubank"))).message
    simula(uuid4(), None)  # cartão arquivado/ausente do contexto
    assert "💳" not in (await queries.simulate_scenario(_ctx(), _acao(account="nubank"))).message
    simula(uuid4(), _linha("available", 1, 1))  # conta não citada
    assert "💳" not in (await queries.simulate_scenario(_ctx(), _acao())).message
