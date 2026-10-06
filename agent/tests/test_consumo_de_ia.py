"""Contabilidade de tokens, Langfuse em toda chamada, máscara e a reserva atômica da cota."""

import asyncio
import logging
from types import SimpleNamespace
from uuid import UUID

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from app import conversation, db
from app.config import get_settings
from app.services import consumo, gemini, telemetry

USER = UUID("11111111-1111-1111-1111-111111111111")
WS = UUID("22222222-2222-2222-2222-222222222222")


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("SUPABASE_URL", "https://exemplo.supabase.co")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _resposta(modelo, entrada, saida, cache=0, raciocinio=0):
    msg = AIMessage(
        content="",
        usage_metadata={
            "input_tokens": entrada, "output_tokens": saida, "total_tokens": entrada + saida,
            "input_token_details": {"cache_read": cache},
            "output_token_details": {"reasoning": raciocinio},
        },
        response_metadata={"model_name": modelo},
    )
    return LLMResult(generations=[[ChatGeneration(message=msg)]])


def _chamar(coletor, run_id, resposta, **meta):
    coletor.on_chat_model_start({}, [[]], run_id=run_id, metadata=meta)
    coletor.on_llm_end(resposta, run_id=run_id)


# --- coletor ---------------------------------------------------------------


def test_coletor_soma_tokens_modelo_real_e_custo_exato():
    turno = consumo.abrir()
    _chamar(consumo.coletor, "a", _resposta("gemini-3.1-flash-lite", 1000, 200, 100, 50),
            papel="parse", no="finance_parse", prompt_versao="abc123")
    _chamar(consumo.coletor, "b", _resposta("gemini-3.7-flash", 2000, 100),
            papel="parse", reserva=True)
    t = turno.totais()
    assert (t["input_tokens"], t["output_tokens"], t["cached_tokens"], t["reasoning_tokens"]) == (
        3000, 300, 100, 50)
    # (1000*0,25 + 200*1,50)/1e6 + (2000*0,75 + 100*3,75)/1e6
    assert t["custo_usd"] == pytest.approx(0.00055 + 0.001875)
    primeira, segunda = t["chamadas"]
    assert primeira["modelo"] == "gemini-3.1-flash-lite" and primeira["no"] == "finance_parse"
    assert primeira["versao_prompt"] == "abc123" and primeira["reserva"] is False
    # o modelo REAL da reserva, não o do papel
    assert segunda["modelo"] == "gemini-3.7-flash" and segunda["reserva"] is True


def test_modelo_sem_preco_nao_inventa_custo():
    turno = consumo.abrir()
    _chamar(consumo.coletor, "a", _resposta("gemini-9-misterioso", 10, 10))
    assert turno.totais()["custo_usd"] is None
    assert gemini.custo_usd("gemini-3.7-flash-lite", 10, 10) is None  # prefixo não casa
    assert gemini.custo_usd("models/gemini-3.7-flash", 1_000_000, 0) == 0.75


def test_um_modelo_sem_preco_zera_o_custo_do_turno_todo():
    turno = consumo.abrir()
    _chamar(consumo.coletor, "a", _resposta("gemini-3.1-flash-lite", 10, 10))
    _chamar(consumo.coletor, "b", _resposta("gemini-9-misterioso", 10, 10))
    assert turno.totais()["custo_usd"] is None


def test_fora_de_turno_aberto_o_coletor_ignora():
    consumo._atual.set(None)
    _chamar(consumo.coletor, "a", _resposta("gemini-3.1-flash-lite", 10, 10))  # não levanta


def test_todo_cliente_do_gemini_leva_o_coletor():
    gemini._cache.clear()
    for papel in ("router", "gate", "batch"):
        assert consumo.coletor in gemini.llm(papel).callbacks


def test_versao_do_prompt_e_hash_curto_e_estavel():
    assert gemini.versao_do_prompt("a") == gemini.versao_do_prompt("a")
    assert gemini.versao_do_prompt("a") != gemini.versao_do_prompt("b")
    assert len(gemini.versao_do_prompt("a")) == 8


# --- Langfuse: máscara, canal, shutdown -------------------------------------


def test_mascara_dado_pessoal_e_preserva_dinheiro():
    m = telemetry.mascarar(data={"messages": [
        {"content": "joao@exemplo.com.br gastou R$ 1.234,56 (4500 centavos)"},
        {"content": "CPF 123.456.789-09, tel (35) 99874-4200, pix 123e4567-e89b-12d3-a456-426614174000"},
        {"content": "conta 123456789012"},
    ]})
    texto = str(m)
    for vazou in ("joao@", "123.456.789", "99874", "123e4567", "123456789012"):
        assert vazou not in texto
    assert "R$ 1.234,56" in texto and "4500" in texto


def test_mascara_nunca_levanta():
    class Estranho:
        def model_dump(self):
            raise RuntimeError("quebrou")

    assert telemetry.mascarar(data=Estranho()) == "[omitido]"


def test_cliente_langfuse_recebe_a_mascara(monkeypatch):
    import langfuse
    import langfuse.langchain

    recebido = {}

    class Falso:
        def __init__(self, **kw):
            recebido.update(kw)

    monkeypatch.setattr(langfuse, "Langfuse", Falso)
    monkeypatch.setattr(langfuse.langchain, "CallbackHandler", lambda: object())
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    get_settings.cache_clear()
    monkeypatch.setattr(telemetry, "_tentou", False)
    monkeypatch.setattr(telemetry, "_handler", None)
    assert telemetry.handler() is not None
    assert recebido["mask"] is telemetry.mascarar


def test_trace_usa_o_canal_real(monkeypatch):
    import langfuse

    visto = {}
    monkeypatch.setattr(telemetry, "handler", lambda: object())
    monkeypatch.setattr(langfuse, "propagate_attributes", lambda **kw: visto.update(kw))
    telemetry.trace(thread_id="t", user_id="u", channel="app")
    assert visto["trace_name"] == "app-message" and "app" in visto["tags"]
    assert "whatsapp" not in visto["tags"]


def test_shutdown_sem_cliente_nao_faz_nada_e_com_cliente_esvazia(monkeypatch):
    monkeypatch.setattr(telemetry, "_cliente", None)
    telemetry.shutdown()
    chamadas = []
    monkeypatch.setattr(telemetry, "_cliente", SimpleNamespace(
        flush=lambda: chamadas.append("flush"), shutdown=lambda: chamadas.append("shutdown")))
    telemetry.shutdown()
    assert chamadas == ["flush", "shutdown"]


# --- ai_events: reserva, uso, liberação --------------------------------------


class _Banco:
    """Postgres de mentira com o que `reservar_cota` encosta — e UM lock de advisory de verdade."""

    def __init__(self, maximo_mes=3, plano=True):
        self.linhas: list[dict] = []
        self.lock = asyncio.Lock()
        self.maximo_mes = maximo_mes
        self.plano = plano

    def pool(self):
        return SimpleNamespace(connection=lambda: _Conexao(self))


class _Conexao:
    def __init__(self, banco):
        self.banco = banco
        self.segurando = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def transaction(self):
        conexao = self

        class _Tx:
            async def __aenter__(self_):
                return None

            async def __aexit__(self_, *a):
                if conexao.segurando:
                    conexao.segurando = False
                    conexao.banco.lock.release()
                return False

        return _Tx()

    async def execute(self, sql, params=()):
        b = self.banco
        await asyncio.sleep(0)  # dá a vez aos outros: sem o lock, o teste acusa a corrida
        if "pg_advisory_xact_lock" in sql:
            await b.lock.acquire()
            self.segurando = True
            return _Cursor(None)
        if "delete from public.ai_events" in sql:
            return _Cursor(None)
        if "interval '1 hour'" in sql:
            return _Cursor({"n": sum(1 for r in b.linhas if r["user_id"] == params[0])})
        if "_plan_status" in sql:
            if not b.plano:
                return _Cursor(None)
            turnos = sum(1 for r in b.linhas if r["kind"] == "turn")
            return _Cursor({"plan": "free", "ai_messages_month": turnos,
                            "max_ai_messages_month": b.maximo_mes})
        if "plan_limits" in sql:
            return _Cursor({"limite": 15})
        if "kind = 'turn'" in sql and "count(*)" in sql:
            return _Cursor({"n": sum(1 for r in b.linhas if r["kind"] == "turn")})
        if "insert into public.ai_events" in sql:
            b.linhas.append({"user_id": params[0], "kind": params[3], "reserved": True,
                             "id": f"r{len(b.linhas)}"})
            return _Cursor({"id": b.linhas[-1]["id"]})
        raise AssertionError(f"SQL inesperado: {sql}")


class _Cursor:
    def __init__(self, linha):
        self.linha = linha

    async def fetchone(self):
        return self.linha


def _sessao():
    return {"user_id": USER, "workspace_id": WS, "channel": "app"}


async def test_dez_conversas_em_paralelo_com_tres_vagas_passam_so_tres(monkeypatch):
    banco = _Banco(maximo_mes=3)
    monkeypatch.setattr(db, "pool", banco.pool)
    resultados = await asyncio.gather(*(conversation.check_limits(_sessao()) for _ in range(10)))
    assert sum(r is None for r in resultados) == 3
    assert sum(bool(r) and "plano" in r for r in resultados) == 7
    assert sum(1 for r in banco.linhas if r["reserved"]) == 3


async def test_workspace_sem_linha_de_plano_aplica_o_limite_mais_restrito(monkeypatch, caplog):
    banco = _Banco(plano=False)
    banco.linhas = [{"user_id": USER, "kind": "turn", "reserved": False, "id": f"x{i}"}
                    for i in range(15)]
    monkeypatch.setattr(db, "pool", banco.pool)
    with caplog.at_level(logging.WARNING):
        barrado = await conversation.check_limits(_sessao())
    assert barrado and "15 mensagens" in barrado
    assert "sem linha em plan_status" in caplog.text


async def test_transcricao_so_confere_a_hora_nunca_o_mes(monkeypatch):
    banco = _Banco(maximo_mes=0)  # o mês já estourou
    monkeypatch.setattr(db, "pool", banco.pool)
    assert await conversation.check_limits(_sessao(), kind="transcription") is None
    assert banco.linhas[-1]["kind"] == "transcription"


async def test_rajada_por_hora_barra_antes_de_reservar(monkeypatch):
    banco = _Banco(maximo_mes=1000)
    banco.linhas = [{"user_id": USER, "kind": "turn", "reserved": False, "id": f"x{i}"}
                    for i in range(get_settings().max_parses_per_hour)]
    monkeypatch.setattr(db, "pool", banco.pool)
    assert await conversation.check_limits(_sessao(), kind="import") == conversation.MUITAS
    assert len(banco.linhas) == get_settings().max_parses_per_hour


async def test_record_ai_event_completa_a_reserva_em_vez_de_inserir(monkeypatch):
    sqls = []

    async def execute(sql, *params):
        sqls.append((sql, params))
        return 1

    monkeypatch.setattr(db, "execute", execute)
    consumo.abrir()
    consumo.guardar_reserva("r1")
    _chamar(consumo.coletor, "a", _resposta("gemini-3.1-flash-lite", 100, 20))
    await db.record_ai_event(user_id=USER, workspace_id=WS, channel="app", model="m",
                             confidence=None, result={})
    assert len(sqls) == 1
    sql, params = sqls[0]
    assert sql.lstrip().startswith("update public.ai_events") and "reserved = false" in sql
    assert 100 in params and 20 in params and "r1" in params
    assert consumo.reserva_atual() is None  # consumida: não completa duas vezes


async def test_record_ai_event_reserva_vencida_cai_no_insert(monkeypatch):
    sqls = []

    async def execute(sql, *params):
        sqls.append(sql)
        return 0 if sql.lstrip().startswith("update") else 1

    monkeypatch.setattr(db, "execute", execute)
    consumo.abrir()
    await db.record_ai_event(user_id=USER, workspace_id=WS, channel="app", model="m",
                             confidence=None, result={}, reserva_id="sumiu")
    assert [s.lstrip().split()[0] for s in sqls] == ["update", "insert"]


async def test_turno_sem_modelo_devolve_a_vaga(monkeypatch):
    liberadas = []

    async def liberar(rid):
        liberadas.append(rid)

    async def nao_grava(**kw):
        raise AssertionError("fast-path não grava ai_events")

    monkeypatch.setattr(conversation.db, "liberar_reserva", liberar)
    monkeypatch.setattr(conversation.db, "record_ai_event", nao_grava)
    consumo.abrir()
    consumo.guardar_reserva("r9")
    await conversation._audit(_sessao(), {}, {})
    assert liberadas == ["r9"]


async def test_audit_passa_o_uso_inclusive_o_de_fora_do_grafo(monkeypatch):
    gravados = []

    async def grava(**kw):
        gravados.append(kw)

    monkeypatch.setattr(conversation.db, "record_ai_event", grava)
    consumo.abrir()
    _chamar(consumo.coletor, "a", _resposta("gemini-3.7-flash", 50, 5), papel="gate")
    await conversation._audit(_sessao(), {}, {"llm_calls": 1})  # o SIM digitado, fora do grafo
    assert gravados[0]["uso"]["input_tokens"] == 50
    assert gravados[0]["uso"]["chamadas"][0]["papel"] == "gate"
