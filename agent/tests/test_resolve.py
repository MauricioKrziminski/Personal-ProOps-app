"""O alvo de uma mutação se resolve ANTES da pergunta, e empate nunca executa.

Dois bugs que este módulo existe para matar, ambos medidos em 31/08/2026:

1. `resolve.por_transacao` devolvia `found` na transação MAIS RECENTE
   quando a ação não trazia nenhum campo de busca — então "apaga aquilo" apagava
   silenciosamente o último lançamento.
2. A pergunta de confirmação era montada com os campos CRUS do modelo, então o
   usuário lia "apagar a nota sobre última mensagem" em vez da linha real.
"""

import pytest

from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve


def _tx(id_, cents, cat, desc=None, data="2026-08-30"):
    return {"id": id_, "kind": "expense", "amount_cents": cents,
            "category": cat, "description": desc, "occurred_at": data}


@pytest.fixture
def linhas(monkeypatch):
    """Dubla `db.fetch`; devolve a lista que o teste configurar."""
    caixa = {"linhas": []}

    async def fake_fetch(sql, *args):
        return caixa["linhas"]

    monkeypatch.setattr(resolve.db, "fetch", fake_fetch)
    return caixa


class TestVeredito:
    def test_zero_um_e_varios(self):
        assert resolve.veredito([], str, "notes")[0] == "none"
        assert resolve.veredito([{"id": "1"}], lambda r: "x", "notes")[0] == "found"
        est, cands = resolve.veredito([{"id": "1"}, {"id": "2"}], lambda r: "x", "notes")
        assert est == "ambiguous" and len(cands) == 2

    def test_candidato_carrega_rotulo_e_tabela(self):
        _, cands = resolve.veredito([{"id": "9"}], lambda r: "gasto de R$ 45", "transactions")
        assert cands[0]["id"] == "9"
        assert cands[0]["label"] == "gasto de R$ 45"


class TestPorTransacao:
    @pytest.mark.asyncio
    async def test_sem_pista_e_sem_recencia_NAO_elege_a_mais_recente(self, linhas):
        # este é o teste que mata o `if not filtrou: return "found", candidatos[:1]`
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber"),
                            _tx("c", 1200, "cafe"), _tx("d", 900, "pao")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "ambiguous", "sem pista nenhuma não pode eleger ninguém"
        # mostra os recentes para o usuário escolher; o teto é `MOSTRAR`, que
        # existe para caber na Lista Interativa (10 linhas, a última é "nenhuma")
        assert 1 < len(cands) <= resolve.MOSTRAR

    @pytest.mark.asyncio
    async def test_sem_pista_COM_recencia_pega_a_mais_recente(self, linhas):
        # "apaga o último" continua funcionando — agora explícito, não por acidente
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=True)

        assert estado == "found" and cands[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_filtro_por_valor_acha_um(self, linhas):
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, amount_cents=3000)

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "b"

    @pytest.mark.asyncio
    async def test_termo_que_nao_casa_com_nada_e_NONE_nunca_a_lista(self, linhas):
        """O defeito de 15/09/2026, na frase do dono do produto: *"eu pedi para
        ele remover o lançamento nuuvem e ele me deu uma lista de um monte de
        lançamento nada a ver junto"*.

        O termo era a ÚNICA pista, não casava com nada, o filtro se descartava
        em silêncio e `filtrou` ficava False — então a função caía na janela dos
        40 mais recentes e devolvia `ambiguous` sobre lançamentos que a pessoa
        nunca citou.
        """
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber"),
                            _tx("c", 1200, "cafe")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="nuuvem")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "none" and cands == []

    @pytest.mark.asyncio
    async def test_termo_que_nao_casa_NEM_COM_recencia_vira_a_mais_recente(self, linhas):
        """Este é o ramo PERIGOSO do mesmo defeito, e por isso tem teste próprio.

        "apaga o último lançamento da nuuvem" trazia `quer_recente=True`: com
        `filtrou` False o código caía em `linhas[:1]` e devolvia **found** na
        transação mais recente — um DELETE confirmado com uma frase que nomeava
        outro lançamento. A lista era o ramo menos grave.
        """
        linhas["linhas"] = [_tx("a", 4500, "mercado"), _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="nuuvem")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=True)

        assert estado == "none" and cands == []

    @pytest.mark.asyncio
    async def test_termo_que_casa_com_um_continua_achando(self, linhas):
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Feira do mercado"),
                            _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="feira")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_termo_que_casa_com_dois_continua_perguntando(self, linhas):
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Mercado Extra"),
                            _tx("b", 3000, "mercado", "Mercado Dia"),
                            _tx("c", 1200, "cafe")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="mercado")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "ambiguous" and {c["id"] for c in cands} == {"a", "b"}

    @pytest.mark.asyncio
    async def test_termo_casa_pela_CATEGORIA_e_isso_nao_pode_quebrar(self, linhas):
        """A busca é em descrição OU categoria. "apaga o juros" acha pela
        categoria mesmo sem a palavra na descrição — o `none` novo não pode
        cortar esse caminho legítimo."""
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Feira"),
                            _tx("b", 990, "juros", "IOF do rotativo")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="juros")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "b"

    @pytest.mark.asyncio
    async def test_termo_que_nao_casa_NAO_zera_uma_busca_por_VALOR(self, linhas):
        """A guarda original continua de pé, e é para este caso que ela existe.

        Com o valor já casando, um termo que não bate é ruído do modelo — não
        pode apagar um candidato que o usuário REALMENTE deu. É por isso que o
        `none` novo é `elif not filtrou`, nunca `else`.
        """
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Feira"),
                            _tx("b", 3000, "uber")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             amount_cents=4500, description="nuuvem")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_data_sem_nenhum_lancamento_naquele_dia_e_NONE(self, linhas):
        """Mesma régua para a outra pista que o usuário pode dar sozinha:
        "apaga o de 14/09" sem nada em 14/09 é "não achei", nunca a lista."""
        linhas["linhas"] = [_tx("a", 4500, "mercado", data="2026-09-10"),
                            _tx("b", 3000, "uber", data="2026-09-11")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             occurred_at="2026-09-14")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "none" and cands == []

    @pytest.mark.asyncio
    async def test_data_que_nao_casa_NAO_zera_uma_busca_por_texto(self, linhas):
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Feira", data="2026-09-10")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION,
                             description="feira", occurred_at="2026-09-14")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "a"

    @pytest.mark.asyncio
    async def test_banco_vazio_e_none(self, linhas):
        linhas["linhas"] = []
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION)
        estado, _ = await resolve.por_transacao("ws", acao, quer_recente=True)
        assert estado == "none"


def test_fonte_de_pendentes_aponta_para_a_tabela_REAL():
    """`mark_paid` usa a chave lógica "pendentes", mas o alvo precisa carregar
    "transactions" — a allowlist do `ensure_owned` rejeitaria a chave lógica."""
    assert resolve._FONTES["pendentes"]["table"] == "transactions"


def test_todo_tipo_de_TARGETS_tem_fonte():
    for tipo, fonte in resolve.TARGETS.items():
        assert fonte in resolve._FONTES or fonte == "transactions", (tipo, fonte)


class TestPlanoComoAlvo:
    """"apaga a TV" com 10 parcelas era um empate entre dez linhas iguais.

    A compra inteira passa a ser a PRIMEIRA opção — o que transforma o empate
    numa pergunta honesta ("a parcela ou a compra toda?") em vez de dez opções
    indistinguíveis.
    """

    def test_candidato_diz_de_que_tabela_e(self):
        """Sem isso, uma mesma pergunta não podia misturar plano e parcela: o
        `ensure_owned` receberia o id do plano com a tabela `transactions`."""
        estado, cands = resolve.veredito(
            [{"id": "p1", "description": "TV", "installments": 10,
              "total_cents": 840000, "first_occurred_at": "2026-05-31"}],
            resolve._rotulo_plano,
            "installment_plans",
            resolve._detalhe_plano,
        )
        assert estado == "found"
        assert cands[0]["table"] == "installment_plans"
        assert "10x" in cands[0]["label"]
        # valor e data vão na descrição, que tem 72 caracteres, não no título
        assert "R$ 8.400,00" in cands[0]["when"]

    def test_o_escopo_sobrevive_ao_corte_da_meta(self):
        """Nome longo é normal, e `_cut` corta no fim. O que não pode sumir é o
        "Tudo (10x)" — sem ele a compra inteira e uma parcela solta apareceriam
        na mesma pergunta com rótulos quase idênticos."""
        from app.services.whatsapp import ROW_TITLE_MAX, _cut

        rotulo = resolve._rotulo_plano(
            {"description": "Televisão da sala de estar", "installments": 10}
        )
        assert _cut(rotulo, ROW_TITLE_MAX).startswith("Tudo (10x)")

    @pytest.mark.asyncio
    async def test_compra_parcelada_agrupa_no_plano_sem_listar_parcelas(self, monkeypatch):
        async def fake_fetch(query, *args):
            return [{
                "tx_id": "tx-1",
                "plan_id": "p1",
                "description": "TV",
                "installments": 10,
                "total_cents": 840000,
                "first_occurred_at": "2026-05-31",
            }]

        monkeypatch.setattr(resolve.db, "fetch", fake_fetch)
        cands = await resolve._com_plano(
            "ws", [{"id": "tx-1", "label": "TV (1/10)", "table": "transactions"}]
        )
        assert len(cands) == 1
        assert cands[0]["table"] == "installment_plans"
        assert cands[0]["id"] == "p1"

    @pytest.mark.asyncio
    async def test_parcelas_de_planos_diferentes_agrupam_em_seus_planos(self, monkeypatch):
        async def fake_fetch(query, *args):
            return [
                {
                    "tx_id": "tx-1",
                    "plan_id": "p1",
                    "description": "TV",
                    "installments": 10,
                    "total_cents": 840000,
                    "first_occurred_at": "2026-05-31",
                },
                {
                    "tx_id": "tx-2",
                    "plan_id": "p2",
                    "description": "Mac",
                    "installments": 12,
                    "total_cents": 1200000,
                    "first_occurred_at": "2026-06-30",
                },
            ]

        monkeypatch.setattr(resolve.db, "fetch", fake_fetch)
        original = [
            {"id": "tx-1", "label": "TV (1/10)", "table": "transactions"},
            {"id": "tx-2", "label": "Mac (2/12)", "table": "transactions"},
        ]
        cands = await resolve._com_plano("ws", original)
        assert len(cands) == 2
        assert {c["id"] for c in cands} == {"p1", "p2"}
        assert all(c["table"] == "installment_plans" for c in cands)

    @pytest.mark.asyncio
    async def test_sem_candidato_nao_inventa_plano(self, monkeypatch):
        async def explode(*a, **k):
            raise AssertionError("não devia consultar o banco sem candidatos")

        monkeypatch.setattr(resolve.db, "fetch", explode)
        assert await resolve._com_plano("ws", []) == []


class TestJanelaDeReferencia:
    """A janela é o PASSADO primeiro — foi 40 de 40 no futuro em produção.

    Em 10/09/2026 o materializador passou de 90 para 365 dias e o cron gravou 200 ocorrências
    futuras num instante só. Ordenada por `created_at desc`, a janela dos 40 ficou inteira em
    2027 e nenhuma das 103 transações que aconteceram sobrava nela: "apaga o último gasto"
    resolvia para *Manutenção dentista de 10/08/2027*.

    Não dá para provar isso com dublê — quem ordena é o Postgres. O que este teste prende é a
    FORMA da consulta: as duas metades e o corte em `current_date`. Sem elas o defeito volta e
    a suíte inteira continua verde, que foi exatamente o que aconteceu.
    """

    @pytest.mark.asyncio
    async def test_a_consulta_separa_passado_de_futuro(self, monkeypatch):
        vistos: list[str] = []

        async def fake_fetch(sql, *args):
            vistos.append(sql)
            return []

        monkeypatch.setattr(finance.db, "fetch", fake_fetch)
        await finance.reference_window("ws-1")

        sql = " ".join(vistos[0].split())
        antes, depois = "t.occurred_at <= current_date", "t.occurred_at > current_date"
        assert antes in sql, "sem o corte, o futuro ocupa a janela toda"
        assert depois in sql, "a parcela do mês que vem tem que ser alcançável"
        assert sql.index(antes) < sql.index(depois), (
            "o passado vem primeiro: é o que 'o último' quer dizer"
        )
        assert "order by t.occurred_at desc" in sql, "ordenar por created_at é o que quebrou"

    @pytest.mark.asyncio
    async def test_a_pista_alcanca_o_futuro(self, monkeypatch):
        """Alvo NOMEADO no futuro tem que caber, senão "não achei" vira mentira.

        Sem isto a metade futura são as 10 ocorrências mais PRÓXIMAS — uma semana, com as 200
        linhas futuras que existem em produção. "Muda a parcela do Mac de outubro" cairia fora
        da janela e o agente responderia que não achou um lançamento que existe. É pedido
        legítimo: `update_transaction_scoped` existe exatamente para ele.
        """
        vistos: list[str] = []

        async def fake_fetch(sql, *args):
            vistos.append(sql)
            return []

        monkeypatch.setattr(finance.db, "fetch", fake_fetch)
        await finance.reference_window(
            "ws-1", FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, description="Mac")
        )

        sql = " ".join(vistos[0].split())
        futuro = sql[sql.index("t.occurred_at > current_date") :]
        assert "p.termo" in futuro and "ilike" in futuro, "texto tem que alcançar o futuro"
        assert "p.cents" in futuro, "valor tem que alcançar o futuro"
        assert "p.dia" in futuro, "data tem que alcançar o futuro"
        assert "p.termo is null and p.cents is null and p.dia is null" in futuro, (
            "sem pista nenhuma o futuro entra por proximidade — ali ele é contexto, não alvo"
        )


class TestNaoAcheiCitaOTermo:
    """A resposta ao usuário diz o que FALHOU, e o que falhou é o que ele disse.

    Medido em 15/09/2026: *"remove o lançamento nuuvem"* devolvia uma lista de
    lançamentos que ele nunca citou. Com o `none` novo a lista some — e se a
    frase continuasse genérica ("não achei esse item por aqui"), ele remandaria
    a mesma mensagem sem saber que o problema era a palavra.
    """

    def _msg(self, **campos):
        from app.tools import registry

        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, **campos)
        return registry._sem_alvo({"status": "none", "candidates": []}, acao)

    def test_cita_o_termo_que_o_usuario_deu(self):
        assert "nuuvem" in self._msg(description="nuuvem")

    def test_ponteiro_NAO_vira_termo_citado(self):
        """"apaga esse lançamento" sem antecedente vivo não achou nada — mas
        "esse lançamento" é ponteiro, não nome. Citá-lo seria devolver à pessoa
        a palavra dela como se fosse um nome de estabelecimento."""
        msg = self._msg(description="esse lançamento")
        assert "esse lançamento" not in msg and "Não achei esse item" in msg

    def test_sem_termo_nenhum_mantem_a_frase_antiga(self):
        assert "Não achei esse item" in self._msg()

    def test_empate_continua_listando(self):
        from app.tools import registry

        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, description="mercado")
        msg = registry._sem_alvo(
            {"status": "ambiguous", "candidates": [{"label": "gasto A"}, {"label": "gasto B"}]},
            acao,
        )
        assert "gasto A" in msg and "gasto B" in msg

    def test_empate_de_linhas_iguais_mostra_a_data_que_as_separa(self):
        """Medido no staging em 15/09/2026: nove linhas escritas "gasto de
        R$ 55,90 em *lazer* (Assinatura de streaming)", idênticas — é o que uma
        série recorrente sempre produz, já que o que muda é só a data. É a mesma
        regra que `veredito` já aplica na lista do WhatsApp."""
        from app.tools import registry

        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, description="streaming")
        msg = registry._sem_alvo(
            {"status": "ambiguous", "candidates": [
                {"label": "gasto de R$ 55,90", "when": "10/09/2026"},
                {"label": "gasto de R$ 55,90", "when": "10/10/2026"},
            ]},
            acao,
        )
        assert "10/09/2026" in msg and "10/10/2026" in msg


class TestTermoCasaOEstabelecimento:
    """O nome pode morar em `merchant`, e a busca do APP já casava os três campos.

    Até 15/09/2026 o agente casava só `description` e `category`. Com a correção do app —
    que parou de descartar o "Estabelecimento" ao criar compra parcelada —, uma compra cujo
    nome vive em `merchant` passaria a existir no banco e mesmo assim o agente responderia
    "não achei nada com «nuuvem»". Duas pontas procurando coisas diferentes no mesmo dado.
    """

    @pytest.mark.asyncio
    async def test_casa_pelo_estabelecimento(self, linhas):
        linhas["linhas"] = [
            {**_tx("a", 4500, "mercado", "Feira"), "merchant": None},
            {**_tx("b", 10499, None, "Compra parcelada (1/2)"), "merchant": "nuuvem wardog"},
        ]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, description="nuuvem")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "b"

    @pytest.mark.asyncio
    async def test_linha_sem_a_coluna_nao_explode(self, linhas):
        """`_antecedente_da_conversa` e outras consultas não trazem `merchant` — o filtro
        lê com `.get`, então ausência da chave é ausência de casamento, nunca KeyError."""
        linhas["linhas"] = [_tx("a", 4500, "mercado", "Feira")]
        acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, description="feira")

        estado, cands = await resolve.por_transacao("ws", acao, quer_recente=False)

        assert estado == "found" and cands[0]["id"] == "a"


class TestPlanoCongelaOQueAFraseLe:
    """A frase do SIM e a pergunta da unidade leem `editaveis`/`travado_cents`/
    `total_cents`/`plan_installments` do candidato — congelados na resolução, pela
    régua do BANCO (`private.parcela_travada`), nunca contando `status` em Python."""

    def test_as_duas_consultas_de_plano_usam_a_regua_do_banco(self):
        from app.tools.resolve import _FONTES, _TRAVAS_DO_PLANO

        assert "private.parcela_travada(t.status, t.invoice_id)" in _TRAVAS_DO_PLANO
        assert "t.workspace_id = p.workspace_id" in _TRAVAS_DO_PLANO
        assert _TRAVAS_DO_PLANO in _FONTES["planos"]["sql"]

    @pytest.mark.asyncio
    async def test_com_plano_congela_os_campos(self, monkeypatch):
        consultas = []

        async def fake_fetch(query, *args):
            consultas.append(query)
            return [{"tx_id": "tx-1", "plan_id": "p1", "description": "TV", "installments": 10,
                     "total_cents": 300000, "first_occurred_at": "2026-05-31",
                     "editaveis": 8, "travado_cents": 60000}]

        monkeypatch.setattr(resolve.db, "fetch", fake_fetch)
        cand = (await resolve._com_plano("ws", [{"id": "tx-1", "table": "transactions"}]))[0]
        assert "parcela_travada" in consultas[0]
        assert (cand["editaveis"], cand["travado_cents"], cand["total_cents"],
                cand["plan_installments"]) == (8, 60000, 300000, 10)

    def test_veredito_de_plano_congela_os_campos(self):
        _, cands = resolve.veredito(
            [{"id": "p1", "description": "TV", "installments": 10, "total_cents": 300000,
              "editaveis": 8, "travado_cents": 60000}],
            resolve._rotulo_plano, "installment_plans", resolve._detalhe_plano,
        )
        assert (cands[0]["editaveis"], cands[0]["travado_cents"],
                cands[0]["total_cents"]) == (8, 60000, 300000)


class TestSnapshotDeCorrecao:
    @staticmethod
    def _linhas(query, *args):
        return [{"id": f"tx{n}", "installment_no": n, "amount_cents": 1000,
                 "occurred_at": "2026-05-15", "status": "pending", "paid_at": None,
                 "account_id": None, "invoice_id": None, "account_name": None,
                 "travada": n == 3} for n in range(1, 5)]

    @pytest.mark.asyncio
    async def test_congela_a_trava_do_banco_e_rotulo_no_singular(self, monkeypatch):
        from app.graph.schemas import InstallmentScope

        consultas = []

        async def fetch(query, *args):
            consultas.append(query)
            return self._linhas(query)

        monkeypatch.setattr(resolve.db, "fetch", fetch)
        alvo = await resolve._bounded_plan_target(
            "ws", [{"id": "p1", "label": "Tudo (4x) — TV", "plan_installments": 4}],
            InstallmentScope(mode="range", start=3, end=3), correcao=True,
        )
        assert "private.parcela_travada(t.status, t.invoice_id) as travada" in consultas[0]
        cand = alvo["candidates"][0]
        assert cand["installment_snapshot"]["rows"][0]["travada"] is True
        assert cand["label"] == "parcela 3 — TV"

    @pytest.mark.asyncio
    async def test_erro_de_escopo_na_correcao_nao_fala_em_pagar(self, monkeypatch):
        from app.graph.schemas import InstallmentScope

        async def fetch(query, *args):
            return self._linhas(query)

        monkeypatch.setattr(resolve.db, "fetch", fetch)
        alvo = await resolve._bounded_plan_target(
            "ws", [{"id": "p1", "label": "Tudo (4x) — TV", "plan_installments": 4}],
            InstallmentScope(mode="range", start=7, end=7), correcao=True,
        )
        assert alvo["correction_error"] and "pag" not in alvo["correction_error"].lower()


@pytest.mark.asyncio
async def test_conta_padrao_congela_o_nome_so_onde_ela_vai_valer(monkeypatch):
    """Toda escrita pede SIM (21/09/2026): a frase diz a conta que o usuário não citou."""
    from app import db

    consultas = []

    async def fetch_one(sql, *args):
        consultas.append(args)
        return {"id": "acc-nu", "name": "Nubank"}

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    acoes = [
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500),
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100, account="Itaú"),
        FinanceAction(type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, amount_cents=100),
        FinanceAction(type=FinanceActionType.CREATE_INCOME, amount_cents=100),
    ]
    alvos = await resolve.conta_padrao("w1", acoes, [{}, {}, {}, {"correction_error": "x"}])
    # o ID vai junto: é ele que a tool grava, sem reler o padrão no SIM
    assert alvos[0] == {"default_account": {"id": "acc-nu", "name": "Nubank"}}
    assert alvos[1] == {} and alvos[2] == {}  # citou conta; parcelado pede cartão
    assert "default_account" not in alvos[3]  # já vai parar antes do SIM
    assert len(consultas) == 1  # uma query por turno

    consultas.clear()
    assert await resolve.conta_padrao("w1", acoes[1:3], [{}, {}]) == [{}, {}]
    assert consultas == []



@pytest.mark.asyncio
async def test_transferencia_sem_origem_nem_padrao_recusa_antes_do_sim(monkeypatch):
    from app import db

    async def sem_padrao(sql, *args):
        return {"id": None, "name": None}

    monkeypatch.setattr(db, "fetch_one", sem_padrao)
    sem_origem = FinanceAction(type=FinanceActionType.CREATE_TRANSFER, amount_cents=100,
                               counterparty_account="Poupança")
    sem_destino = FinanceAction(type=FinanceActionType.CREATE_TRANSFER, amount_cents=100,
                                account="Nubank")
    com_as_duas = FinanceAction(type=FinanceActionType.CREATE_TRANSFER, amount_cents=100,
                                account="Nubank", counterparty_account="Poupança")
    alvos = await resolve.conta_padrao("w1", [sem_origem, sem_destino, com_as_duas], [{}, {}, {}])
    assert alvos[0]["correction_error"] == resolve.SEM_DUAS_CONTAS
    assert alvos[1]["correction_error"] == resolve.SEM_DUAS_CONTAS
    assert "correction_error" not in alvos[2]


@pytest.mark.asyncio
async def test_tool_grava_na_conta_padrao_CONGELADA_e_confere_a_posse(monkeypatch):
    """A frase disse Nubank: o SIM grava na Nubank mesmo se o padrão mudou no meio."""
    from app import db
    from app.tools.base import ExecContext

    donos = []

    async def fetch_one(sql, *args):
        donos.append(args)
        return {"archived": False}

    async def releu(*a, **k):
        raise AssertionError("não relê o padrão: ele foi congelado na pergunta")

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance, "default_account", releu)
    ctx = ExecContext("u1", "w1", None, "America/Sao_Paulo", "gastei 45", "m1")
    ctx.target = {"default_account": {"id": "acc-nu", "name": "Nubank"}}
    assert await finance._conta_padrao(ctx) == "acc-nu"
    assert donos == [("acc-nu", "w1")]  # posse conferida no workspace da conversa

    ctx.target = {"default_account": {"id": None, "name": None}}
    assert await finance._conta_padrao(ctx) is None


@pytest.mark.asyncio
async def test_apagar_nota_sem_dizer_qual_pergunta_em_vez_de_listar(monkeypatch):
    """P6 (bateria de 21/09/2026): um `delete_note` sem alvo não vira lista de notas."""
    from app.graph.schemas import NotesAction, NotesActionType

    async def fetch(sql, *args):
        return [{"id": "n1", "title": "reunião", "content": "x", "created_at": "2026-09-20"},
                {"id": "n2", "title": "mercado", "content": "y", "created_at": "2026-09-19"}]

    monkeypatch.setattr(resolve.db, "fetch", fetch)
    sem_alvo = NotesAction(type=NotesActionType.DELETE_NOTE)
    (alvo,) = await resolve.for_actions("w1", [sem_alvo], "apaga a nota")
    assert alvo["status"] == "none" and "Qual nota" in alvo["correction_error"]

    # "a última" é pedido explícito de recência: segue resolvendo
    (alvo,) = await resolve.for_actions("w1", [sem_alvo], "apaga a última nota")
    assert "correction_error" not in alvo


@pytest.mark.asyncio
async def test_conta_padrao_arquivada_nao_entra_na_frase(monkeypatch):
    """X1: a query do congelamento só aceita conta padrão ATIVA."""
    from app import db

    sqls = []

    async def fetch_one(sql, *args):
        sqls.append(sql)
        return {"id": None, "name": None}

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    await resolve.conta_padrao("w1", [FinanceAction(type=FinanceActionType.CREATE_EXPENSE,
                                                    amount_cents=100)], [{}])
    assert "not a.archived" in sqls[0]


@pytest.mark.asyncio
async def test_tool_recusa_conta_padrao_arquivada_depois_da_pergunta(monkeypatch):
    """X1: a frase disse Nubank e ela foi arquivada antes do SIM: recusa, não grava nela."""
    from app import db
    from app.tools.base import ExecContext
    from app.tools.guards import Level1Error

    async def arquivada(sql, *args):
        return {"archived": True}

    monkeypatch.setattr(db, "fetch_one", arquivada)
    ctx = ExecContext("u1", "w1", None, "America/Sao_Paulo", "gastei 45", "m1")
    ctx.target = {"default_account": {"id": "acc-nu", "name": "Nubank"}}
    with pytest.raises(Level1Error):
        await finance._conta_padrao(ctx)


@pytest.mark.asyncio
async def test_padrao_relido_ignora_conta_arquivada(monkeypatch):
    from app import db

    sqls = []

    async def fetch_one(sql, *args):
        sqls.append(sql)
        return None

    monkeypatch.setattr(db, "fetch_one", fetch_one)
    assert await finance.default_account("w1") is None
    assert "not a.archived" in sqls[0]
