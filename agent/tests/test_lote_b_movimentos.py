"""Lote B da paridade com o app: guardar/retirar da meta (F11), aplicar/resgatar (F12), valor e
rendimento (F13) e plano percentual (F14). Dublês no lugar do banco: o que se prova é que comando o
agente monta, o que escreve na frase do SIM (com os números que o BANCO devolveu) e que a prévia é
DESFEITA — não o SQL, que a prova no staging cobre."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

import psycopg
import pytest

from app.graph import policy
from app.graph.schemas import FinanceAction, ResourceAction, ResourceField
from app.tools import finance, guards, movimentos, registry, resources
from app.tools.base import ExecContext, request_id
from app.tools.guards import Level1Error

USER, WS = "user-1", "ws-1"
META = {"id": "6e94e5b2-99bb-4654-99f2-3d23bd4520d8", "name": "Viagem"}
ALVO = {"status": "found", "table": "goals", "candidates": [{"id": META["id"], "label": META["name"]}]}
NUBANK = {"id": "aaaaaaaa-0000-0000-0000-000000000001", "name": "Nubank", "type": "checking"}
POUPANCA = {"id": "aaaaaaaa-0000-0000-0000-000000000002", "name": "Poupança", "type": "savings"}
CARTAO = {"id": "aaaaaaaa-0000-0000-0000-000000000003", "name": "Nubank Cartão", "type": "credit_card"}
CDB = {"id": "aaaaaaaa-0000-0000-0000-000000000004", "name": "CDB", "type": "investment"}
TESOURO = {"id": "aaaaaaaa-0000-0000-0000-000000000005", "name": "Tesouro", "type": "investment"}
CONTAS = [NUBANK, POUPANCA, CARTAO, CDB, TESOURO]


class Recusado(psycopg.Error):
    """O que o psycopg levanta para um SQLSTATE do projeto (`PT409`, `PT422`)."""

    def __init__(self, sqlstate, mensagem):
        super().__init__(mensagem)
        self.sqlstate = sqlstate
        self._mensagem = mensagem

    @property
    def diag(self):
        return SimpleNamespace(message_primary=self._mensagem)


class Banco:
    """`como_usuario` de mentira: respostas por trecho do SQL, e o registro de como cada bloco saiu."""

    def __init__(self, **roteiro):
        self.roteiro = {k: v if isinstance(v, list) else [v] for k, v in roteiro.items()}
        self.chamadas: list[tuple[str, tuple]] = []
        self.saidas: list[bool] = []  # True = o bloco saiu por exceção (a transação voltou)

    def __call__(self, user_id):
        banco = self

        @asynccontextmanager
        async def bloco():
            assert user_id == USER
            try:
                yield banco
            except BaseException:
                banco.saidas.append(True)
                raise
            banco.saidas.append(False)

        return bloco()

    async def fetch_one(self, sql, *args):
        self.chamadas.append((sql, args))
        for trecho, valores in self.roteiro.items():
            if trecho in sql:
                v = valores.pop(0) if len(valores) > 1 else valores[0]
                if isinstance(v, Exception):
                    raise v
                return v(*args) if callable(v) else v
        raise AssertionError(f"SQL sem roteiro: {sql}")

    def comando(self, rpc):
        sql, args = [c for c in self.chamadas if f"public.{rpc}(" in c[0]][-1]  # a última: a que COMMITA
        return json.loads(args[0]), args[1]


def instala(monkeypatch, banco, achadas=None):
    monkeypatch.setattr(movimentos.db, "como_usuario", banco)

    async def contas(workspace_id, *, only_cards=False):
        return CONTAS

    monkeypatch.setattr(movimentos.db, "accounts", contas)

    async def conta_citada(workspace_id, nome, *, only_cards=False, papel="a conta"):
        achada = [c for c in CONTAS if c["name"].lower() == str(nome).lower()]
        if not achada:
            raise Level1Error(f"🤔 Não achei conta com o nome *{nome}*. Qual é {papel}?")
        return UUID(achada[0]["id"])

    monkeypatch.setattr(finance, "conta_citada", conta_citada)

    async def fetch(sql, *args):
        tabela = "accounts" if "from public.accounts" in sql else "goals"
        pool = achadas if achadas is not None else ([META] if tabela == "goals" else [CDB])
        return [r for r in pool if args[-1].strip("%").lower() in r["name"].lower()]

    monkeypatch.setattr(movimentos.db, "fetch", fetch)

    async def dono(*a, **k):
        return None

    monkeypatch.setattr(movimentos, "ensure_owned", dono)


def conta_no_estado(c, goal=0, cash=0, free=0):
    return {"account_id": c["id"], "name": c["name"], "type": c["type"], "archived": False,
            "goal_cents": str(goal), "cash_cents": str(cash), "allocated_cents": "0", "free_cents": str(free)}


def estado_meta(*contas):
    return {"s": {"goal_id": META["id"], "accounts": list(contas), "movements": [], "has_more": False}}


def banco_da_meta(saved_antes=240000, saved_depois=270000, antes=None, depois=None, **extra):
    return Banco(
        **{"goal_money_state": [antes or estado_meta(conta_no_estado(NUBANK, 0, 2930000, 2930000)),
                                depois or estado_meta(conta_no_estado(NUBANK, 30000, 2930000, 2900000))],
           "select saved_cents": {"saved_cents": saved_antes},
           "public.goal_money_command(": {"r": {"movement_id": "m1", "saved_cents": str(saved_depois)}}},
        **extra,
    )


def guardar(**campos):
    return FinanceAction(type="goal_deposit", target_ref="viagem", amount_cents=30000, **campos)


def ctx(**extra):
    return ExecContext(USER, WS, None, "America/Sao_Paulo", "", "app:msg-1", action_index=2, **extra)


def acao(resource, tipo="resource_update", name=None, **campos):
    return ResourceAction(
        type=tipo, resource=resource, name=name,
        fields=[ResourceField(name=k, value=None if v is None else str(v)) for k, v in campos.items()],
    )


# ------------------------------------------------------------------ registry: a recusa chega escrita


class _Sinal:
    def __init__(self, codigo, msg):
        self.sqlstate, self.diag = codigo, SimpleNamespace(message_primary=msg)


@pytest.mark.parametrize("codigo, msg, trecho", [
    ("PT409", "A movimentação mudou. Abra de novo", "mudou enquanto eu perguntava"),
    ("40001", "could not serialize access", "mudou enquanto eu perguntava"),
    ("PT422", "SALDO_INSUFICIENTE: livre 12345 centavos", "Só há R$ 123,45 livres nessa conta"),
    ("PT422", "SALDO_INSUFICIENTE: faltam 5000 centavos em 05/10/2026", "faltam R$ 50,00 em 05/10/2026"),
    ("22023", "Valor em centavos inteiros", "Valor em centavos inteiros"),
    ("P0001", "A categoria x não existe mais", "A categoria x não existe mais"),
])
def test_recusa_do_banco_vira_frase(codigo, msg, trecho):
    assert trecho in guards.recusa_do_banco(_Sinal(codigo, msg))


@pytest.mark.parametrize("codigo", ["23505", "42501", "XX000", None])
def test_o_resto_do_banco_continua_falha_de_verdade(codigo):
    assert guards.recusa_do_banco(_Sinal(codigo, "duplicate key value")) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("codigo, trecho", [("PT409", "mudou enquanto eu perguntava"), ("PT422", "Só há R$ 10,00")])
async def test_registry_traduz_o_sqlstate_do_projeto(monkeypatch, codigo, trecho):
    async def vaga(*a, **k):
        return True

    liberada = []

    async def libera(*a, **k):
        liberada.append(1)

    async def tool(c, a):
        raise Recusado(codigo, "A movimentação mudou" if codigo == "PT409" else "SALDO_INSUFICIENTE: livre 1000 centavos")

    monkeypatch.setattr(registry.db, "reserve_execution", vaga)
    monkeypatch.setattr(registry.db, "release_execution", libera)
    monkeypatch.setattr(registry, "_tool", lambda a: tool)
    r = await registry.execute(ctx(), acao("goals", tipo="resource_update", name="x"))
    assert trecho in r.message and r.read_only and liberada  # a vaga de idempotência volta


# ------------------------------------------------------------------ F11: guardar na meta


@pytest.mark.asyncio
async def test_guardar_com_uma_conta_separa_e_nao_mexe_no_saldo(monkeypatch):
    banco = banco_da_meta()
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [ALVO])
    mov = alvos[0]["movimento"]
    assert mov["input"] == {"op": "allocate", "goal_id": META["id"], "account_id": NUBANK["id"],
                            "amount_cents": "30000", "occurred_on": mov["input"]["occurred_on"]}
    # os números da frase são os que o BANCO devolveu antes e depois, não uma conta daqui
    assert mov["frase"].startswith("separar R$ 300,00 da meta *Viagem* na conta Nubank")
    assert "saldo dela NÃO muda" in mov["frase"]
    assert "livre na conta R$ 29.300,00 → R$ 29.000,00" in mov["frase"]
    assert "guardado na meta R$ 2.400,00 → R$ 2.700,00" in mov["frase"]
    assert banco.saidas == [True]  # a prévia VOLTOU: nada foi gravado


@pytest.mark.asyncio
async def test_guardar_com_duas_contas_transfere_de_verdade(monkeypatch):
    banco = banco_da_meta(
        antes=estado_meta(conta_no_estado(NUBANK, 0, 2930000, 2930000), conta_no_estado(POUPANCA, 0, 1850000, 1850000)),
        depois=estado_meta(conta_no_estado(NUBANK, 0, 2900000, 2900000), conta_no_estado(POUPANCA, 30000, 1880000, 1850000)),
    )
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(
        USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank", counterparty_account="Poupança")], [ALVO])
    mov = alvos[0]["movimento"]
    assert mov["input"]["op"] == "transfer_in"
    assert (mov["input"]["from_account_id"], mov["input"]["account_id"]) == (NUBANK["id"], POUPANCA["id"])
    assert "transferir R$ 300,00 da conta Nubank para a conta Poupança" in mov["frase"]
    assert "transferência de verdade" in mov["frase"]
    assert "Nubank R$ 29.300,00 → R$ 29.000,00" in mov["frase"] and "Poupança R$ 18.500,00 → R$ 18.800,00" in mov["frase"]
    assert "NÃO muda" not in mov["frase"]


@pytest.mark.asyncio
async def test_as_duas_frases_do_guardar_se_distinguem(monkeypatch):
    instala(monkeypatch, banco_da_meta())
    um = (await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [ALVO]))[0]
    instala(monkeypatch, banco_da_meta())
    dois = (await movimentos.congelar(
        USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank", counterparty_account="Poupança")], [ALVO]))[0]
    assert um["movimento"]["frase"] != dois["movimento"]["frase"]
    assert policy.describe_for_confirmation(guardar(account="Nubank"), um) == um["movimento"]["frase"]


@pytest.mark.asyncio
async def test_guardar_sem_conta_continua_sendo_o_deposito_de_sempre(monkeypatch):
    banco = banco_da_meta()
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar()], [ALVO])
    assert "movimento" not in alvos[0] and banco.chamadas == []


@pytest.mark.asyncio
async def test_so_o_destino_sem_origem_pergunta(monkeypatch):
    instala(monkeypatch, banco_da_meta())
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(counterparty_account="Poupança")], [ALVO])
    assert "De qual conta saiu" in alvos[0]["correction_error"] and "movimento" not in alvos[0]


@pytest.mark.asyncio
async def test_conta_que_nao_existe_para_antes_do_sim(monkeypatch):
    instala(monkeypatch, banco_da_meta())
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Itaú")], [ALVO])
    assert "Não achei conta com o nome *Itaú*" in alvos[0]["correction_error"]


@pytest.mark.asyncio
async def test_saldo_insuficiente_chega_antes_do_sim_em_reais(monkeypatch):
    banco = banco_da_meta()
    banco.roteiro["public.goal_money_command("] = [Recusado("PT422", "SALDO_INSUFICIENTE: livre 10000 centavos")]
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [ALVO])
    assert "Só há R$ 100,00 livres nessa conta" in alvos[0]["correction_error"]
    assert "Nada foi alterado" in alvos[0]["correction_error"] and banco.saidas == [True]


@pytest.mark.asyncio
async def test_meta_nao_resolvida_nao_congela_nada(monkeypatch):
    instala(monkeypatch, banco_da_meta())
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [{"status": "none"}])
    assert "movimento" not in alvos[0]


@pytest.mark.asyncio
async def test_executar_roda_o_comando_aprovado_com_a_chave_da_intencao(monkeypatch):
    banco = banco_da_meta()
    instala(monkeypatch, banco)
    mov = (await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [ALVO]))[0]["movimento"]
    banco.chamadas.clear(), banco.saidas.clear()
    r = await movimentos.executar(ctx(), mov)
    entrada, chave = banco.comando("goal_money_command")
    assert entrada == mov["input"] and chave == request_id("app:msg-1", 2)
    assert r.message == "🎯 Separei R$ 300,00 na conta Nubank para a meta *Viagem*. Agora: guardado na meta R$ 2.700,00."
    assert r.result_id == UUID(META["id"]) and banco.saidas == [False]  # este COMMITA


@pytest.mark.asyncio
async def test_goal_deposit_e_create_transfer_executam_o_movimento_congelado(monkeypatch):
    chamado = []

    async def executar(c, mov):
        chamado.append(mov["rpc"])
        return finance.ToolResult("ok")

    monkeypatch.setattr(movimentos, "executar", executar)
    c = ctx(target={"movimento": {"rpc": "goal_money_command"}})
    assert (await finance.goal_deposit(c, guardar(account="Nubank"))).message == "ok"
    c = ctx(target={"movimento": {"rpc": "investment_command"}})
    t = FinanceAction(type="create_transfer", amount_cents=100, account="Nubank", counterparty_account="CDB")
    assert (await finance.create_transfer(c, t)).message == "ok"
    assert chamado == ["goal_money_command", "investment_command"]


@pytest.mark.asyncio
async def test_rpc_fora_da_lista_nao_roda(monkeypatch):
    with pytest.raises(Level1Error):
        await movimentos.executar(ctx(), {"rpc": "drop_table", "input": {}, "feito": ""})


# ------------------------------------------------------------------ F11: retirar da meta


def banco_da_retirada(guardado_antes=290000, guardado_depois=280000, antes=None, depois=None):
    return banco_da_meta(
        saved_antes=guardado_antes, saved_depois=guardado_depois,
        antes=antes or estado_meta(conta_no_estado(POUPANCA, 30000, 1850000, 1820000)),
        depois=depois or estado_meta(conta_no_estado(POUPANCA, 20000, 1850000, 1830000)),
    )


@pytest.mark.asyncio
async def test_retirar_da_conta_libera_sem_mexer_no_saldo(monkeypatch):
    instala(monkeypatch, banco_da_retirada())
    p = await resources.prepare(ctx(), acao("goals", name="viagem", retirar_cents=10000, retirar_da_conta="Poupança"))
    assert p["movimento"]["input"]["op"] == "release" and p["movimento"]["input"]["account_id"] == POUPANCA["id"]
    assert p["summary"].startswith("liberar R$ 100,00 da meta *Viagem* na conta Poupança")
    assert "saldo dela NÃO muda" in p["summary"] and "guardado na meta R$ 2.900,00 → R$ 2.800,00" in p["summary"]


@pytest.mark.asyncio
async def test_retirar_para_outra_conta_transfere_de_verdade(monkeypatch):
    instala(monkeypatch, banco_da_retirada(
        depois=estado_meta(conta_no_estado(POUPANCA, 20000, 1840000, 1820000), conta_no_estado(NUBANK, 0, 2940000, 2940000)),
        antes=estado_meta(conta_no_estado(POUPANCA, 30000, 1850000, 1820000), conta_no_estado(NUBANK, 0, 2930000, 2930000))))
    p = await resources.prepare(ctx(), acao(
        "goals", name="viagem", retirar_cents=10000, retirar_da_conta="Poupança", retirar_para_conta="Nubank"))
    assert p["movimento"]["input"]["op"] == "transfer_out"
    assert p["movimento"]["input"]["to_account_id"] == NUBANK["id"]
    assert "transferência de verdade" in p["summary"] and "Poupança R$ 18.500,00 → R$ 18.400,00" in p["summary"]


@pytest.mark.asyncio
async def test_retirar_sem_conta_pergunta_quando_ha_dinheiro_separado(monkeypatch):
    banco = banco_da_retirada()
    banco.roteiro["goal_money_state"] = [estado_meta(conta_no_estado(POUPANCA, 30000, 1850000, 1820000))]
    instala(monkeypatch, banco)
    with pytest.raises(Level1Error, match=r"De qual conta tiro\? .*Poupança \(R\$ 300,00\)"):
        await resources.prepare(ctx(), acao("goals", name="viagem", retirar_cents=10000))
    assert banco.saidas == [True]  # a leitura também não deixa rastro


@pytest.mark.asyncio
async def test_retirar_sem_conta_quando_nada_esta_separado_e_sem_origem(monkeypatch):
    banco = banco_da_retirada()
    banco.roteiro["goal_money_state"] = [estado_meta(conta_no_estado(POUPANCA, 0, 1850000, 1850000))]
    instala(monkeypatch, banco)
    p = await resources.prepare(ctx(), acao("goals", name="viagem", retirar_cents=10000))
    assert "account_id" not in p["movimento"]["input"]
    assert "sem conta de origem" in p["summary"]


@pytest.mark.asyncio
async def test_retirar_mais_do_que_ha_vira_frase_antes_do_sim(monkeypatch):
    banco = banco_da_retirada()
    banco.roteiro["public.goal_money_command("] = [
        Recusado("PT422", "Não dá para retirar mais do que está guardado nessa meta.")]
    instala(monkeypatch, banco)
    with pytest.raises(resources.JaExiste, match="mais do que está guardado"):
        await resources.prepare(ctx(), acao("goals", name="viagem", retirar_cents=90000000, retirar_da_conta="Poupança"))


@pytest.mark.asyncio
@pytest.mark.parametrize("campos, trecho", [
    ({"retirar_da_conta": "Poupança"}, "Me diz o valor"),
    ({"retirar_cents": 100, "aporte_do_dia": "ultimo"}, "uma coisa por vez"),
    ({"retirar_cents": 0, "retirar_da_conta": "Poupança"}, "maior que zero"),
    ({"retirar_cents": 100, "retirar_para_conta": "Nubank"}, "de qual conta o dinheiro sai"),
])
async def test_retirar_incompleto_pergunta(monkeypatch, campos, trecho):
    instala(monkeypatch, banco_da_retirada())
    with pytest.raises(Level1Error, match=trecho):
        await resources.prepare(ctx(), acao("goals", name="viagem", **campos))


@pytest.mark.asyncio
async def test_retirar_so_em_meta_que_existe(monkeypatch):
    instala(monkeypatch, banco_da_retirada())
    with pytest.raises(Level1Error, match="meta que já existe"):
        await resources.prepare(ctx(), acao("goals", tipo="resource_delete", name="viagem", retirar_cents=100))


# ------------------------------------------------------------------ F12: aplicar e resgatar


def posicao(conta, saldo, valor, resultado=None, qualidade="indisponível", recebido=0):
    return {"account_id": conta["id"], "name": conta["name"], "balance_cents": str(saldo), "value_cents": str(valor),
            "result_cents": None if resultado is None else str(resultado), "result_quality": qualidade,
            "received_cents": str(recebido)}


def banco_do_investimento(antes, depois, rpc="investment_command", resultado=None):
    return Banco(**{"investment_positions": [{"p": [antes]}, {"p": [depois]}],
                    f"public.{rpc}(": {"r": resultado or {"movement_id": "m1", "position_balance_cents": "120000"}}})


def transferir(origem, destino, valor=20000):
    return FinanceAction(type="create_transfer", amount_cents=valor, account=origem, counterparty_account=destino)


@pytest.mark.asyncio
async def test_transferir_para_conta_de_investimento_e_aplicar(monkeypatch):
    banco = banco_do_investimento(posicao(CDB, 100000, 100000), posicao(CDB, 120000, 120000))
    instala(monkeypatch, banco)
    mov = (await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("Nubank", "CDB")], [{}]))[0]["movimento"]
    assert mov["input"]["op"] == "contribute"
    assert (mov["input"]["position_account_id"], mov["input"]["from_account_id"]) == (CDB["id"], NUBANK["id"])
    assert mov["frase"].startswith("aplicar R$ 200,00 em *CDB*, saindo de *Nubank*")
    assert "não é gasto nem receita" in mov["frase"] and "saldo da posição R$ 1.000,00 → R$ 1.200,00" in mov["frase"]
    assert banco.saidas == [True]


@pytest.mark.asyncio
async def test_transferir_de_conta_de_investimento_e_resgatar(monkeypatch):
    banco = banco_do_investimento(posicao(CDB, 100000, 100000), posicao(CDB, 80000, 80000))
    instala(monkeypatch, banco)
    mov = (await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("CDB", "Nubank")], [{}]))[0]["movimento"]
    assert mov["input"]["op"] == "redeem" and mov["input"]["to_account_id"] == NUBANK["id"]
    assert mov["frase"].startswith("resgatar R$ 200,00 de *CDB* para *Nubank*")


@pytest.mark.asyncio
async def test_transferencia_comum_nao_vira_investimento(monkeypatch):
    banco = banco_do_investimento(posicao(CDB, 0, 0), posicao(CDB, 0, 0))
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("Nubank", "Poupança")], [{}])
    assert "movimento" not in alvos[0] and banco.chamadas == []


@pytest.mark.asyncio
async def test_transferencia_sem_origem_citada_usa_a_conta_padrao_congelada(monkeypatch):
    instala(monkeypatch, banco_do_investimento(posicao(CDB, 0, 0), posicao(CDB, 20000, 20000)))
    t = FinanceAction(type="create_transfer", amount_cents=20000, counterparty_account="CDB")
    alvos = await movimentos.congelar(
        USER, WS, "America/Sao_Paulo", "", [t], [{"default_account": {"id": NUBANK["id"], "name": "Nubank"}}])
    assert alvos[0]["movimento"]["input"]["from_account_id"] == NUBANK["id"]


@pytest.mark.asyncio
async def test_duas_contas_de_investimento_nao_aplicam(monkeypatch):
    instala(monkeypatch, banco_do_investimento(posicao(CDB, 0, 0), posicao(CDB, 0, 0)))
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("CDB", "Tesouro")], [{}])
    assert "uma ponta precisa ser uma conta comum" in alvos[0]["correction_error"]


@pytest.mark.asyncio
async def test_resgate_maior_que_a_posicao_para_antes_do_sim(monkeypatch):
    banco = banco_do_investimento(posicao(CDB, 100000, 100000), posicao(CDB, 0, 0))
    banco.roteiro["public.investment_command("] = [Recusado("PT422", "SALDO_INSUFICIENTE: faltam 99879999 centavos em 05/10/2026")]
    instala(monkeypatch, banco)
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("CDB", "Nubank", 99999999)], [{}])
    assert "faltam R$ 998.799,99 em 05/10/2026" in alvos[0]["correction_error"]


@pytest.mark.asyncio
async def test_executar_aplicacao_diz_o_saldo_que_o_banco_devolveu(monkeypatch):
    banco = banco_do_investimento(posicao(CDB, 100000, 100000), posicao(CDB, 120000, 120000))
    instala(monkeypatch, banco)
    mov = (await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [transferir("Nubank", "CDB")], [{}]))[0]["movimento"]
    r = await movimentos.executar(ctx(), mov)
    assert r.message == "📈 Apliquei R$ 200,00 em *CDB* (saiu de Nubank). Agora: saldo da posição R$ 1.200,00."
    assert banco.comando("investment_command")[1] == request_id("app:msg-1", 2)


# ------------------------------------------------------------------ F13: valor e rendimento


def banco_do_valor(antes, depois):
    return banco_do_investimento(antes, depois, "investment_value_command",
                                 {"valuation_id": "v1", "position_value_cents": "1050000"})


@pytest.mark.asyncio
async def test_valor_atual_atualiza_so_o_patrimonio(monkeypatch):
    instala(monkeypatch, banco_do_valor(posicao(CDB, 1000000, 1000000), posicao(CDB, 1000000, 1050000, 50000, "conhecido")))
    p = await resources.prepare(ctx(), acao("accounts", name="cdb", valor_atual_cents=1050000))
    assert p["movimento"]["input"]["op"] == "valuation" and p["movimento"]["input"]["value_cents"] == "1050000"
    assert "só o patrimônio muda" in p["summary"] and "nenhum dinheiro entra nem sai" in p["summary"]
    assert "valor atual R$ 10.000,00 → R$ 10.500,00" in p["summary"]
    # sem atualização anterior o resultado é "indisponível" — nunca R$ 0,00
    assert "resultado indisponível → R$ 500,00" in p["summary"]
    r = await movimentos.executar(ctx(), p["movimento"])
    assert r.message == "📈 Atualizei *CDB* para R$ 10.500,00. Agora: valor da posição R$ 10.500,00."


@pytest.mark.asyncio
async def test_rendimento_e_receita_de_verdade_na_propria_posicao(monkeypatch):
    instala(monkeypatch, banco_do_valor(posicao(CDB, 1000000, 1000000), posicao(CDB, 1008500, 1008500, recebido=8500)))
    p = await resources.prepare(ctx(), acao("accounts", name="cdb", rendimento_cents=8500))
    entrada = p["movimento"]["input"]
    assert entrada["op"] == "income" and entrada["to_account_id"] == CDB["id"] and entrada["amount_cents"] == "8500"
    assert "receita de verdade" in p["summary"] and "recebido na própria posição" in p["summary"]
    assert "rendimento recebido R$ 0,00 → R$ 85,00" in p["summary"]


@pytest.mark.asyncio
async def test_rendimento_pode_cair_noutra_conta(monkeypatch):
    instala(monkeypatch, banco_do_valor(posicao(CDB, 0, 0), posicao(CDB, 0, 0, recebido=8500)))
    p = await resources.prepare(ctx(), acao("accounts", name="cdb", rendimento_cents=8500, rendimento_na_conta="Nubank"))
    assert p["movimento"]["input"]["to_account_id"] == NUBANK["id"] and "na conta Nubank" in p["summary"]


@pytest.mark.asyncio
@pytest.mark.parametrize("campos, trecho", [
    ({}, "valor atual da posição"),
    ({"valor_atual_cents": 100, "rendimento_cents": 10}, "valor atual da posição"),
    ({"valor_atual_cents": 100, "archived": "true"}, "uma coisa por vez"),
    ({"rendimento_cents": 0}, "maior que zero"),
])
async def test_valor_ou_rendimento_nunca_os_dois(monkeypatch, campos, trecho):
    instala(monkeypatch, banco_do_valor(posicao(CDB, 0, 0), posicao(CDB, 0, 0)))
    if not campos:
        campos = {"data_do_valor": "2026-10-01"}
    with pytest.raises(Level1Error, match=trecho):
        await resources.prepare(ctx(), acao("accounts", name="cdb", **campos))


@pytest.mark.asyncio
async def test_so_conta_de_investimento_tem_valor(monkeypatch):
    instala(monkeypatch, banco_do_valor(posicao(CDB, 0, 0), posicao(CDB, 0, 0)), achadas=[])
    with pytest.raises(Level1Error, match="Não achei conta de investimento"):
        await resources.prepare(ctx(), acao("accounts", name="nubank", valor_atual_cents=100))


@pytest.mark.asyncio
async def test_valor_repetido_no_mesmo_dia_diz_o_caminho(monkeypatch):
    banco = banco_do_valor(posicao(CDB, 0, 0), posicao(CDB, 0, 0))
    banco.roteiro["public.investment_value_command("] = [Recusado("P0001", "Já existe uma atualização em 05/10: edite a de 05/10.")]
    instala(monkeypatch, banco)
    with pytest.raises(resources.JaExiste, match="Já existe uma atualização em 05/10"):
        await resources.prepare(ctx(), acao("accounts", name="cdb", valor_atual_cents=100))


# ------------------------------------------------------------------ F14: plano percentual


def estado_do_plano(workspace=WS, plano=True, mes="2026-10-01"):
    linhas = [
        {"position": 0, "group": "Essenciais", "category": "mercado", "share_bp": 3000, "amount_cents": "150000",
         "current_default_cents": "90000", "current_month_cents": None, "spent_cents": "40000"},
        {"position": 1, "group": "Lazer", "category": "lazer", "share_bp": 1250, "amount_cents": "62500",
         "current_default_cents": None, "current_month_cents": None, "spent_cents": "0"},
    ]
    return {"s": {"workspace_id": workspace, "revision": 3, "month": mes, "period_start": "2026-09-11",
                  "period_end": "2026-10-10", "applications": [],
                  "plan": {"version": 3, "base_income_cents": "500000", "lines": linhas, "total_bp": 4250,
                           "undistributed_bp": 5750, "undistributed_cents": "287500"} if plano else None}}


def banco_do_plano(estado=None, aplicadas=None):
    aplicadas = aplicadas or [
        {"category": "mercado", "before_cents": "90000", "applied_cents": "150000"},
        {"category": "lazer", "before_cents": None, "applied_cents": "62500"}]
    return Banco(**{"public.budget_plan_state(": estado or estado_do_plano(),
                    "public.budget_plan_command(": {"r": {"version": 3, "scope": "default", "applied": aplicadas}}})


@pytest.mark.asyncio
async def test_aplicar_o_plano_mostra_antes_e_depois_do_banco(monkeypatch):
    banco = banco_do_plano()
    instala(monkeypatch, banco)
    p = await resources.prepare(ctx(), acao("plano", aplicar_categorias="todas"))
    entrada = p["movimento"]["input"]
    assert entrada == {"op": "apply", "version": 3, "categories": ["mercado", "lazer"], "scope": "default", "month": None}
    assert "aplicar o plano v3 (renda-base R$ 5.000,00)" in p["summary"] and "como limite padrão" in p["summary"]
    assert "mercado R$ 900,00 → R$ 1.500,00" in p["summary"] and "lazer sem limite → R$ 625,00" in p["summary"]
    assert banco.saidas.count(True) == 1  # a prévia voltou
    r = await movimentos.executar(ctx(), p["movimento"])
    assert r.message.startswith("✅ Apliquei o plano v3") and banco.saidas[-1] is False
    assert banco.comando("budget_plan_command")[1] == request_id("app:msg-1", 2)


@pytest.mark.asyncio
async def test_aplicar_so_algumas_categorias_e_so_o_mes(monkeypatch):
    instala(monkeypatch, banco_do_plano(aplicadas=[{"category": "lazer", "before_cents": None, "applied_cents": "62500"}]))
    p = await resources.prepare(ctx(), acao("plano", aplicar_categorias="lazer", aplicar_alcance="mes"))
    entrada = p["movimento"]["input"]
    assert entrada["categories"] == ["lazer"] and entrada["scope"] == "month" and entrada["month"] == "2026-10-01"
    assert "só em 10/2026" in p["summary"]


@pytest.mark.asyncio
async def test_so_o_mes_mostra_o_limite_padrao_como_antes(monkeypatch):
    # o banco devolve before null (não há linha DO mês), mas o limite que vale é o padrão
    instala(monkeypatch, banco_do_plano(estado_do_plano(mes="2026-11-01"),
                                        [{"category": "mercado", "before_cents": None, "applied_cents": "150000"}]))
    p = await resources.prepare(ctx(), acao("plano", aplicar_categorias="mercado", aplicar_mes="2026-11-15"))
    assert p["movimento"]["input"]["month"] == "2026-11-01" and "mercado R$ 900,00 → R$ 1.500,00" in p["summary"]


@pytest.mark.asyncio
async def test_sem_plano_ou_em_outro_espaco_nao_aplica(monkeypatch):
    instala(monkeypatch, banco_do_plano(estado_do_plano(plano=False)))
    with pytest.raises(resources.JaExiste, match="não montou um plano"):
        await resources.prepare(ctx(), acao("plano"))
    instala(monkeypatch, banco_do_plano(estado_do_plano(workspace="outro-espaco")))
    with pytest.raises(resources.JaExiste, match="espaço padrão"):
        await resources.prepare(ctx(), acao("plano"))


@pytest.mark.asyncio
async def test_aplicar_com_categoria_que_sumiu_chega_antes_do_sim(monkeypatch):
    banco = banco_do_plano()
    banco.roteiro["public.budget_plan_command("] = [Recusado("P0001", "A categoria lazer não existe mais: edite o plano.")]
    instala(monkeypatch, banco)
    with pytest.raises(resources.JaExiste, match="lazer não existe mais"):
        await resources.prepare(ctx(), acao("plano"))


@pytest.mark.asyncio
async def test_plano_so_se_consulta_e_se_aplica(monkeypatch):
    instala(monkeypatch, banco_do_plano())
    with pytest.raises(Level1Error, match="montar e mudar o plano é no app"):
        await resources.prepare(ctx(), acao("plano", tipo="resource_delete"))
    with pytest.raises(Level1Error, match="limite padrão ou só neste mês"):
        await resources.prepare(ctx(), acao("plano", aplicar_alcance="semana"))


@pytest.mark.asyncio
async def test_consultar_o_plano_mostra_planejado_e_realizado(monkeypatch):
    instala(monkeypatch, banco_do_plano())
    p = await resources.prepare(ctx(), acao("plano", tipo="resource_list"))
    r = await movimentos.ler_plano(ctx())
    assert r.read_only
    assert "Plano v3 sobre a renda-base de R$ 5.000,00" in r.message
    assert "Essenciais (mercado): 30% = R$ 1.500,00, gastou R$ 400,00, limite hoje R$ 900,00" in r.message
    assert "Lazer (lazer): 12,5% = R$ 625,00, gastou R$ 0,00, sem limite hoje" in r.message
    assert "Sem destino: 57,5% (R$ 2.875,00)" in r.message and p["summary"]


@pytest.mark.parametrize("bp, texto", [(1250, "12,5"), (3000, "30"), (10001, "100,01"), (5, "0,05"), (0, "0")])
def test_percentual_escrito_como_o_app(bp, texto):
    assert movimentos.guards_pct(bp) == texto


# ------------------------------------------------------------------ catálogo e prompt


def test_catalogo_conhece_os_campos_novos_e_o_recurso_plano():
    assert movimentos.CAMPOS_RETIRAR <= set(resources.CATALOG["goals"][3].split())
    assert movimentos.CAMPOS_VALOR <= set(resources.CATALOG["accounts"][3].split())
    assert movimentos.CAMPOS_PLANO <= set(resources.CATALOG["plano"][3].split())
    for campo in movimentos.CAMPOS_RETIRAR | movimentos.CAMPOS_VALOR | movimentos.CAMPOS_PLANO:
        assert campo in resources.LABELS
    prompt = resources.prompt_catalogue()
    assert "retirar_cents" in prompt and "valor_atual_cents" in prompt and "aplicar_categorias" in prompt


@pytest.mark.asyncio
async def test_resources_execute_despacha_o_plano_e_o_movimento(monkeypatch):
    instala(monkeypatch, banco_do_plano())
    lista = acao("plano", tipo="resource_list")
    p = await resources.prepare(ctx(), lista)
    r = await resources.execute(ctx(target={"prepared": p}), lista)
    assert r.read_only and "Plano v3" in r.message

    instala(monkeypatch, banco_da_retirada())
    retirar = acao("goals", name="viagem", retirar_cents=10000, retirar_da_conta="Poupança")
    p = await resources.prepare(ctx(), retirar)
    r = await resources.execute(ctx(target={"prepared": p}), retirar)
    assert r.message.startswith("↩️ Liberei R$ 100,00 da meta *Viagem*") and not r.read_only


@pytest.mark.asyncio
async def test_meta_ambigua_com_conta_pergunta_antes_da_lista(monkeypatch):
    """Escolher a meta pela lista retoma DEPOIS da resolução: sem esta pergunta a conta se perderia."""
    instala(monkeypatch, banco_da_meta())
    ambigua = {"status": "ambiguous", "candidates": [{"id": "1", "label": "Viagem SP"}, {"id": "2", "label": "Viagem RJ"}]}
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar(account="Nubank")], [ambigua])
    assert "Viagem SP, Viagem RJ" in alvos[0]["correction_error"] and "nome exato" in alvos[0]["correction_error"]
    # sem conta dita, a lista segue como sempre
    alvos = await movimentos.congelar(USER, WS, "America/Sao_Paulo", "", [guardar()], [ambigua])
    assert "correction_error" not in alvos[0]


@pytest.mark.asyncio
async def test_goal_deposit_com_conta_e_sem_comando_nunca_cai_no_deposito_antigo(monkeypatch):
    async def deposito(*a, **k):
        raise AssertionError("o depósito antigo perderia a conta")

    monkeypatch.setattr(finance.db, "fetch_one", deposito)
    with pytest.raises(Level1Error, match="Não consegui conferir a conta"):
        await finance.goal_deposit(ctx(target=ALVO), guardar(account="Nubank"))


@pytest.mark.asyncio
async def test_transferencia_para_investimento_sem_comando_nao_vira_transferencia_solta(monkeypatch):
    async def cita(workspace_id, nome, **k):
        return UUID(next(c["id"] for c in CONTAS if c["name"] == nome))

    async def contas(workspace_id, **k):
        return [{**c, "id": UUID(c["id"])} for c in CONTAS]

    async def insere(*a, **k):
        raise AssertionError("gravou a transferência solta")

    monkeypatch.setattr(finance, "conta_citada", cita)
    monkeypatch.setattr(finance.db, "accounts", contas)
    monkeypatch.setattr(finance.db, "fetch_one", insere)
    with pytest.raises(Level1Error, match="aplicação ou resgate"):
        await finance.create_transfer(ctx(), transferir("Nubank", "CDB"))
