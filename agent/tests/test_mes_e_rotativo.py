"""Mudar o mês financeiro e ligar o rotativo pelo agente.

Duas lacunas de paridade que não estavam declaradas: `useSetCycleCloseDay` e os
campos de rotativo do cartão. Nenhuma das duas custou schema — `resource` é
string validada contra o `CATALOG`, então recurso e coluna novos são de graça.
"""

import pytest

from app.graph.schemas import ResourceAction, ResourceActionType as Op, ResourceField
from app.tools import resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = "22222222-2222-2222-2222-222222222222"
DONO = "11111111-1111-1111-1111-111111111111"
OUTRO = "99999999-9999-9999-9999-999999999999"


def _ctx(user_id=DONO):
    return ExecContext(user_id, WS, None, "America/Sao_Paulo", "meu mes fecha dia 10", "app:1")


def _acao(dia="10"):
    return ResourceAction(
        type=Op.UPDATE, resource="mes",
        fields=[ResourceField(name="cycle_close_day", value=dia)],
    )


def _banco(monkeypatch, *, owner=DONO, atualiza=True):
    escritas = []

    async def fetch_one(sql, *args):
        if "select owner_id" in sql:
            return {"owner_id": owner, "cycle_close_day": None, "row_version": "42"}
        if sql.strip().startswith("update public.workspaces"):
            escritas.append(args)
            return {"cycle_close_day": args[0]} if atualiza else None
        return None

    async def cycle(ws, dia):
        from datetime import date
        return {"ini": date(2026, 8, 11), "fim": date(2026, 9, 10),
                "close_day": 10, "rotulo": "setembro", "dias_ate_o_fim": 1}

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources.db, "cycle", cycle)
    return escritas


# --- o mês -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_dono_muda_o_dia_e_ve_as_bordas_novas(monkeypatch):
    escritas = _banco(monkeypatch)
    prep = await resources.prepare(_ctx(), _acao("10"))
    assert "dia 10" in prep["summary"]

    ctx = _ctx()
    ctx.target = {"prepared": prep}
    r = await resources.execute(ctx, _acao("10"))
    assert "fecha todo dia 10" in r.message
    assert "11/08/2026" in r.message and "10/09/2026" in r.message, "diz as bordas novas"
    assert escritas and escritas[0][0] == 10


@pytest.mark.asyncio
async def test_a_PALAVRA_ultimo_volta_para_o_ultimo_dia_do_mes(monkeypatch):
    _banco(monkeypatch)
    acao = ResourceAction(type=Op.UPDATE, resource="mes",
                          fields=[ResourceField(name="cycle_close_day", value="ultimo")])
    prep = await resources.prepare(_ctx(), acao)
    assert "último dia" in prep["summary"]
    assert "cycle_close_day_ultimo" not in prep["values"], "a marca não chega ao UPDATE"


@pytest.mark.asyncio
async def test_campo_VAZIO_pergunta_o_dia_em_vez_de_escolher(monkeypatch):
    """⚠️ Este teste já afirmou o contrário — e o contrário era o defeito.

    Vazio significava as duas coisas: "o usuário pediu o padrão" e "o usuário
    não disse nada". O modelo manda vazio nos dois casos, então "muda meu ciclo",
    sem dia nenhum, virava *"⚠️ Confirma seu mês volta a fechar no último dia do
    mês?"* — o agente escolhia o valor e pedia para confirmar a escolha dele.
    Medido pelo `probe_pergunta_ou_supoe.py` em 11/09/2026.
    """
    _banco(monkeypatch)
    acao = ResourceAction(type=Op.UPDATE, resource="mes",
                          fields=[ResourceField(name="cycle_close_day", value=None)])
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), acao)
    assert "que dia" in str(err.value).lower()


@pytest.mark.asyncio
async def test_quem_nao_e_dono_nao_muda_o_mes_de_todo_mundo(monkeypatch):
    """O agente IGNORA RLS: sem esta checagem, um membro move a régua de todos."""
    escritas = _banco(monkeypatch, owner=OUTRO)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(user_id=DONO), _acao("10"))
    assert "dono" in str(err.value).lower()
    assert not escritas


@pytest.mark.asyncio
async def test_o_update_repete_o_dono_no_where(monkeypatch):
    """A checagem do prepare vale para o instante da proposta, não o da escrita."""
    escritas = _banco(monkeypatch)
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _acao("10"))}
    await resources.execute(ctx, _acao("10"))
    assert DONO in [str(a) for a in escritas[0]], "owner_id tem que estar no WHERE"
    assert "42" in [str(a) for a in escritas[0]], "e a versão da linha também"


@pytest.mark.asyncio
async def test_proposta_velha_nao_escreve(monkeypatch):
    _banco(monkeypatch, atualiza=False)
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _acao("10"))}
    r = await resources.execute(ctx, _acao("10"))
    assert r.read_only and "de novo" in r.message


@pytest.mark.asyncio
async def test_o_mes_nao_se_apaga(monkeypatch):
    _banco(monkeypatch)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), ResourceAction(
            type=Op.DELETE, resource="mes",
            fields=[ResourceField(name="cycle_close_day", value="10")]))
    assert "apagar" in str(err.value)


@pytest.mark.asyncio
async def test_criar_o_mes_e_o_mesmo_que_mudar_o_dia(monkeypatch):
    """⚠️ CREATE era recusado, e a recusa era um beco sem saída.

    O modelo manda `resource_create` para "muda meu ciclo", e a resposta era
    "não dá para criar" — sobre uma operação que o usuário não pediu. Definir o
    dia é a única coisa que existe aqui; quem não disse o dia recebe a pergunta.
    """
    _banco(monkeypatch)
    prep = await resources.prepare(_ctx(), ResourceAction(
        type=Op.CREATE, resource="mes",
        fields=[ResourceField(name="cycle_close_day", value="10")]))
    assert "dia 10" in prep["summary"]


@pytest.mark.parametrize("dia", ["0", "29", "31", "banana"])
def test_dia_fora_de_1_a_28_e_recusado(dia):
    """29, 30 e 31 não existem em fevereiro — o ciclo mudaria de tamanho."""
    with pytest.raises(Level1Error):
        resources.validate_fields(_acao(dia))


@pytest.mark.parametrize("dia,esperado", [("1", 1), ("28", 28), ("10", 10)])
def test_dias_validos_passam(dia, esperado):
    assert resources.validate_fields(_acao(dia))["cycle_close_day"] == esperado


# --- o rotativo ------------------------------------------------------------

def _cartao(campo, valor):
    return ResourceAction(type=Op.UPDATE, resource="cards", name="nubank",
                          fields=[ResourceField(name=campo, value=valor)])


def test_rotativo_auto_e_booleano():
    assert resources.validate_fields(_cartao("rotativo_auto", "true"))["rotativo_auto"] is True
    assert resources.validate_fields(_cartao("rotativo_auto", "false"))["rotativo_auto"] is False


@pytest.mark.parametrize("entrada,esperado", [
    ("15,5", "0.155"), ("12,876", "0.12876"), ("15.5%", "0.155"), ("0.155", "0.155"),
])
def test_taxa_do_rotativo_aceita_porcento(entrada, esperado):
    assert resources.validate_fields(_cartao("rotativo_rate_monthly", entrada))["rotativo_rate_monthly"] == esperado


def test_taxa_do_rotativo_pode_ficar_vazia():
    """`null` = não estimar juros, e a tela diz isso. Apagar é operação legítima."""
    assert resources.validate_fields(_cartao("rotativo_rate_monthly", None))["rotativo_rate_monthly"] is None


# --- adiar a fatura --------------------------------------------------------

def _roll(nome="nubank"):
    return ResourceAction(type=Op.ROLL, resource="cards", name=nome)


def _fatura(monkeypatch, *, vencida=True, aberto=135000, resultado=None):
    chamadas = []

    async def fetch_one(sql, *args):
        if "invoice_open_cents" in sql and "card_invoices" in sql:
            return {"id": "fat-1", "due_date": "2026-07-10", "card_name": "Nubank",
                    "aberto": aberto, "vencida": vencida}
        if "roll_invoice" in sql:
            chamadas.append(args)
            return {"r": resultado or {
                "principal_cents": 135000, "juros_cents": 17383, "iof_cents": 856,
                "taxa_usada": "0.12876", "juros_estimados": True, "sem_taxa": False,
                "segundo_ciclo": False, "destino_id": "fat-2",
                "destino_vence_em": "2026-08-10",
            }}
        return None

    async def owned(table, row_id, ws):
        return None

    monkeypatch.setattr(resources.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resources, "ensure_owned", owned)
    return chamadas


@pytest.mark.asyncio
async def test_adiar_diz_o_principal_e_avisa_dos_juros(monkeypatch):
    """A frase do SIM não promete o número dos juros, mas avisa que eles vêm.

    `roll_invoice` só devolve juros/IOF depois de executar, e recalcular a
    fórmula aqui seria a segunda cópia da regra. O app faz igual.
    """
    _fatura(monkeypatch)
    prep = await resources.prepare(_ctx(), _roll())
    assert "1.350,00" in prep["summary"]
    assert "juros" in prep["summary"] and "IOF" in prep["summary"]
    assert "Nubank" in prep["summary"] and "10/07/2026" in prep["summary"]


@pytest.mark.asyncio
async def test_adiar_conta_o_que_entrou_na_fatura_nova(monkeypatch):
    chamadas = _fatura(monkeypatch)
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _roll())}
    r = await resources.execute(ctx, _roll())
    assert chamadas, "chamou roll_invoice"
    assert "1.350,00" in r.message           # principal
    assert "173,83" in r.message             # juros
    assert "12,876%" in r.message            # a taxa que os gerou
    assert "8,56" in r.message               # IOF
    assert "10/08/2026" in r.message         # para onde foi


@pytest.mark.asyncio
async def test_fatura_que_ainda_nao_venceu_nao_e_adiada(monkeypatch):
    """Mesma regra da tela: adiar só vale depois do vencimento."""
    _fatura(monkeypatch, vencida=False)
    with pytest.raises(Level1Error) as err:
        await resources.prepare(_ctx(), _roll())
    assert "não venceu" in str(err.value)


@pytest.mark.asyncio
async def test_sem_taxa_o_agente_diz_que_nao_estimou(monkeypatch):
    """Não inventar juros é regra: sem histórico e sem taxa, o app não estima."""
    _fatura(monkeypatch, resultado={
        "principal_cents": 135000, "juros_cents": 0, "iof_cents": 856,
        "taxa_usada": None, "juros_estimados": False, "sem_taxa": True,
        "segundo_ciclo": False, "destino_id": "fat-2", "destino_vence_em": "2026-08-10",
    })
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _roll())}
    r = await resources.execute(ctx, _roll())
    assert "Não estimei juros" in r.message


@pytest.mark.asyncio
async def test_segundo_ciclo_vira_aviso(monkeypatch):
    """A trava de cadeia foi removida de propósito (o Nubank faz isso), mas avisa."""
    _fatura(monkeypatch, resultado={
        "principal_cents": 135000, "juros_cents": 17383, "iof_cents": 856,
        "taxa_usada": "0.12876", "juros_estimados": True, "sem_taxa": False,
        "segundo_ciclo": True, "destino_id": "fat-2", "destino_vence_em": "2026-08-10",
    })
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, _roll())}
    r = await resources.execute(ctx, _roll())
    assert "já carregava saldo adiado" in r.message


def test_adiar_so_vale_para_cartao():
    with pytest.raises(Level1Error):
        resources.validate_fields(ResourceAction(type=Op.ROLL, resource="debts", name="carro"))


def test_adiar_sempre_pede_confirmacao():
    """Cria juros e IOF: nunca pode acontecer sem o usuário ver antes."""
    from app.graph import policy

    assert policy.needs_confirmation(_roll(), confidence=1.0) is not None


def test_taxa_formatada_sem_zero_a_toa():
    assert resources.formata_taxa("0.12876") == "12,876%"
    assert resources.formata_taxa("0.155") == "15,5%"
    assert resources.formata_taxa("0.15") == "15%"


# --- a frase da leitura ----------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("fim_iso,dias,esperado", [
    ("2026-09-10", 1, "Fecha hoje."),        # hoje é o dia do fechamento
    ("2026-09-11", 1, "Fecha amanhã."),
    ("2026-09-30", 20, "Faltam 20 dias para fechar."),
])
async def test_a_frase_do_ciclo_nao_cola_pedaco(monkeypatch, fim_iso, dias, esperado):
    """"Fecha hoje para fechar." — o sufixo fixo grudado num pedaço variável.

    Visto no emulador em 11/09/2026. A segunda linha é uma frase inteira por
    caso, não um trecho mais um "para fechar" cravado no fim.
    """
    from datetime import date

    from app.graph.schemas import FinanceQuery, FinanceQueryType
    from app.tools import queries

    async def cycle(ws, dia):
        return {"ini": date(2026, 8, 11), "fim": date.fromisoformat(fim_iso),
                "close_day": 10, "rotulo": "setembro", "dias_ate_o_fim": dias}

    monkeypatch.setattr(queries.db, "cycle", cycle)
    monkeypatch.setattr(queries, "local_iso_date", lambda tz: "2026-09-10")

    r = await queries.query_cycle(_ctx(), FinanceQuery(type=FinanceQueryType.QUERY_CYCLE))
    assert r.message.endswith(esperado), r.message
    assert "para fechar para fechar" not in r.message
    assert "hoje para fechar" not in r.message


def test_todo_tipo_de_resource_aparece_na_linha_de_tipos_do_prompt():
    """A linha "Tipos ..." é o que o modelo lê como o que existe.

    `resource_roll` ficou só no catálogo, lá embaixo: "adia a fatura" virava
    `resource_list` e o usuário recebia a lista dos cartões dele, sem frase
    nenhuma. Achado por `scripts/probe_pergunta_ou_supoe.py` em 11/09/2026.
    """
    import inspect

    from app.graph import nodes
    from app.graph.schemas import ResourceActionType

    fonte = inspect.getsource(nodes.resource_node)
    linha = next(l for l in fonte.splitlines() if "Tipos resource_" in l)
    # a linha quebra em duas no arquivo; junta o bloco inteiro do prompt
    bloco = fonte[fonte.index("Tipos resource_"):][:400]
    faltando = [t.value for t in ResourceActionType if t.value not in bloco]
    assert not faltando, f"tipos fora da linha de tipos do prompt: {faltando}"
    assert linha


@pytest.mark.asyncio
async def test_listar_o_mes_responde_qual_e_e_como_mudar(monkeypatch):
    """⚠️ `resource_list` em `mes` era recusado, e a recusa não ajudava ninguém.

    O modelo manda `resource_list` quando a frase não diz o dia ("muda meu
    ciclo") — o mesmo reflexo de "não sei qual, então listo" que mandava
    "adia a fatura" para a listagem de cartões. A resposta serve às duas
    leituras possíveis: diz qual é o ciclo hoje e diz como mudá-lo.
    """
    _banco(monkeypatch)
    acao = ResourceAction(type=Op.LIST, resource="mes")
    ctx = _ctx()
    ctx.target = {"prepared": await resources.prepare(ctx, acao)}
    r = await resources.execute(ctx, acao)
    assert r.read_only
    assert "11/08/2026" in r.message and "10/09/2026" in r.message
    assert "dia 10" in r.message
    assert "1 a 28" in r.message, "diz como mudar"
