"""Lembrete ligado a um lançamento e canal do Perfil (16/10/2026).

Pedido do dono do produto: lembrete que cita um lançamento que existe pergunta "ligado ou solto?" (dito um dos
dois, faz só ele); o canal padrão é o do Perfil (os dois, ou só o push) e a pessoa pode mudá-lo antes do SIM.
"""

import pytest

from app.domain import lembrete
from app.graph import nodes
from app.graph.policy import describe_for_confirmation
from app.graph.schemas import NotesAction, ResourceAction, ResourcePlan

SP = "America/Sao_Paulo"
ALUGUEL = {"alvo": "recurring", "id": "r-1", "nome": "Aluguel", "regra": "todo dia 20", "vence": "2026-10-20"}
DAS = {"alvo": "recurring", "id": "r-2", "nome": "DAS", "regra": "todo dia 20", "vence": "2026-10-20"}


@pytest.mark.parametrize("push,zap,canal", [(True, True, "both"), (True, False, "push"),
                                            (False, True, "whatsapp"), (False, False, "both")])
def test_canal_do_perfil(push, zap, canal):
    assert lembrete.canal_do_perfil(push, zap) == canal


def test_canal_dito_so_vale_o_que_existe():
    assert lembrete.canal_dito("Both") == "both"
    assert lembrete.canal_dito("sms") is None and lembrete.canal_dito(None) is None


def test_nome_casa_pelo_termo_e_pelo_texto_sem_palavra_solta():
    assert lembrete.casa_com_lembrete("DAS", "das", "pagar o DAS")
    assert lembrete.casa_com_lembrete("Conta de luz", "luz", "pagar a luz")
    assert lembrete.casa_com_lembrete("Aluguel", None, "pagar o aluguel")
    # "das" sem o modelo dizer que é a conta: preposição, não a conta DAS
    assert not lembrete.casa_com_lembrete("DAS", None, "lembrar das crianças")
    assert not lembrete.casa_com_lembrete("Aluguel", "academia", "pagar a academia")


def test_sigla_curta_casa_so_escrita_como_no_cadastro():
    assert lembrete.casa_com_lembrete("DAS", None, "pagar o DAS")
    assert lembrete.casa_com_lembrete("DAS", None, "pagar DAS")
    assert not lembrete.casa_com_lembrete("DAS", None, "lembrar das crianças")


@pytest.mark.parametrize("vinculo,texto,fica", [
    ("lancamento", "me lembra de pagar o DAS todo dia 20 às 9h", None),  # pedir o lembrete não é dizer "ligado"
    ("lancamento", "cria um lembrete vinculado ao lançamento DAS às 9h", "lancamento"),
    ("lancamento", "voce consegue criar um lembrete vinculado ao lançamento DAS?", "lancamento"),
    ("lancamento", "não vincula ao lançamento", None),
    ("solto", "me lembra do aluguel, solto, sem ligar a lançamento nenhum", "solto"),
    ("solto", "não vincula ao lançamento", "solto"),
    ("solto", "me lembra do aluguel às 8h", None),
    (None, "vinculado ao DAS", None),
])
def test_vinculo_so_vale_se_a_frase_sustenta(vinculo, texto, fica):
    assert lembrete.vinculo_ancorado(vinculo, texto) == fica


def test_ligado_dito_so_pergunta_a_hora():
    sem_hora = NotesAction(type="create_reminder", content="DAS", vinculo="lancamento", remind_at="2026-10-20")
    assert nodes._prepara_lembrete(sem_hora, SP) == "Que horas eu te lembro de *DAS*?"
    com_hora = NotesAction(type="create_reminder", content="DAS", vinculo="lancamento",
                           remind_at="2026-10-16T09:00:00", channel="sms", dias_antes=90)
    assert nodes._prepara_lembrete(com_hora, SP) is None
    assert com_hora.channel is None and com_hora.dias_antes is None  # o que não existe não vale


def test_frase_do_lembrete_ligado_e_do_solto():
    acao = NotesAction(type="create_reminder", content="DAS", remind_at="2026-10-20T09:00:00",
                       recurrence="FREQ=MONTHLY;BYMONTHDAY=20")
    ligado = {"canal": "both", "vinculo": DAS, "dias_antes": 0, "hora": "09:00"}
    assert describe_for_confirmation(acao, ligado) == (
        "criar o lembrete vinculado ao lançamento *DAS* (todo dia 20): te aviso no dia de cada vencimento, às 09:00, "
        "por notificação no app e WhatsApp")
    avulso = {**ligado, "vinculo": {"alvo": "transaction", "id": "t", "nome": "Dentista", "vence": "2026-10-22"},
              "dias_antes": 2, "canal": "whatsapp"}
    assert describe_for_confirmation(acao, avulso).endswith("te aviso 2 dias antes do vencimento, às 09:00, por WhatsApp")
    assert describe_for_confirmation(acao, {"canal": "push", "solto": True}) == (
        "criar o lembrete *DAS* para 20/10/2026 às 09:00, repete todo dia 20, por notificação no app")


@pytest.fixture
def portao(monkeypatch):
    """O `gate` de verdade, com `interrupt` respondendo um roteiro e guardando as perguntas."""
    perguntas, respostas = [], []

    def interrupt(payload):
        perguntas.append(payload)
        return respostas.pop(0)

    monkeypatch.setattr(nodes, "interrupt", interrupt)
    return perguntas, respostas


def _estado(acao: NotesAction, alvo: dict) -> dict:
    return {"text": "x", "timezone": SP, "results": [], "notes_actions": [acao.model_dump(mode="json")],
            "targets": [alvo]}


async def _ate_o_fim(estado: dict) -> dict:
    """O `after_gate`: a escolha do vínculo grava os alvos e o gate roda de novo até o SIM."""
    ret = await nodes.gate(estado)
    while ret.get("revision_pending"):
        estado = {**estado, **ret}
        ret = await nodes.gate(estado)
    return ret


def _lembrete(**k):
    return NotesAction(type="create_reminder", content="aluguel", remind_at="2026-10-20T09:00:00",
                       recurrence="FREQ=MONTHLY;BYMONTHDAY=20", **k)


@pytest.mark.asyncio
async def test_lancamento_que_existe_pergunta_ligado_ou_solto(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:r-1"}, True]
    ret = await _ate_o_fim(_estado(_lembrete(), {"canal": "both", "vinculos": [ALUGUEL]}))
    vinculo, sim = perguntas
    assert vinculo["purpose"] == "lembrete_vinculo"
    assert [o["id"] for o in vinculo["options"]] == ["vinculo:r-1", "vinculo:solto"]
    assert sim["summary"].startswith("criar o lembrete vinculado ao lançamento *Aluguel* (todo dia 20)")
    assert ret["approved"] and ret["targets"][0]["vinculo"]["id"] == "r-1"
    assert ret["targets"][0]["dias_antes"] == 0 and ret["targets"][0]["hora"] == "09:00"


@pytest.mark.asyncio
async def test_escolher_solto_cria_o_lembrete_comum(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:solto"}, True]
    ret = await _ate_o_fim(_estado(_lembrete(), {"canal": "push", "vinculos": [ALUGUEL]}))
    assert perguntas[1]["summary"] == "criar o lembrete *aluguel* para 20/10/2026 às 09:00, repete todo dia 20, " \
                                      "por notificação no app"
    assert ret["targets"][0]["solto"] and "vinculo" not in ret["targets"][0]


@pytest.mark.asyncio
async def test_ligado_dito_com_um_lancamento_nao_pergunta(portao):
    perguntas, respostas = portao
    respostas += [True]
    ret = await _ate_o_fim(_estado(_lembrete(vinculo="lancamento"), {"canal": "both", "vinculos": [ALUGUEL]}))
    assert len(perguntas) == 1 and perguntas[0]["kind"] == "confirmation"
    assert ret["targets"][0]["vinculo"]["id"] == "r-1"


@pytest.mark.asyncio
async def test_ligado_dito_com_dois_pergunta_qual_sem_oferecer_solto(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:r-2"}, True]
    await _ate_o_fim(_estado(_lembrete(vinculo="lancamento"), {"canal": "both", "vinculos": [ALUGUEL, DAS]}))
    assert [o["id"] for o in perguntas[0]["options"]] == ["vinculo:r-1", "vinculo:r-2"]


@pytest.mark.asyncio
async def test_dias_antes_sai_do_dia_pedido_contra_o_vencimento(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:r-1"}, True]
    acao = NotesAction(type="create_reminder", content="aluguel", remind_at="2026-10-18T08:30:00",
                       recurrence="FREQ=MONTHLY;BYMONTHDAY=18")  # "todo dia 18": dito
    ret = await _ate_o_fim(_estado(acao, {"canal": "both", "vinculos": [ALUGUEL]}))
    assert ret["targets"][0]["dias_antes"] == 2 and ret["targets"][0]["hora"] == "08:30"
    assert "2 dias antes de cada vencimento, às 08:30" in perguntas[1]["summary"]


@pytest.mark.asyncio
async def test_data_de_lembrete_de_uma_vez_nao_vira_dias_antes(portao):
    # "vinculado ao aluguel às 8h": a data (amanhã) foi o modelo que preencheu, não a pessoa
    perguntas, respostas = portao
    respostas += [True]
    acao = NotesAction(type="create_reminder", content="aluguel", remind_at="2026-10-17T08:00:00", vinculo="lancamento")
    ret = await _ate_o_fim(_estado(acao, {"canal": "both", "vinculos": [ALUGUEL]}))
    assert ret["targets"][0]["dias_antes"] == 0
    assert "no dia de cada vencimento, às 08:00" in perguntas[0]["summary"]


@pytest.mark.asyncio
async def test_alvo_do_lembrete_congela_canal_e_avisa_ligado_sem_lancamento(monkeypatch):
    async def canal(user_id):
        return "push"

    async def nada(*a, **k):
        return []

    monkeypatch.setattr(nodes.notes_tools, "canal_padrao", canal)
    monkeypatch.setattr(nodes.notes_tools, "lancamentos_do_lembrete", nada)
    estado = {"user_id": "u", "workspace_id": "w", "timezone": SP}
    assert await nodes._alvo_do_lembrete(estado, _lembrete(channel="whatsapp"), {}) == {"canal": "whatsapp"}
    assert await nodes._alvo_do_lembrete(estado, _lembrete(vinculo="solto"), {}) == {"canal": "push", "solto": True}
    erro = await nodes._alvo_do_lembrete(estado, _lembrete(vinculo="lancamento", search_term="DAS"), {})
    assert "Não achei lançamento *DAS*" in erro["correction_error"]


def test_correcao_antes_do_sim_leva_o_lembrete_inteiro():
    from app.conversation import _lembretes_da_proposta

    valores = {"finance_actions": [{"type": "create_expense"}],
               "notes_actions": [_lembrete().model_dump(mode="json"),
                                 NotesAction(type="create_note", content="x").model_dump(mode="json")],
               "targets": [{}, {"vinculo": DAS, "canal": "push"}, {}]}
    (item,) = _lembretes_da_proposta(valores, "criar o lembrete vinculado ao lançamento *DAS*")
    assert item["content"] == "aluguel" and item["recurrence"] == "FREQ=MONTHLY;BYMONTHDAY=20"
    assert item["vinculo"] == "lancamento" and item["search_term"] == "DAS"
    assert item["_pergunta"] == "Confirma criar o lembrete vinculado ao lançamento *DAS*?"


def test_resposta_herda_canal_e_vinculo_do_pendente():
    pendente = {**_lembrete(channel="both", vinculo="lancamento", search_term="DAS").model_dump(mode="json"),
                "_pergunta": "Que horas?"}
    (a,) = nodes._com_campos_do_lembrete([NotesAction(type="create_reminder", remind_at="T09:00")], [pendente])
    assert (a.content, a.channel, a.vinculo, a.search_term) == ("aluguel", "both", "lancamento", "DAS")


@pytest.mark.asyncio
async def test_lembrete_pedido_como_cadastro_vai_para_o_no_de_notas(monkeypatch):
    plano = ResourcePlan(actions=[ResourceAction(type="resource_create", resource="reminders", name="DAS")])

    class Modelo:
        async def ainvoke(self, _):
            return plano

    async def contas(state):
        return []

    async def notas(state):
        return {"notes_actions": [{"type": "create_reminder", "content": "DAS"}], "notes_draft": [], "llm_calls": 1}

    monkeypatch.setattr(nodes.ia, "structured", lambda *a, **k: Modelo())
    monkeypatch.setattr(nodes, "_contas_do_turno", contas)
    monkeypatch.setattr(nodes, "notes_node", notas)
    ret = await nodes.resource_node({"text": "lembrete do DAS", "timezone": SP, "results": [], "domains": ["cadastros"],
                                     "user_id": "u", "workspace_id": "w", "source_message_id": "m"})
    assert ret["resource_actions"] == [] and ret["notes_actions"][0]["content"] == "DAS"
    assert ret["llm_calls"] == 2


@pytest.mark.asyncio
async def test_escolha_do_vinculo_vai_ao_checkpoint_antes_do_sim(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:r-1"}]
    ret = await nodes.gate(_estado(_lembrete(), {"canal": "both", "vinculos": [ALUGUEL]}))
    assert ret["revision_pending"] and not ret["approved"]
    assert ret["targets"][0]["vinculo"]["id"] == "r-1" and len(perguntas) == 1


@pytest.mark.asyncio
async def test_listar_lembretes_pelo_cadastro_vira_a_lista_completa(monkeypatch):
    plano = ResourcePlan(actions=[ResourceAction(type="resource_list", resource="reminders")])

    class Modelo:
        async def ainvoke(self, _):
            return plano

    async def contas(state):
        return []

    monkeypatch.setattr(nodes.ia, "structured", lambda *a, **k: Modelo())
    monkeypatch.setattr(nodes, "_contas_do_turno", contas)
    ret = await nodes.resource_node({"text": "quais meus lembretes?", "timezone": SP, "results": [],
                                     "domains": ["cadastros"], "user_id": "u", "workspace_id": "w",
                                     "source_message_id": "m"})
    assert ret["resource_actions"] == [] and ret["notes_actions"][0]["type"] == "query_reminders"


@pytest.mark.asyncio
async def test_gasto_de_uma_vez_diz_no_vencimento(portao):
    perguntas, respostas = portao
    respostas += [{"approved": True, "candidate_id": "vinculo:solto"}]
    dentista = {"alvo": "transaction", "id": "t-1", "nome": "Dentista", "regra": None, "vence": "2026-10-25"}
    await nodes.gate(_estado(_lembrete(), {"canal": "both", "vinculos": [dentista]}))
    assert "(te aviso no vencimento)" in perguntas[0]["summary"] and "(vence 25/10/2026)" in perguntas[0]["summary"]
