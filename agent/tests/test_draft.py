"""Rascunho: extração incompleta que espera o dado que falta.

"comprei um mac em 12x" tem intenção clara e não tem valor. Descartar obriga o
usuário a repetir a frase; travar a conversa na pergunta o impede de mudar de
assunto. O rascunho é o meio-termo: fica inerte, e volta quando ele responder.

A decisão de SE a mensagem responde ao rascunho é semântica (modelo). O QUE é o
número, quando responde, é parse determinístico — a mesma divisão de trabalho da
confirmação.
"""

import pytest

from app.domain import draft
from app.graph.schemas import DraftDecision


class TestClassificacao:
    @pytest.mark.asyncio
    async def test_valor_solto_completa_o_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("foi 5000", {"missing": "qual o valor?"})
        assert r == {"acao": "completar", "slot": "amount", "amount_cents": 500000}

    @pytest.mark.asyncio
    async def test_desistir_apaga_o_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="discard", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("esquece o mac", {"missing": "qual o valor?"})
        assert r == {"acao": "descartar"}

    @pytest.mark.asyncio
    async def test_assunto_novo_nao_toca_no_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="unrelated", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        assert await draft.interpretar("anota: comprar café", {"missing": "x"}) is None

    @pytest.mark.asyncio
    async def test_respondeu_mas_sem_numero_nao_completa(self, monkeypatch):
        """O modelo achou que é resposta, mas não há valor extraível.

        Sem esta guarda, "foi caro" viraria um lançamento com valor None — que é
        exatamente o bug do "registrar None em 12x" voltando por outra porta.
        """
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        assert await draft.interpretar("foi caro", {"missing": "x"}) is None

    @pytest.mark.asyncio
    async def test_modelo_fora_do_ar_nao_mexe_no_rascunho(self, monkeypatch):
        async def explode(texto, pergunta):
            raise RuntimeError("429")

        monkeypatch.setattr(draft, "_classificar", explode)
        # falha fechada: sem classificação, o rascunho fica onde está
        assert await draft.interpretar("5000", {"missing": "x"}) is None

    @pytest.mark.asyncio
    async def test_ja_paguei_parcelas_extrai_already_paid_count_e_calcula_current_installment(
        self, monkeypatch
    ):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", already_paid_count=2)

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("foi 5000 e já paguei 2 parcelas", {"missing": "qual o valor?"})
        assert r == {
            "acao": "completar",
            "slot": "amount",
            "amount_cents": 500000,
            "current_installment": 3,
        }


class TestMescla:
    def test_valor_entra_na_acao_guardada(self):
        guardado = {"type": "create_installment_purchase", "installments": 12,
                    "description": "mac", "amount_cents": None}
        assert draft.mesclar(guardado, {"slot": "amount", "amount_cents": 500000})["amount_cents"] == 500000

    def test_current_installment_entra_na_acao_guardada(self):
        guardado = {"type": "create_installment_purchase", "installments": 12,
                    "description": "mac", "amount_cents": None}
        mesclado = draft.mesclar(
            guardado, {"slot": "amount", "amount_cents": 500000, "current_installment": 3}
        )
        assert mesclado["amount_cents"] == 500000
        assert mesclado["current_installment"] == 3

    def test_nao_sobrescreve_o_que_ja_existia(self):
        guardado = {"type": "create_expense", "amount_cents": 100, "description": "x"}
        assert draft.mesclar(guardado, {"slot": "amount", "amount_cents": 999})["amount_cents"] == 100


class TestLembrete:
    def test_frase_cita_o_rascunho_sem_gastar_modelo(self):
        frase = draft.lembrete({"raw_text": "comprei um mac em 12x"})
        assert "mac em 12x" in frase
        assert "rascunho" in frase.lower()


class TestTrocaDeContexto:
    """A nota é salva e o rascunho continua lá, mencionado de leve.

    É o contrato que o usuário pediu: liberdade de mudar de assunto no meio de
    um lançamento incompleto, sem que o sistema perca o contexto anterior nem
    trave a conversa esperando o dado que falta.
    """

    def test_lembrete_entra_depois_da_confirmacao_da_nota(self):
        resposta = "📝 Nota salva!"
        rascunho = {"raw_text": "comprei um mac em 12x"}
        final = f"{resposta}\n\n{draft.lembrete(rascunho)}".strip()

        assert final.startswith("📝 Nota salva!")
        assert "mac em 12x" in final

    def test_texto_longo_e_truncado_sem_virar_ambiguo(self):
        # o que precisa ser limitado é o TRECHO do usuário (a moldura é fixa):
        # sem corte, uma mensagem longa empurraria a frase inteira para fora da
        # tela e o lembrete deixaria de ser discreto
        longo = {"raw_text": "comprei um macbook pro de 16 polegadas " * 3}
        frase = draft.lembrete(longo)
        trecho = frase.split("*")[1]

        assert len(trecho) <= 60
        assert trecho.endswith("…")
        assert frase.endswith(")")


class TestSlotDeCartao:
    """"nubank" é resposta perfeitamente sensata — só não era número.

    O bug real: o rascunho só sabia esperar VALOR, então "nubank" não tinha onde
    encaixar, escapava para o roteador global e voltava como "não entendi".
    """

    @pytest.mark.asyncio
    async def test_nome_de_cartao_preenche_o_slot(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("nubank", {"slot": "account", "missing": "qual cartão?"})
        assert r == {"acao": "completar", "slot": "account", "account": "nubank"}

    @pytest.mark.asyncio
    async def test_slot_de_valor_continua_exigindo_numero(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        assert await draft.interpretar("nubank", {"slot": "amount", "missing": "?"}) is None

    def test_mesclar_preenche_a_conta(self):
        guardado = {"type": "create_installment_purchase", "amount_cents": 500000,
                    "installments": 12, "account": None}
        junto = draft.mesclar(guardado, {"slot": "account", "account": "nubank"})
        assert junto["account"] == "nubank"


class TestExtracaoDoNome:
    """A queixa do teste de usabilidade: a frase inteira virava o nome do cartão.

    "acabei de criar um pelo app, chama nubank cartao" ia para o banco como nome,
    não casava com nada, e o usuário ficava preso na mesma pergunta.
    """

    @pytest.mark.asyncio
    async def test_usa_a_entidade_extraida_e_nao_a_frase(self, monkeypatch):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="nubank")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar(
            "acabei de criar um pelo app, chama nubank cartao",
            {"slot": "account", "missing": "qual cartão?"},
        )
        assert r == {"acao": "completar", "slot": "account", "account": "nubank"}

    @pytest.mark.asyncio
    async def test_sem_extracao_cai_no_texto_cru(self, monkeypatch):
        """Rede, não regressão: modelo que não extraiu nada não pode zerar uma
        resposta que já é o nome do cartão."""

        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("nubank", {"slot": "account", "missing": "?"})
        assert r["account"] == "nubank"

    @pytest.mark.asyncio
    async def test_o_valor_NAO_sai_do_modelo(self, monkeypatch):
        """O número continua determinístico. Deixar o modelo escolher reabriria a
        porta que `parse_valor_em_centavos` fechou — ele só aceita UM número."""

        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="9999")

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("foi 5000", {"slot": "amount", "missing": "?"})
        assert r == {"acao": "completar", "slot": "amount", "amount_cents": 500000}

    @pytest.mark.asyncio
    async def test_conta_a_chamada_de_modelo(self, monkeypatch):
        """Sem esta contagem o fast-path chama o Gemini sem aparecer em
        `ai_events` — e é essa contagem que o paywall mensal usa."""

        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", extracted_value="nubank")

        monkeypatch.setattr(draft, "_classificar", falso)
        uso = {}
        await draft.interpretar("nubank", {"slot": "account", "missing": "?"}, uso)
        assert uso == {"llm_calls": 1}


class TestCliqueNaLista:
    """O clique é igualdade exata, como o do HITL: o payload é escrito por nós."""

    def test_escolha_devolve_o_id_do_cartao(self):
        assert draft.parse_slot_click("ds:abc:c:cartao-1", "abc") == {
            "acao": "completar", "slot": "account", "account_id": "cartao-1"
        }

    def test_cancelar_descarta(self):
        assert draft.parse_slot_click("ds:abc:no", "abc") == {"acao": "descartar"}

    def test_clique_de_OUTRO_rascunho_nao_vale(self):
        """Botão do WhatsApp continua clicável para sempre: um toque na lista de
        ontem escolheria o cartão de uma compra que não é mais essa."""
        assert draft.parse_slot_click("ds:antigo:c:cartao-1", "abc") is None

    def test_prefixo_do_hitl_nao_e_confundido(self):
        assert draft.parse_slot_click("pa:abc:ok", "abc") is None

    def test_sufixo_desconhecido_nao_vira_acao(self):
        assert draft.parse_slot_click("ds:abc:seila", "abc") is None
        assert draft.parse_slot_click("ds:abc:c:", "abc") is None


class TestSemCartoes:
    def test_nao_promete_o_que_nao_tem_handler(self):
        """A mensagem antiga oferecia *criar* e *sem cartão*, e nenhuma das duas
        tinha implementação: quem respondia isso era classificado `answer`,
        virava nome de cartão, falhava a validação e recebia a mesma mensagem em
        loop."""
        msg = draft.sem_cartoes("nubank")
        assert "nubank" in msg
        assert "cancelar" in msg.lower()
        assert "sem cartão" not in msg.lower()


class TestSemanticaDoValor:
    """"700 cada" numa compra de 12x é R$ 8.400, não R$ 700.

    O bug do teste ponta a ponta de 31/08/2026: o "cada" era ignorado, o agente
    gravava R$ 700 como TOTAL e a compra virava 12 parcelas de R$ 58,33 —
    errado por um fator de 12, e em silêncio.

    A divisão de trabalho não mudou: o modelo diz o que o número SIGNIFICA, o
    `parse_valor_em_centavos` diz QUANTO ele é.
    """

    RASCUNHO_12X = {
        "slot": "amount",
        "missing": "faltou o valor",
        "action": {"type": "create_installment_purchase", "installments": 12},
    }

    def _modelo(self, monkeypatch, tipo):
        async def falso(texto, pergunta):
            return DraftDecision(decision="answer", amount_type=tipo)

        monkeypatch.setattr(draft, "_classificar", falso)

    @pytest.mark.asyncio
    async def test_cada_parcela_vira_o_total(self, monkeypatch):
        self._modelo(monkeypatch, "per_installment")
        r = await draft.interpretar("700 cada", self.RASCUNHO_12X)
        assert r["amount_cents"] == 70000 and r["por_parcela"] is True
        # a multiplicação é do `com_total`, que é o ponto único dos dois caminhos
        assert draft.com_total(r, self.RASCUNHO_12X["action"])["amount_cents"] == 840000

    @pytest.mark.asyncio
    async def test_total_explicito_nao_multiplica(self, monkeypatch):
        self._modelo(monkeypatch, "total")
        r = await draft.interpretar("8400 no total", self.RASCUNHO_12X)
        assert draft.com_total(r, self.RASCUNHO_12X["action"])["amount_cents"] == 840000

    @pytest.mark.asyncio
    async def test_numero_solto_PERGUNTA_em_vez_de_chutar(self, monkeypatch):
        """R$ 700 ou R$ 8.400 são contas muito diferentes. Perguntar custa uma
        mensagem; errar custa o mês do usuário."""
        self._modelo(monkeypatch, "ambiguous")
        r = await draft.interpretar("700", self.RASCUNHO_12X)
        assert r == {"acao": "perguntar_tipo", "amount_cents": 70000, "installments": 12}

    @pytest.mark.asyncio
    async def test_sem_parcelamento_nao_ha_ambiguidade(self, monkeypatch):
        """"gastei 700" à vista não tem segunda leitura — perguntar seria ruído."""
        self._modelo(monkeypatch, "ambiguous")
        r = await draft.interpretar(
            "700", {"slot": "amount", "missing": "?", "action": {"type": "create_expense"}}
        )
        assert r == {"acao": "completar", "slot": "amount", "amount_cents": 70000}

    @pytest.mark.asyncio
    async def test_cada_sem_parcelamento_nao_multiplica(self, monkeypatch):
        """"cada" numa compra à vista não quer dizer nada. Multiplicar por 0 ou
        por 1 seria pior que ignorar."""
        self._modelo(monkeypatch, "per_installment")
        acao = {"type": "create_expense"}
        r = await draft.interpretar("700 cada", {"slot": "amount", "missing": "?", "action": acao})
        assert draft.com_total(r, acao)["amount_cents"] == 70000

    @pytest.mark.asyncio
    async def test_o_numero_continua_saindo_do_parse(self, monkeypatch):
        """Mesmo com o modelo qualificando, ele nunca fornece o dígito."""
        self._modelo(monkeypatch, "total")
        assert await draft.interpretar("foi caro", self.RASCUNHO_12X) is None


class TestCliqueDoTipoDeValor:
    """O valor viaja no payload; nada novo é gravado no banco."""

    ACAO = {"installments": 12}

    def test_total_nao_multiplica(self):
        d = draft.parse_slot_click("ds:d1:t:70000", "d1")
        assert draft.com_total(d, self.ACAO)["amount_cents"] == 70000

    def test_cada_parcela_multiplica(self):
        d = draft.parse_slot_click("ds:d1:p:70000", "d1")
        assert draft.com_total(d, self.ACAO)["amount_cents"] == 840000

    def test_payload_adulterado_nao_vira_dinheiro(self):
        """Quem devolve o payload é o cliente do usuário. Número fora da faixa é
        adulteração ou bug nosso, e nos dois casos não pode virar lançamento."""
        assert draft.parse_slot_click("ds:d1:p:abc", "d1") is None
        assert draft.parse_slot_click("ds:d1:t:0", "d1") is None
        assert draft.parse_slot_click("ds:d1:t:-5", "d1") is None
        assert draft.parse_slot_click("ds:d1:t:999999999999", "d1") is None
