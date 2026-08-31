"""O fast-path do rascunho no worker — o caminho que o teste de usabilidade pegou.

Em 31/08/2026 três coisas falharam na mesma pergunta ("em qual cartão foi essa
compra?"): ela saía como texto livre em vez de menu, a frase inteira virava o
nome do cartão, e mesmo quando a validação passava era o TEXTO DIGITADO que ia
para `action.account` — então o `resolve_account` lá embaixo não achava a conta,
devolvia None, e a compra parcelada nascia sem cartão. Exatamente o que a regra
"cartão obrigatório em parcelado" existe para impedir.

Este arquivo cobre o fast-path inteiro, que até aqui não tinha teste nenhum.
"""

import pytest

from app import db, worker
from app.domain import confirm, draft

CARTOES = [
    {"id": "c1", "name": "Itaú", "type": "credit_card"},
    {"id": "c2", "name": "Nubank Cartão", "type": "credit_card"},
]

RASCUNHO = {
    "id": "d1",
    "phone": "5551999999999",
    "slot": "account",
    "missing": "💳 Em qual cartão foi essa compra?",
    "raw_text": "comprei um mac em 12x de 1000",
    "action": {
        "type": "create_installment_purchase",
        "amount_cents": 1200000,
        "installments": 12,
        "description": "mac",
        "account": None,
    },
}

SESSAO = {
    "phone": "5551999999999",
    "user_id": "11111111-1111-1111-1111-111111111111",
    "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": "America/Sao_Paulo",
    "thread_id": "t",
    "session_epoch": 1,
}


class TestPerguntaCartao:
    """A pergunta vira MENU. O clique executa sem passar por IA nenhuma."""

    def test_ate_dois_cartoes_viram_botoes(self):
        spec = worker._pergunta_cartao("d1", CARTOES, "Qual cartão?")
        assert spec["ui"] == "buttons"
        # 2 cartões + cancelar = os 3 que a Meta aceita
        assert len(spec["buttons"]) == 3
        assert spec["buttons"][0] == ("ds:d1:c:c1", "Itaú")
        assert spec["buttons"][-1][0] == "ds:d1:no"

    def test_tres_ou_mais_viram_lista(self):
        muitos = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(5)]
        spec = worker._pergunta_cartao("d1", muitos, "Qual cartão?")
        assert spec["ui"] == "list"
        assert len(spec["rows"]) == 6
        assert spec["rows"][0][0] == "ds:d1:c:c0"

    def test_lista_longa_respeita_o_limite_da_meta(self):
        muitos = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(30)]
        spec = worker._pergunta_cartao("d1", muitos, "Qual cartão?")
        # 9 cartões + a saída = as 10 linhas que a Meta aceita
        assert len(spec["rows"]) == 10

    def test_fallback_pede_o_NOME_e_nao_o_numero(self):
        """O rascunho não congela candidatos (`pending_actions` congela porque o
        resume depende do id), então um número digitado não teria a que se
        ancorar. Nome digitado a extração + o casamento normalizado resolvem."""
        spec = worker._pergunta_cartao("d1", CARTOES, "Qual cartão?")
        assert "nome" in spec["text"].lower()
        assert "Itaú" in spec["text"] and "Nubank Cartão" in spec["text"]

    def test_sem_cartao_nenhum_nao_finge_um_menu(self):
        msg = worker._pergunta_cartao("d1", [], "Qual cartão?")
        assert isinstance(msg, str)
        assert "cadastra" in msg.lower()


class TestCartaoDoRascunho:
    @pytest.fixture(autouse=True)
    def _sem_banco(self, monkeypatch):
        async def contas(workspace_id, *, only_cards=False):
            return CARTOES

        monkeypatch.setattr(db, "accounts", contas)

    @pytest.mark.asyncio
    async def test_grava_o_nome_CANONICO_e_nao_o_digitado(self):
        """O defeito silencioso: "nubank" era gravado como veio, e o `ilike` de
        baixo não achava "Nubank Cartão"."""
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "completar", "slot": "account", "account": "nubank"}
        )
        assert resposta is None
        assert decidido["account"] == "Nubank Cartão"

    @pytest.mark.asyncio
    async def test_acento_errado_ainda_acha(self):
        decidido, _ = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "completar", "slot": "account", "account": "itau"}
        )
        assert decidido["account"] == "Itaú"

    @pytest.mark.asyncio
    async def test_clique_resolve_o_id_DENTRO_do_workspace(self):
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO,
            {"acao": "completar", "slot": "account", "account_id": "c1"},
        )
        assert resposta is None
        assert decidido["account"] == "Itaú"

    @pytest.mark.asyncio
    async def test_id_de_outro_workspace_nao_vira_argumento(self):
        """O id vem de um clique DO USUÁRIO. Usá-lo direto seria o IDOR que
        `ensure_owned` fecha nos outros caminhos."""
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO,
            {"acao": "completar", "slot": "account", "account_id": "de-outro-workspace"},
        )
        assert decidido is None
        assert resposta["ui"] == "buttons"

    @pytest.mark.asyncio
    async def test_empate_pergunta_em_vez_de_chutar(self, monkeypatch):
        """Lançar no cartão errado é pior que uma pergunta a mais."""

        async def dois_nubanks(workspace_id, *, only_cards=False):
            return [
                {"id": "c1", "name": "Nubank Roxinho"},
                {"id": "c2", "name": "Nubank Ultravioleta"},
            ]

        monkeypatch.setattr(db, "accounts", dois_nubanks)
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO,
            {"acao": "completar", "slot": "account", "account": "nubank"},
        )
        assert decidido is None
        # só os candidatos, não a lista inteira
        assert [b[1] for b in resposta["buttons"]] == [
            "Nubank Roxinho", "Nubank Ultravioleta", "Cancelar"
        ]

    @pytest.mark.asyncio
    async def test_cartao_inexistente_OFERECE_CADASTRO(self):
        """Era um beco: listava os cartões existentes e mandava cadastrar no app.
        Agora o cadastro acontece sem sair da compra."""
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO,
            {"acao": "completar", "slot": "account", "account": "banco do brasil"},
        )
        assert decidido is None
        assert "banco do brasil" in resposta["body"]
        ids = [b[0] for b in resposta["buttons"]]
        assert ids[0] == "ds:d1:create_card:banco do brasil"
        assert "ds:d1:retry_card" in ids  # há outros cartões para escolher

    @pytest.mark.asyncio
    async def test_sem_cartao_nenhum_tambem_oferece_cadastro(self, monkeypatch):
        """O caso mais duro: nenhum cartão existe. Sem a oferta, o usuário
        precisaria abrir o app e recomeçar a compra."""

        async def vazio(workspace_id, *, only_cards=False):
            return []

        monkeypatch.setattr(db, "accounts", vazio)
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "completar", "slot": "account", "account": "nubank"}
        )
        assert decidido is None
        ids = [b[0] for b in resposta["buttons"]]
        # sem outros cartões, "escolher outro" não faz sentido e não aparece
        assert ids == ["ds:d1:create_card:nubank", "ds:d1:no"]


class TestRoteamentoDoClique:
    """`ds:` é do rascunho, `pa:` é do HITL. Nenhum dos dois entra no grafo."""

    @pytest.fixture(autouse=True)
    def _sem_banco(self, monkeypatch):
        async def nada(*a, **k):
            return None

        async def contas(workspace_id, *, only_cards=False):
            return CARTOES

        monkeypatch.setattr(db, "expire_drafts", nada)
        monkeypatch.setattr(db, "expire_pending", nada)
        monkeypatch.setattr(db, "open_pending", nada)
        monkeypatch.setattr(db, "delete_draft", nada)
        monkeypatch.setattr(db, "accounts", contas)
        monkeypatch.setattr(db, "record_ai_event", nada)

    @pytest.mark.asyncio
    async def test_clique_em_cartao_executa_com_o_nome_canonico(self, monkeypatch):
        async def rascunho(phone):
            return RASCUNHO

        monkeypatch.setattr(db, "open_draft", rascunho)

        visto = {}

        async def rodar(sessao, lote, conteudo, acoes, thread, config, uso=None):
            visto["acoes"] = acoes
            return "feito"

        monkeypatch.setattr(worker, "_rodar_com_acoes", rodar)

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"clicked_id": "ds:d1:c:c2", "text": "Nubank Cartão"}
        )
        assert r == "feito"
        assert visto["acoes"][0]["account"] == "Nubank Cartão"

    @pytest.mark.asyncio
    async def test_clique_velho_expira_e_NUNCA_vira_lancamento(self, monkeypatch):
        """Sem esta trava, o rótulo da linha ("Nubank Cartão") seria lido como
        mensagem nova — a mesma classe de bug que o clique cruzado do HITL mata."""

        async def rascunho(phone):
            return RASCUNHO

        monkeypatch.setattr(db, "open_draft", rascunho)

        async def explode(*a, **k):
            raise AssertionError("clique velho não pode chegar no grafo")

        monkeypatch.setattr(worker, "_rodar_com_acoes", explode)

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}],
            {"clicked_id": "ds:rascunho-de-ontem:c:c2", "text": "Nubank Cartão"},
        )
        assert "expirou" in r

    @pytest.mark.asyncio
    async def test_clique_ds_sem_rascunho_aberto_cai_no_stale(self, monkeypatch):
        """Caminho alcançável por desenho: sem rascunho o `ds:` desce para o
        `confirm.decide`, que trata clique sem pendência como expirado."""

        async def sem_rascunho(phone):
            return None

        monkeypatch.setattr(db, "open_draft", sem_rascunho)

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"clicked_id": "ds:d1:c:c2", "text": "x"}
        )
        assert "expirou" in r

    @pytest.mark.asyncio
    async def test_clique_do_HITL_nao_e_desviado_para_o_rascunho(self, monkeypatch):
        async def rascunho(phone):
            return RASCUNHO

        monkeypatch.setattr(db, "open_draft", rascunho)

        async def explode(texto, rasc, uso=None):
            raise AssertionError("clique `pa:` é do HITL, não do rascunho")

        monkeypatch.setattr(draft, "interpretar", explode)

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"clicked_id": "pa:p1:ok", "text": "Confirmar"}
        )
        assert r is confirm.STALE or "expirou" in r


class TestRascunhoComPergunta:
    """Rascunho e `interrupt()` coexistem no mesmo turno.

    "comprei um mac em 12x e apaga o último": o mac vira rascunho (falta o
    cartão) e a deleção pausa o grafo. Emitir o menu do cartão antes de gravar
    `pending_actions` pularia o `create_pending` e deixaria o grafo parado num
    checkpoint que nenhum resume alcança — por isso o menu vem DEPOIS da pausa.
    """

    @pytest.fixture(autouse=True)
    def _sem_banco(self, monkeypatch):
        async def sem_rascunho_antigo(phone):
            return None

        async def salvar(**kwargs):
            return "d-novo"

        async def contas(workspace_id, *, only_cards=False):
            return CARTOES

        monkeypatch.setattr(db, "open_draft", sem_rascunho_antigo)
        monkeypatch.setattr(db, "save_draft", salvar)
        monkeypatch.setattr(db, "accounts", contas)

    def _estado(self, com_pausa: bool) -> dict:
        estado = {
            "reply": "💳 Em qual cartão foi essa compra?",
            "draft": {
                "action": RASCUNHO["action"],
                "raw_text": RASCUNHO["raw_text"],
                "missing": RASCUNHO["missing"],
                "slot": "account",
            },
        }
        if com_pausa:
            estado["__interrupt__"] = [
                {"summary": "apagar o gasto de R$ 45", "reason": "destrutiva",
                 "action_type": "delete_transaction", "kind": "confirmation"}
            ]
        return estado

    @pytest.mark.asyncio
    async def test_a_primeira_pergunta_ja_sai_como_menu(self):
        """Era ela que o teste de usabilidade pegou saindo como texto livre."""
        spec = await worker._resposta_do_estado(SESSAO, self._estado(False), "t:1")
        assert spec["ui"] == "buttons"
        assert spec["buttons"][0] == ("ds:d-novo:c:c1", "Itaú")
        # o corpo leva a resposta inteira, não só a pergunta
        assert "Em qual cartão" in spec["body"]

    @pytest.mark.asyncio
    async def test_a_pergunta_pendente_vence_e_o_grafo_nao_fica_orfao(self, monkeypatch):
        criado = {}

        async def create_pending(**kwargs):
            criado.update(kwargs)
            return {"id": "p1"}

        monkeypatch.setattr(db, "create_pending", create_pending)

        spec = await worker._resposta_do_estado(SESSAO, self._estado(True), "t:1")
        # o `create_pending` aconteceu: o interrupt tem como ser retomado
        assert criado["summary"] == "apagar o gasto de R$ 45"
        # e a mensagem é a confirmação, não o menu de cartão
        assert spec["buttons"][0][0] == "pa:p1:ok"


class TestCustoDoTurno:
    """`ai_events` é o que `private.plan_status_for` conta para o paywall mensal.

    Os fast-paths que classificam TEXTO chamam o Gemini e precisam gravar; o
    CLIQUE não chama nada e precisa continuar custando zero. Errar para qualquer
    um dos dois lados é cobrar diferente do que se entrega.
    """

    @pytest.fixture
    def eventos(self, monkeypatch):
        gravados = []

        async def nada(*a, **k):
            return None

        async def registrar(**kwargs):
            gravados.append(kwargs)

        async def contas(workspace_id, *, only_cards=False):
            return CARTOES

        for nome in ("expire_drafts", "expire_pending", "delete_draft"):
            monkeypatch.setattr(db, nome, nada)
        monkeypatch.setattr(db, "accounts", contas)
        monkeypatch.setattr(db, "record_ai_event", registrar)
        return gravados

    @pytest.mark.asyncio
    async def test_resposta_digitada_de_slot_consome_uma_mensagem(self, eventos, monkeypatch):
        """O fast-path retorna antes do grafo, então ninguém gravaria por ele —
        e o classificador chama o Gemini de verdade."""

        async def rascunho(phone):
            return RASCUNHO

        async def interpretar(texto, rasc, uso=None):
            uso["llm_calls"] = 1
            return {"acao": "descartar"}

        monkeypatch.setattr(db, "open_draft", rascunho)
        monkeypatch.setattr(draft, "interpretar", interpretar)

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"text": "esquece aquilo"}
        )
        assert "esqueci" in r
        assert len(eventos) == 1
        assert eventos[0]["result"]["llm_calls"] == 1

    @pytest.mark.asyncio
    async def test_clique_no_cartao_nao_gasta_modelo(self, eventos, monkeypatch):
        async def rascunho(phone):
            return RASCUNHO

        async def rodar(sessao, lote, conteudo, acoes, thread, config, uso=None):
            await worker._audit(sessao, {"llm_calls": 0}, uso)
            return "feito"

        monkeypatch.setattr(db, "open_draft", rascunho)
        monkeypatch.setattr(worker, "_rodar_com_acoes", rodar)

        await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"clicked_id": "ds:d1:c:c1", "text": "Itaú"}
        )
        assert eventos == []

    @pytest.mark.asyncio
    async def test_clique_continua_custando_ZERO(self, eventos, monkeypatch):
        """O estado que volta do checkpoint ainda carrega o `llm_calls` do turno
        da PERGUNTA, que já foi cobrado. Somá-lo aqui faria um clique consumir
        mensagem da cota."""

        async def sem_rascunho(phone):
            return None

        async def pendencia(phone):
            return {"id": "p1", "thread_id": "t:1", "summary": "apagar X", "action": {}}

        async def resolver(*a, **k):
            return None

        monkeypatch.setattr(db, "open_draft", sem_rascunho)
        monkeypatch.setattr(db, "open_pending", pendencia)
        monkeypatch.setattr(db, "resolve_pending", resolver)

        class _Grafo:
            async def ainvoke(self, entrada, config=None):
                # o checkpoint devolve o gasto do turno da pergunta
                return {"reply": "apagado", "llm_calls": 2}

        import app.graph.build as build

        monkeypatch.setattr(build, "graph", lambda: _Grafo())

        r = await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}], {"clicked_id": "pa:p1:ok", "text": "Confirmar"}
        )
        assert r == "apagado"
        assert eventos == []


class TestPerguntaDoTipoDeValor:
    """A ambiguidade vira botão, e o valor viaja no payload."""

    def test_os_dois_numeros_aparecem_no_corpo(self):
        """Botão da Meta tem 20 caracteres: "R$ 12.345,67 no total" já não cabe,
        e truncado as duas opções ficariam parecidas justamente na parte que as
        distingue. Os números vão no corpo, que tem 1024."""
        spec = worker._pergunta_tipo_valor("d1", 70000, 12)
        assert "R$ 700,00" in spec["body"] and "R$ 8.400,00" in spec["body"]
        assert [b[0] for b in spec["buttons"]] == ["ds:d1:t:70000", "ds:d1:p:70000"]
        assert all(len(b[1]) <= 20 for b in spec["buttons"])

    @pytest.mark.asyncio
    async def test_clique_em_cada_parcela_grava_o_total(self, monkeypatch):
        async def nada(*a, **k):
            return None

        async def rascunho(phone):
            return {**RASCUNHO, "slot": "amount",
                    "action": {**RASCUNHO["action"], "amount_cents": None, "account": "Itaú"}}

        visto = {}

        async def rodar(sessao, lote, conteudo, acoes, thread, config, uso=None):
            visto["acoes"] = acoes
            return "feito"

        for nome in ("expire_drafts", "expire_pending", "open_pending", "delete_draft",
                     "record_ai_event"):
            monkeypatch.setattr(db, nome, nada)
        monkeypatch.setattr(db, "open_draft", rascunho)
        monkeypatch.setattr(worker, "_rodar_com_acoes", rodar)

        await worker._run_graph(
            SESSAO, [{"wa_message_id": "w1"}],
            {"clicked_id": "ds:d1:p:70000", "text": "É cada parcela"},
        )
        # 700 x 12 = 8.400, não 700
        assert visto["acoes"][0]["amount_cents"] == 840000


class TestMuitosCartoes:
    def test_cartao_que_nao_coube_nao_some_em_silencio(self):
        """O cartão existe, não aparece, e o usuário conclui que não está
        cadastrado — o pior dos mundos. Digitar o nome alcança todos, porque o
        casamento roda sobre a lista inteira."""
        muitos = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(14)]
        spec = worker._pergunta_cartao("d1", muitos, "Qual cartão?")
        assert len(spec["rows"]) == 10  # 9 + a saída, o limite da Meta
        assert "+5" in spec["body"]
        assert "+5" in spec["text"]

    def test_lista_que_cabe_nao_ganha_aviso(self):
        poucos = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(4)]
        spec = worker._pergunta_cartao("d1", poucos, "Qual cartão?")
        assert "+" not in spec["body"]


class TestCadastroDeCartaoNaHora:
    """Cartão que não existe deixou de ser beco sem saída.

    Antes: "cadastra no app e me fala o nome" — o usuário saía do WhatsApp,
    cadastrava, voltava e repetia a compra inteira.
    """

    @pytest.fixture(autouse=True)
    def _banco(self, monkeypatch):
        self.criados = []

        async def contas(workspace_id, *, only_cards=False):
            return CARTOES

        async def criar(*, workspace_id, user_id, name):
            self.criados.append(name)
            return {"id": "novo", "name": name, "type": "credit_card"}

        monkeypatch.setattr(db, "accounts", contas)
        monkeypatch.setattr(db, "create_credit_card", criar)

    @pytest.mark.asyncio
    async def test_clique_cria_e_devolve_o_nome_do_BANCO(self):
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "criar_cartao", "name": "Banco do Brasil"}
        )
        assert resposta is None
        assert self.criados == ["Banco do Brasil"]
        # o nome que segue é o que o banco gravou, não o que o usuário digitou
        assert decidido["account"] == "Banco do Brasil"
        assert decidido["cartao_criado"] == "Banco do Brasil"

    @pytest.mark.asyncio
    async def test_escolher_outro_volta_para_a_lista(self):
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "escolher_cartao"}
        )
        assert decidido is None
        assert [b[1] for b in resposta["buttons"]] == ["Itaú", "Nubank Cartão", "Cancelar"]

    @pytest.mark.asyncio
    async def test_falha_ao_criar_nao_derruba_a_conversa(self, monkeypatch):
        async def falhou(*, workspace_id, user_id, name):
            return None

        monkeypatch.setattr(db, "create_credit_card", falhou)
        decidido, resposta = await worker._cartao_do_rascunho(
            SESSAO, RASCUNHO, {"acao": "criar_cartao", "name": "Inter"}
        )
        assert decidido is None
        assert isinstance(resposta, str) and "tenta de novo" in resposta.lower()

    def test_o_ciclo_assumido_e_DITO_ao_usuario(self):
        """`set_invoice` precisa de fechamento e vencimento, e mudar os dias
        depois não reprocessa lançamento já gravado — então a suposição não pode
        ficar muda."""
        texto = worker._com_aviso_de_cartao("🧾 Parcelado: R$ 8.400,00", "Nubank")
        assert "Criei o cartão *Nubank*" in texto
        assert f"dia {db.CARTAO_FECHAMENTO_PADRAO}" in texto
        assert f"dia {db.CARTAO_VENCIMENTO_PADRAO}" in texto
        assert "R$ 8.400,00" in texto

    def test_sem_cartao_criado_a_resposta_passa_intacta(self):
        assert worker._com_aviso_de_cartao("ok", None) == "ok"

    def test_nome_longo_nao_estoura_o_id_do_botao(self):
        """O id do botão da Meta tem 256 caracteres e o nome viaja dentro dele."""
        longo = "Cartão " + "muito " * 40
        spec = worker._pergunta_criar_cartao("d1", draft.nome_de_cartao(longo), [])
        assert all(len(b[0]) <= 256 for b in spec["buttons"])
