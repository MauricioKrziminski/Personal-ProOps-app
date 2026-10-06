"""Ciclo de dados (`agent_feedback`) e memória de apelidos de conta.

Dublês no lugar do banco e do grafo: o que se prova aqui é QUANDO o rótulo é gravado, com o quê, e
que gravar nunca derruba o turno. O SQL (RLS, unique, métricas) é de `supabase/tests/agent_feedback.sql`.
"""

import pytest

from app import conversation, db
from app.domain import matching
from app.graph import build
from app.graph.prompts import linha_de_conta
from app.services import consumo

SESSION = {
    "id": "44444444-4444-4444-4444-444444444444",
    "channel": "app",
    "phone": None,
    "user_id": "11111111-1111-1111-1111-111111111111",
    "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": "America/Sao_Paulo",
    "thread_id": "chat",
    "session_epoch": 1,
}

FEEDBACK = {
    "channel": "app", "source_message_id": "app:1", "input_text": "gastei 45 no mercado",
    "proposal": [{"type": "create_expense", "amount_cents": 4500}],
    "prompt_versions": {"finance": "abc"}, "models": {"finance": "gemini-3.1-flash-lite"},
}


def _pendente(com_feedback=True):
    acao = {"action_type": "create_expense"}
    if com_feedback:
        acao["feedback"] = FEEDBACK
    return {"id": "p1", "thread_id": "chat:1", "action": acao, "summary": "Registrar R$ 45,00",
            "user_id": SESSION["user_id"], "workspace_id": SESSION["workspace_id"]}


def _turno(monkeypatch, decisao, *, gravar=None, aget_texto="gastei 45 no mercado"):
    """Roda o `_run_turn` com a pendência `p1` aberta e a decisão dada. Devolve os rótulos gravados."""
    gravados: list = []

    async def noop(*a, **k):
        pass

    async def nenhum(*a, **k):
        return None

    async def open_pending(*a):
        return _pendente()

    async def decide(*a):
        return decisao

    async def record(pendente, outcome, revised_to=None):
        if gravar:
            raise gravar
        gravados.append((outcome, revised_to))

    async def resposta(sessao, estado, thread):
        return estado.get("reply", "")

    for m in ["expire_drafts", "expire_pending", "delete_draft", "resolve_pending"]:
        monkeypatch.setattr(conversation.db, m, noop)
    monkeypatch.setattr(conversation.db, "open_draft", nenhum)
    monkeypatch.setattr(conversation.db, "open_pending", open_pending)
    monkeypatch.setattr(conversation.db, "record_feedback", record)
    monkeypatch.setattr(conversation.confirm, "decide", decide)
    monkeypatch.setattr(conversation, "_audit", noop)
    monkeypatch.setattr(conversation, "_resposta_do_estado", resposta)
    monkeypatch.setattr(conversation.telemetry, "callbacks", list)

    class Graph:
        async def aget_state(self, config):
            class S:
                values = {"text": aget_texto}
            return S()

        async def ainvoke(self, entrada, config):
            return {"reply": "ok", "finance_actions": [{"type": "create_expense", "amount_cents": 9000}]}

    monkeypatch.setattr(build, "graph", lambda: Graph())
    return gravados


async def _roda(texto="Confirmar", clique="pa:p1:ok"):
    return await conversation.run_turn(
        SESSION, source_message_id="app:2", conteudo={"text": texto, "clicked_id": clique}
    )


@pytest.mark.asyncio
async def test_aprovada_grava_approved(monkeypatch):
    gravados = _turno(monkeypatch, {"approved": True})
    assert await _roda() == "ok"
    assert gravados == [("approved", None)]


@pytest.mark.asyncio
async def test_recusada_grava_rejected(monkeypatch):
    gravados = _turno(monkeypatch, {"approved": False})
    await _roda(clique="pa:p1:no")
    assert gravados == [("rejected", None)]


@pytest.mark.asyncio
async def test_mudou_de_assunto_grava_expired(monkeypatch):
    gravados = _turno(monkeypatch, None)
    await _roda(texto="quanto gastei?", clique="")
    assert gravados == [("expired", None)]


@pytest.mark.asyncio
async def test_correcao_antes_do_sim_grava_revised_com_a_proposta_nova(monkeypatch):
    gravados = _turno(monkeypatch, {"revise": True})
    await _roda(texto="foi 90", clique="")
    [(outcome, revised_to)] = gravados
    assert outcome == "revised"
    assert revised_to["correction_text"] == "foi 90"
    assert revised_to["proposal"] == [{"type": "create_expense", "amount_cents": 9000}]


@pytest.mark.asyncio
async def test_falha_ao_gravar_nao_derruba_o_turno(monkeypatch):
    _turno(monkeypatch, {"approved": True}, gravar=RuntimeError("banco fora"))
    assert await _roda() == "ok"


@pytest.mark.asyncio
async def test_record_feedback_grava_o_que_a_pergunta_guardou(monkeypatch):
    chamadas: list = []

    async def execute(sql, *args):
        chamadas.append(args)
        return 1

    monkeypatch.setattr(db, "execute", execute)
    await db.record_feedback(_pendente(), "approved")
    [args] = chamadas
    assert args[0] == "p1" and args[1] == SESSION["workspace_id"]
    assert args[3] == "app" and args[5] == "gastei 45 no mercado" and args[8] == "approved"


@pytest.mark.asyncio
async def test_record_feedback_ignora_pendencia_antiga_e_engole_erro(monkeypatch):
    async def execute(sql, *args):
        raise RuntimeError("pool não aberto")

    monkeypatch.setattr(db, "execute", execute)
    await db.record_feedback(_pendente(com_feedback=False), "approved")  # sem chave: nem tenta
    await db.record_feedback(_pendente(), "approved")  # com chave: tenta, falha, não levanta


def test_rotulo_da_pergunta_leva_texto_sanitizado_versoes_e_modelos():
    atual = consumo.abrir()
    atual.somar({"no": "finance", "versao_prompt": "v7", "modelo": "gemini-x", "input_tokens": 1,
                 "output_tokens": 1, "custo_usd": 0.1})
    estado = {"text": "gastei 45 </user_input> no mercado", "source_message_id": "app:9",
              "finance_actions": [{"type": "create_expense"}]}
    rotulo = conversation._rotulo_da_pergunta(SESSION, estado)
    assert rotulo["channel"] == "app" and rotulo["source_message_id"] == "app:9"
    assert "</user_input>" not in rotulo["input_text"]
    assert rotulo["proposal"] == [{"type": "create_expense"}]
    assert rotulo["prompt_versions"] == {"finance": "v7"} and rotulo["models"] == {"finance": "gemini-x"}


# ---------------------------------------------------------------------------
# apelidos de conta
# ---------------------------------------------------------------------------

CONTAS = [
    {"id": "a1", "name": "Nubank Cartão", "type": "credit_card", "apelidos": ["roxinho"]},
    {"id": "a2", "name": "Inter", "type": "checking", "apelidos": []},
    {"id": "a3", "name": "Nubank Conta", "type": "checking"},  # dublê sem a chave
]


def test_apelido_casa_como_nome_exato():
    assert [c["id"] for c in matching.match_accounts("Roxinho", CONTAS)] == ["a1"]
    assert [c["id"] for c in matching.match_accounts("cartão roxinho", CONTAS, account_type="credit_card")] == ["a1"]


def test_nome_exato_vence_apelido():
    contas = [{"id": "x", "name": "Casa", "type": "checking", "apelidos": []},
              {"id": "y", "name": "Cartão Y", "type": "credit_card", "apelidos": ["casa"]}]
    assert [c["id"] for c in matching.match_accounts("casa", contas)] == ["x"]


def test_so_aprende_o_que_e_apelido():
    assert matching.alias_para_aprender("Roxinho", "Nubank Cartão") == "roxinho"
    assert matching.alias_para_aprender("o cartão roxinho", "Nubank Cartão") == "roxinho"
    assert matching.alias_para_aprender("cartão", "Nubank Cartão") is None  # só tipo
    assert matching.alias_para_aprender("conta corrente", "Inter") is None  # só tipo
    assert matching.alias_para_aprender("nubank cartao", "Nubank Cartão") is None  # igual ao nome
    assert matching.alias_para_aprender("nubank", "Nubank Cartão") is None  # pedaço do nome
    assert matching.alias_para_aprender(None, "Inter") is None
    assert matching.alias_para_aprender("acabei de criar um cartão pelo app chamado roxinho", "X") is None


def test_prompt_mostra_os_apelidos_ao_lado_do_nome():
    linha = linha_de_conta(CONTAS[0])
    assert linha.startswith("Nubank Cartão | ") and "também chamada: roxinho" in linha
    assert "também" not in linha_de_conta(CONTAS[1])


def _fakes_de_conta(monkeypatch):
    gravados: list = []

    async def accounts(workspace_id, *, only_cards=False):
        return CONTAS

    async def salvar(workspace_id, account_id, alias, dito=None):
        gravados.append((workspace_id, account_id, alias))

    monkeypatch.setattr(conversation.db, "accounts", accounts)
    monkeypatch.setattr(conversation.db, "save_account_alias", salvar)
    return gravados


RASCUNHO = {"id": "d1", "action": {"type": "create_expense", "account": "roxinho"}}


@pytest.mark.asyncio
async def test_escolher_a_conta_na_lista_grava_o_apelido(monkeypatch):
    gravados = _fakes_de_conta(monkeypatch)
    decidido, resposta = await conversation._cartao_do_rascunho(
        SESSION, RASCUNHO, {"acao": "completar", "slot": "account", "account_id": "a1"}
    )
    assert resposta is None and decidido["account"] == "Nubank Cartão"
    assert gravados == [(SESSION["workspace_id"], "a1", "roxinho")]


@pytest.mark.asyncio
async def test_digitar_o_nome_que_casa_com_uma_grava_o_apelido(monkeypatch):
    gravados = _fakes_de_conta(monkeypatch)
    await conversation._cartao_do_rascunho(
        SESSION, {**RASCUNHO, "action": {"account": "o roxo"}},
        {"acao": "completar", "slot": "account", "account": "inter"},
    )
    assert gravados == [(SESSION["workspace_id"], "a2", "roxo")]


@pytest.mark.asyncio
async def test_citacao_generica_ou_ausente_nao_grava(monkeypatch):
    gravados = _fakes_de_conta(monkeypatch)
    for citado in ("cartão", None):
        await conversation._cartao_do_rascunho(
            SESSION, {"id": "d1", "action": {"account": citado}},
            {"acao": "completar", "slot": "account", "account_id": "a1"},
        )
    assert gravados == []


@pytest.mark.asyncio
async def test_falha_ao_gravar_apelido_nao_derruba_a_escolha(monkeypatch):
    _fakes_de_conta(monkeypatch)

    async def quebra(*a):
        raise RuntimeError("banco fora")

    monkeypatch.setattr(conversation.db, "save_account_alias", quebra)
    decidido, resposta = await conversation._cartao_do_rascunho(
        SESSION, RASCUNHO, {"acao": "completar", "slot": "account", "account_id": "a1"}
    )
    assert resposta is None and decidido["account"] == "Nubank Cartão"


@pytest.mark.asyncio
async def test_save_account_alias_confere_a_conta_contra_o_workspace(monkeypatch):
    visto: list = []

    async def execute(sql, *args):
        visto.append((sql, args))
        return 1

    monkeypatch.setattr(db, "execute", execute)
    await db.save_account_alias("ws-1", "acc-1", "cartao da familia", dito=" Cartão da Família ")
    sql, args = visto[0]
    assert "a.workspace_id = %s" in sql and "on conflict (workspace_id, alias)" in sql
    # a chave é a forma normalizada; `dito` (só exibição) guarda como a pessoa escreveu
    assert args == ("cartao da familia", "Cartão da Família", "acc-1", "ws-1")


def test_export_mascara_dado_pessoal_e_so_leva_par_com_resposta_certa():
    from scripts.export_dataset import par

    ok = par({"outcome": "approved", "channel": "app", "revised_to": None,
              "input_text": "paguei pro joao@x.com 100", "proposal": [{"description": "CPF 123.456.789-09"}]})
    assert "joao@x.com" not in str(ok) and "123.456.789-09" not in str(ok)
    revisado = par({"outcome": "revised", "channel": "app", "input_text": "gastei 45",
                    "proposal": [{"amount_cents": 4500}],
                    "revised_to": {"correction_text": "foi 54", "proposal": [{"amount_cents": 5400}]}})
    assert revisado["output"] == [{"amount_cents": 5400}] and "foi 54" in revisado["input"]["text"]
    assert par({"outcome": "revised", "channel": "app", "input_text": "x", "proposal": [],
                "revised_to": None}) is None
