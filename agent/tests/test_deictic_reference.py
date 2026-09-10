"""Demonstrativo aponta para o que a CONVERSA acabou de escrever.

Reproduz o defeito medido em produção em 09/09/2026. O usuário mandou
"gastei 20 no café", recebeu a confirmação, e nove segundos depois:

    ele:     apague esse lançamento
    agente:  🤔 apagar qual? — qual deles?      (e nove opções que ele não viu)

Três causas somadas, uma por teste aqui:

1. `_VAGO` conhecia "esse item" e não conhecia "esse lançamento" — a palavra de
   quem fala de dinheiro. O ponteiro virava busca literal por `%esse lançamento%`.
2. Sem termo e sem "último" no texto, o alvo caía na lista dos 9 mais recentes,
   que inclui o que o CRON materializou de madrugada.
3. Os candidatos não tinham data, então quatro ocorrências da mesma série
   recorrente saíam com o rótulo idêntico — escolher era impossível.
"""

import pytest

from app.domain.reference import clean_term
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import resolve

CAFE = "11111111-1111-4111-8111-111111111111"


def _fetch_de(linhas):
    """Dublê de `db.fetch` que distingue as DUAS consultas de `for_actions`.

    A janela dos recentes e o agrupamento por plano de parcelamento usam a mesma
    função com SQL diferente; devolver a mesma lista para as duas estoura em
    `plan_id`. Aqui a de planos responde vazio, que é o caso comum.
    """
    async def fetch(sql, *args):
        return [] if "installment_plans" in sql else linhas

    return fetch


def _acao(tipo=FinanceActionType.DELETE_TRANSACTION, **kw):
    return FinanceAction(type=tipo, **kw)


class TestPonteiroNaoEhBusca:
    """`clean_term` separa o que aponta do que procura."""

    @pytest.mark.parametrize(
        "texto",
        ["esse lançamento", "esse gasto", "essa nota", "essa compra", "esse pagamento",
         "essa transação", "este lançamento", "isso", "aquilo", "esse item"],
    )
    def test_ponteiro_nao_vira_termo(self, texto):
        assert clean_term(texto) is None, f"{texto!r} foi procurado como texto"

    @pytest.mark.parametrize(
        "texto",
        ["essa nota da reunião", "última reunião", "mercado", "conta de luz",
         "compra do mac", "esse mês"],
    )
    def test_nome_de_verdade_sobrevive(self, texto):
        # O padrão é ancorado no texto INTEIRO justamente para isto: como
        # substring, a lista destruiria busca legítima.
        assert clean_term(texto) == texto


@pytest.mark.asyncio
async def test_esse_lancamento_aponta_para_o_que_a_conversa_criou(monkeypatch):
    """O caso do café, ponta a ponta pelo resolvedor."""
    async def fetch_one(sql, *args):
        assert str(args[0]) == CAFE
        return {"id": CAFE, "kind": "expense", "amount_cents": 2000,
                "category": "café", "description": None, "occurred_at": "2026-09-09"}

    monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
    # se cair na janela dos 40, o teste falha em vez de passar por acaso
    async def nunca(*a, **kw):
        raise AssertionError("não devia varrer a janela: havia antecedente")

    monkeypatch.setattr(resolve.db, "fetch", nunca)

    alvos = await resolve.for_actions(
        "ws", [_acao(description="esse lançamento")], "apague esse lançamento",
        antecedente=CAFE,
    )

    assert alvos[0]["status"] == "found"
    assert [c["id"] for c in alvos[0]["candidates"]] == [CAFE]


@pytest.mark.asyncio
async def test_sem_antecedente_continua_perguntando(monkeypatch):
    """A trava destrutiva não afrouxou: sem ninguém apontado, pergunta.

    É o comportamento que `por_transacao` já protegia — "apaga aquilo" não pode
    eleger a última linha do workspace em silêncio.
    """
    recentes = [
        {"id": f"{i}", "kind": "expense", "amount_cents": 100 * i, "category": "x",
         "description": None, "occurred_at": "2026-09-0{}".format(i)}
        for i in range(1, 5)
    ]
    monkeypatch.setattr(resolve.db, "fetch", _fetch_de(recentes))
    alvos = await resolve.for_actions(
        "ws", [_acao(description="esse lançamento")], "apague esse lançamento",
        antecedente=None,
    )
    assert alvos[0]["status"] == "ambiguous"


@pytest.mark.asyncio
async def test_antecedente_ja_apagado_pergunta_em_vez_de_mirar_no_vazio(monkeypatch):
    """Depois de apagar, não existe mais "esse".

    O id do DELETE também é gravado como escrita do turno; quem lê revalida a
    existência, e a linha morta tem que cair na pergunta — nunca virar alvo.
    """
    async def fetch_one(sql, *args):
        return None  # a linha não existe mais

    monkeypatch.setattr(resolve.db, "fetch_one", fetch_one)
    monkeypatch.setattr(resolve.db, "fetch", _fetch_de([
        {"id": "a", "kind": "expense", "amount_cents": 100, "category": "x",
         "description": None, "occurred_at": "2026-09-01"},
        {"id": "b", "kind": "expense", "amount_cents": 200, "category": "y",
         "description": None, "occurred_at": "2026-09-02"},
    ]))

    alvos = await resolve.for_actions(
        "ws", [_acao(description="isso")], "apaga isso", antecedente=CAFE
    )
    assert alvos[0]["status"] == "ambiguous"


@pytest.mark.asyncio
async def test_termo_de_verdade_ignora_o_antecedente(monkeypatch):
    """Quem DISSE o que quer não é redirecionado para o último.

    "apaga o gasto do mercado" tem termo: o antecedente não pode sequestrar a
    busca, senão o agente apagaria o café.
    """
    async def nunca(*a, **kw):
        raise AssertionError("tinha termo de busca: o antecedente não devia ser lido")

    monkeypatch.setattr(resolve.db, "fetch", _fetch_de([
        {"id": "mercado-1", "kind": "expense", "amount_cents": 4500,
         "category": "mercado", "description": "mercado",
         "occurred_at": "2026-09-08"}]))
    monkeypatch.setattr(resolve.db, "fetch_one", nunca)

    alvos = await resolve.for_actions(
        "ws", [_acao(description="mercado")], "apaga o gasto do mercado",
        antecedente=CAFE,
    )
    assert [c["id"] for c in alvos[0]["candidates"]] == ["mercado-1"]


@pytest.mark.asyncio
async def test_candidatos_da_mesma_serie_sao_distinguiveis(monkeypatch):
    """Quatro ocorrências de um salário não podem sair com o rótulo idêntico.

    Era o que a pergunta de produção mostrava: `receita de R$ 4.000,00 em
    *salário* (Salário PJ)` quatro vezes, sem nada que separasse uma da outra.
    """
    ocorrencias = [
        {"id": f"s{i}", "kind": "income", "amount_cents": 400000,
         "category": "salário", "description": "Salário PJ",
         "occurred_at": f"2026-{9 + i:02d}-05"}
        for i in range(4)
    ]
    monkeypatch.setattr(resolve.db, "fetch", _fetch_de(ocorrencias))
    alvos = await resolve.for_actions(
        "ws", [_acao(description="esse lançamento")], "apaga esse lançamento"
    )

    vistos = [f"{c['label']} {c.get('when', '')}" for c in alvos[0]["candidates"]]
    assert len(set(vistos)) == len(vistos), f"opções indistinguíveis: {vistos}"


class TestMemoriaCurtaAtravessaOTurno:
    """O elo entre quem escreve o antecedente e quem o lê no turno seguinte."""

    def test_o_reducer_preserva_quando_o_turno_nao_escreveu_nada(self):
        """`""` no início do turno quer dizer "não escrevi", não "esqueça".

        `test_state_reset` obriga toda chave a ser declarada a cada turno, e o
        worker manda `""`. Se isso apagasse a memória, o antecedente morreria
        antes de servir para alguma coisa — que é o defeito ao contrário.
        """
        import typing

        from app.graph import state as state_mod
        from app.graph.state import AgentState

        hints = typing.get_type_hints(
            AgentState, include_extras=True, globalns=vars(state_mod)
        )
        reducer = hints["last_write_id"].__metadata__[0]

        assert reducer(CAFE, "") == CAFE, "o turno silencioso apagou o antecedente"
        assert reducer(CAFE, "outro") == "outro", "a escrita nova tem que mandar"
        assert reducer(None, "") == ""

    @pytest.mark.asyncio
    async def test_o_executor_publica_o_que_escreveu(self, monkeypatch):
        """Sem isto o antecedente nunca sai do turno em que foi criado."""
        from app.graph import nodes

        async def executar_falso(state, indexadas):
            return ["💸 Gasto de R$ 20,00."], None, None, [CAFE]

        monkeypatch.setattr(nodes, "_executar", executar_falso)
        monkeypatch.setattr(nodes, "_actions", lambda state: [])
        monkeypatch.setattr(nodes, "_incompletas", lambda state, acoes: set())

        saida = await nodes.execute_node({"results": []})

        assert saida["last_write_id"] == CAFE
