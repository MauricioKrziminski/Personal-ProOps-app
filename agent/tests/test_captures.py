"""`POST /internal/captures/notifications`: interpreta, concilia e guarda "a confirmar". Sem rede, sem banco."""

from datetime import date
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import conversation, db
from app.config import get_settings
from app.domain.reconcile import Existente
from app.graph import nodes
from app.jobs import importer
from app.routes import captures
from app.routes import chat as chat_routes

USER = UUID("11111111-1111-1111-1111-111111111111")
WS = uuid4()
QUANDO = "2026-10-12T15:30:00+00:00"


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    monkeypatch.setenv("CAPTURA_ACEITA_TESTE", "false")  # o .env do staging liga; o teste parte do padrão
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def mundo(monkeypatch):
    v = {"limite": None, "gravados": [], "eventos": [], "conhecidos": set(), "hoje": 0,
         "acoes": [{"type": "create_expense", "amount_cents": 4590, "description": "mercado"}],
         "chamadas": 0, "existentes": []}

    async def perfil(_u):
        return {"id": USER, "timezone": "America/Sao_Paulo", "workspace_id": WS}

    async def limites(_sessao, *, kind="turn"):
        assert kind == "capture"
        return v["limite"]

    async def evento(**kw):
        v["eventos"].append(kw)

    async def soltar():
        return None

    async def finance_node(estado):
        v["chamadas"] += 1
        v["ultimo_texto"] = estado["text"]
        v["ultima_origem"] = estado.get("origem")
        return {"finance_actions": v["acoes"]}

    async def montar(ws, texto, acoes, hoje, forma=None):
        from app.routes.finance_draft import RascunhoOut
        return RascunhoOut(tipo="uma", params={"kind": "expense", "amount": str(acoes[0]["amount_cents"])},
                           perguntas=[], entendido="Gasto de R$ 45,90 · mercado")

    async def fetch(sql, *args):
        if "external_id = any" in sql:
            return [{"external_id": e} for e in v["conhecidos"] if e in args[1]]
        return []

    async def fetch_one(sql, *args):
        if "count(*)" in sql:
            return {"n": v["hoje"]}
        return None

    async def execute(sql, *args):
        assert "insert into public.captured_notifications" in sql
        v["gravados"].append(args)

    async def existentes(ws, de, ate, conta):
        return v["existentes"]

    monkeypatch.setattr(db, "chat_profile", perfil)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr(db, "record_ai_event", evento)
    monkeypatch.setattr(conversation, "check_limits", limites)
    monkeypatch.setattr(conversation, "soltar_reserva", soltar)
    monkeypatch.setattr(nodes, "finance_node", finance_node)
    monkeypatch.setattr(captures.finance_draft, "montar_rascunho", montar)
    monkeypatch.setattr(importer, "carregar_existentes", existentes)
    return v


def _cliente(autenticado=True):
    app = FastAPI()
    app.include_router(captures.router)
    chat_routes.install_error_handlers(app)
    if autenticado:
        app.dependency_overrides[chat_routes.current_user] = lambda: USER
    return TestClient(app)


def _item(ext="ext-00000001", pacote="com.nu.production", texto="Compra de R$ 45,90 aprovada em MERCADO SAO JOSE"):
    return {"external_id": ext, "package": pacote, "title": "Compra aprovada", "text": texto, "posted_at": QUANDO}


def _envia(*itens, cliente=None):
    return (cliente or _cliente()).post("/internal/captures/notifications",
                                        json={"timezone": "America/Sao_Paulo", "items": list(itens)})


def test_exige_token(mundo):
    assert _envia(_item(), cliente=_cliente(autenticado=False)).status_code == 401


def test_compra_vira_pendente_com_rascunho(mundo):
    r = _envia(_item())
    assert r.status_code == 200
    assert r.json() == {"aceitos": ["ext-00000001"], "novos": 1}
    (linha,) = mundo["gravados"]
    assert "pending" in linha and 4590 in linha
    assert mundo["eventos"][0]["kind"] == "capture"
    # a instrução e o banco vão na origem (fora do envelope); o envelope leva só a notificação
    assert "Nubank" in mundo["ultima_origem"] and "fatura fechada" in mundo["ultima_origem"].lower()
    assert "Registre" not in mundo["ultimo_texto"]
    assert "MERCADO SAO JOSE" in mundo["ultimo_texto"]


def test_sem_valor_em_reais_nao_chama_modelo(mundo):
    r = _envia(_item(texto="Seu código de acesso chegou"))
    assert r.json()["aceitos"] == ["ext-00000001"]
    assert mundo["chamadas"] == 0
    assert "ignored" in mundo["gravados"][0]


def test_pacote_fora_da_lista_e_ignorado_sem_modelo(mundo):
    _envia(_item(pacote="com.whatsapp"))
    assert mundo["chamadas"] == 0
    assert "ignored" in mundo["gravados"][0]


def test_pacote_de_teste_so_com_a_flag(mundo, monkeypatch):
    _envia(_item(pacote="com.android.shell"))
    assert mundo["chamadas"] == 0
    monkeypatch.setenv("CAPTURA_ACEITA_TESTE", "true")
    get_settings.cache_clear()
    _envia(_item(ext="ext-00000002", pacote="com.android.shell"))
    assert mundo["chamadas"] == 1


def test_modelo_sem_lancamento_vira_ignored(mundo):
    mundo["acoes"] = []
    r = _envia(_item(texto="Sua fatura fechou: R$ 1.234,56"))
    assert r.json()["aceitos"] == ["ext-00000001"]
    assert "ignored" in mundo["gravados"][0]
    assert mundo["eventos"]  # gastou modelo: grava o custo mesmo sem lançamento


def test_ja_conhecido_e_aceito_sem_gravar(mundo):
    mundo["conhecidos"] = {"ext-00000001"}
    r = _envia(_item())
    assert r.json() == {"aceitos": ["ext-00000001"], "novos": 0}
    assert mundo["gravados"] == [] and mundo["chamadas"] == 0


def test_ja_lancado_vira_duplicate_com_o_lancamento(mundo):
    achado = str(uuid4())
    mundo["existentes"] = [Existente(
        id=achado, kind="expense", amount_cents=4590, occurred_at=date(2026, 10, 12),
        description="mercado", merchant=None, account_id=None, counterparty_account_id=None,
        installment_plan_id=None, installment_no=None, plan_installments=None, rollover=False, previsto=False,
    )]
    _envia(_item())
    linha = mundo["gravados"][0]
    assert "duplicate" in linha and achado in [str(x) for x in linha]


def test_mesmo_valor_com_outro_nome_tambem_vira_duplicate(mundo):
    # "MERCADO SAO JOSE" na notificação × "pão" lançado pelo WhatsApp um dia antes: a cascata devolve
    # near_match/uncertain, e isso também sai da Hoje (vai para "Parecem já lançados")
    achado = str(uuid4())
    mundo["acoes"] = [{"type": "create_expense", "amount_cents": 4590, "description": "MERCADO SAO JOSE"}]
    mundo["existentes"] = [Existente(
        id=achado, kind="expense", amount_cents=4590, occurred_at=date(2026, 10, 11),
        description="pão", merchant=None, account_id=None, counterparty_account_id=None,
        installment_plan_id=None, installment_no=None, plan_installments=None, rollover=False, previsto=False,
    )]
    _envia(_item())
    linha = mundo["gravados"][0]
    assert "duplicate" in linha and achado in [str(x) for x in linha]


def test_sem_consentimento_responde_403_e_nao_aceita(mundo):
    mundo["limite"] = conversation.SEM_CONSENTIMENTO_IA
    r = _envia(_item())
    assert r.status_code == 403
    assert mundo["gravados"] == []


def test_rajada_para_e_devolve_o_que_gravou(mundo):
    mundo["limite"] = conversation.MUITAS
    r = _envia(_item(texto="Pix de R$ 10,00 enviado"), _item(ext="ext-00000002", texto="sem valor"))
    # o sem-valor não precisa de modelo e é gravado; o que precisava fica no aparelho
    assert r.status_code == 200
    assert r.json()["aceitos"] == ["ext-00000002"]


def test_teto_diario_deixa_no_aparelho(mundo):
    mundo["hoje"] = captures.MAX_POR_DIA
    r = _envia(_item())
    assert r.json() == {"aceitos": [], "novos": 0}
    assert mundo["chamadas"] == 0


def test_modelo_fora_do_ar_nao_aceita(mundo, monkeypatch):
    async def quebra(_e):
        raise RuntimeError("503")
    monkeypatch.setattr(nodes, "finance_node", quebra)
    r = _envia(_item())
    assert r.status_code == 200 and r.json()["aceitos"] == []


def test_tem_valor_so_estrutura():
    assert captures.tem_valor("Compra de R$ 45,90")
    assert captures.tem_valor("Pix recebido 1.200,00")
    assert not captures.tem_valor("Seu código é 123456")
    assert not captures.tem_valor("Bom dia!")
