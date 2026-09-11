"""Confirmação: clique por igualdade exata, texto por semântica.

Decisão do usuário em 31/08/2026: regex de texto livre é frágil demais para
decidir aprovação. O clique no botão vira comparação exata do payload
estruturado; a resposta digitada vai para o modelo.

A trava que não pode cair: **falha do modelo, cota estourada ou resposta
ambígua NUNCA aprovam.** Um port�o de segurança que abre quando o classificador
falha não é port�o.
"""

import pytest

from app.domain import confirm

PEND = "11111111-2222-3333-4444-555555555555"
OUTRO = "99999999-8888-7777-6666-555555555555"


class TestCliqueIgualdadeExata:
    def test_sufixos_conhecidos(self):
        assert confirm.parse_click(f"pa:{PEND}:ok", PEND) == {"approved": True}
        assert confirm.parse_click(f"pa:{PEND}:no", PEND)["approved"] is False
        assert confirm.parse_click(f"pa:{PEND}:none", PEND)["none_of_these"] is True
        assert confirm.parse_click(f"pa:{PEND}:c:tx-9", PEND)["candidate_id"] == "tx-9"

    def test_pendente_errado_nao_vale(self):
        assert confirm.parse_click(f"pa:{OUTRO}:ok", PEND) is None

    def test_sufixo_desconhecido_nao_vale(self):
        assert confirm.parse_click(f"pa:{PEND}:apagar_tudo", PEND) is None

    def test_lixo_nao_quebra(self):
        for lixo in ("", "pa:", "ok", f"pa:{PEND}", "x:y:z"):
            assert confirm.parse_click(lixo, PEND) is None, lixo


class TestSemantico:
    @pytest.mark.asyncio
    async def test_aprova_e_recusa(self, monkeypatch):
        async def falso(texto, resumo):
            return "approve" if "bala" in texto else "reject"

        monkeypatch.setattr(confirm, "_classificar", falso)
        assert (await confirm.interpret_text("manda bala", "apagar X")) is True
        assert (await confirm.interpret_text("cancela isso", "apagar X")) is False

    @pytest.mark.asyncio
    async def test_ambiguo_NAO_aprova(self, monkeypatch):
        async def falso(texto, resumo):
            return "unclear"

        monkeypatch.setattr(confirm, "_classificar", falso)
        assert (await confirm.interpret_text("acho que sim", "apagar X")) is None

    @pytest.mark.asyncio
    async def test_modelo_fora_do_ar_NAO_aprova(self, monkeypatch):
        async def explode(texto, resumo):
            raise RuntimeError("429 quota")

        monkeypatch.setattr(confirm, "_classificar", explode)
        # falha fechada: sem classificação, não há aprovação
        assert (await confirm.interpret_text("sim", "apagar X")) is None

    @pytest.mark.asyncio
    async def test_resposta_fora_do_enum_NAO_aprova(self, monkeypatch):
        async def esquisito(texto, resumo):
            return "APROVAR TUDO"

        monkeypatch.setattr(confirm, "_classificar", esquisito)
        assert (await confirm.interpret_text("sim", "apagar X")) is None


# ---------------------------------------------------------------------------
# integração das duas pontas: o dublê não pode esconder a chamada real
# ---------------------------------------------------------------------------
# Três bugs de produção nesta sessão passaram pela suíte porque os testes
# dublavam `_classificar` — justamente a função que quebrava (`Literal` não
# importado, `wrap_untrusted` com assinatura errada). Estes testes exercitam o
# corpo real de `_classificar`, dublando só o CLIENTE do modelo.


class _RespostaFalsa:
    def __init__(self, decision, extracted_value=""):
        self.decision = decision
        self.extracted_value = extracted_value


class _ModeloFalso:
    def __init__(self, decision="unclear", extracted_value=""):
        self.decision = decision
        self.extracted_value = extracted_value
        self.mensagens = None

    async def ainvoke(self, mensagens):
        self.mensagens = mensagens
        return _RespostaFalsa(self.decision, self.extracted_value)


@pytest.mark.asyncio
async def test_classificar_de_confirmacao_monta_a_chamada_de_verdade(monkeypatch):
    from app.services import gemini

    falso = _ModeloFalso("approve")
    modelos: list[str | None] = []
    monkeypatch.setattr(gemini, "structured", lambda schema, model=None: (modelos.append(model), falso)[1])

    # ⚠️ Sentinelas, não frases naturais: "manda bala" é um EXEMPLO literal dentro do system
    # prompt estático, então procurá-la lá daria falso positivo para sempre.
    assert await confirm._classificar("ZZTEXTO", "ZZRESUMO") == "approve"

    # O portão roda no modelo BOM, não no barato do parse. Medido em 09/09/2026:
    # no Lite, "apaga todos" voltava approved=True. Cair para o padrão aqui é
    # regressão de SEGURANÇA e não aparece em nenhum outro teste.
    assert modelos == [gemini.GEMINI_GATE]

    papeis = [m[0] for m in falso.mensagens]
    assert papeis == ["system", "human", "human"]

    # ⚠️ **A invariante é esta: NADA escrito pelo usuário no system prompt.**
    #
    # O resumo da ação pendente ("apagar X") embute o `label` do alvo — primeira linha da nota,
    # descrição do lançamento, nome da meta —, e ele ia interpolado no `("system", ...)`, que é
    # o único lugar do turno com autoridade. Num workspace compartilhado, o atacante nomeia o
    # registro e a vítima roda a ação. Aqui isso pesa o dobro: este é o PORTÃO que autoriza
    # escrita destrutiva.
    system = falso.mensagens[0][1]
    assert "ZZRESUMO" not in system
    assert "ZZTEXTO" not in system

    # os dois vão envelopados, como dado
    assert "<acao_pendente>" in falso.mensagens[1][1]
    assert "ZZRESUMO" in falso.mensagens[1][1]
    assert "<user_input>" in falso.mensagens[2][1]
    assert "ZZTEXTO" in falso.mensagens[2][1]


@pytest.mark.asyncio
async def test_classificar_de_rascunho_monta_a_chamada_de_verdade(monkeypatch):
    from app.domain import draft
    from app.services import gemini

    falso = _ModeloFalso("answer")
    modelos: list[str | None] = []
    monkeypatch.setattr(gemini, "structured", lambda schema, model=None: (modelos.append(model), falso)[1])

    assert (await draft._classificar("foi 5000", "qual o valor?")).decision == "answer"
    assert "<user_input>" in falso.mensagens[1][1]
    assert modelos == [gemini.GEMINI_GATE]


@pytest.mark.asyncio
async def test_classificar_de_rascunho_extrai_na_MESMA_chamada(monkeypatch):
    """Classificar e extrair juntos não é economia de linha, é de cota: separar
    dobraria a latência e comeria duas das 500 requisições diárias do Flash-Lite
    para chegar no mesmo lugar."""
    from app.domain import draft
    from app.services import gemini

    falso = _ModeloFalso("answer", extracted_value="nubank")
    modelos: list[str | None] = []
    monkeypatch.setattr(gemini, "structured", lambda schema, model=None: (modelos.append(model), falso)[1])

    decisao = await draft._classificar(
        "acabei de criar um pelo app, chama nubank cartao", "qual cartão?"
    )
    assert (decisao.decision, decisao.extracted_value) == ("answer", "nubank")
    # uma chamada, não duas
    assert len(falso.mensagens) == 2


# --- escolher da lista por descrição, não só por número ---------------------


LISTA = [
    {"id": "t1", "label": "R$ 45,00 mercado", "when": "30/08"},
    {"id": "t2", "label": "R$ 120,00 farmácia", "when": "29/08"},
    {"id": "t3", "label": "R$ 89,90 posto", "when": "28/08"},
]
ESCOLHA = {
    "id": "p1", "thread_id": "t", "summary": "apagar o gasto",
    "action": {"kind": "choice", "action_type": "delete_transaction", "candidates": LISTA},
}


def _escolha(indice):
    from unittest.mock import AsyncMock
    from app.graph.schemas import CandidateChoice
    return AsyncMock(return_value=CandidateChoice(index=indice))


def _sempre(valor):
    async def _f(*a, **kw):
        return valor
    return _f


def _modelo(monkeypatch, indice):
    from app.services import gemini
    monkeypatch.setattr(
        gemini, "structured", lambda *a, **kw: type("M", (), {"ainvoke": _escolha(indice)})()
    )


@pytest.mark.asyncio
async def test_descrever_o_item_escolhe_como_o_numero_escolhe(monkeypatch):
    """"o do mercado" caía como None e virava intenção nova.

    Número, ordinal e rótulo exato já saíam de graça no regex; descrever o item
    — que é como as pessoas falam — não saía de jeito nenhum.
    """
    _modelo(monkeypatch, 1)
    assert (await confirm.decide({"text": "o do mercado"}, ESCOLHA, {})) == {
        "approved": True, "candidate_id": "t1",
    }


@pytest.mark.asyncio
async def test_numero_nao_gasta_chamada_de_modelo(monkeypatch):
    """O regex vem primeiro de propósito: clique e número continuam custando zero."""
    from app.services import gemini

    def nunca(*a, **kw):
        raise AssertionError("número não deveria chamar o modelo")

    monkeypatch.setattr(gemini, "structured", nunca)
    assert (await confirm.decide({"text": "2"}, ESCOLHA, {}))["candidate_id"] == "t2"


@pytest.mark.asyncio
async def test_indice_fora_da_lista_nao_escolhe_ninguem(monkeypatch):
    """O índice vem do modelo; fora da faixa é payload torto, nunca um alvo."""
    for fora in (4, 99, -7):
        _modelo(monkeypatch, fora)
        assert await confirm.decide({"text": "o de 500 reais"}, ESCOLHA, {}) is None


@pytest.mark.asyncio
async def test_empate_devolve_a_conversa_em_vez_de_chutar(monkeypatch):
    _modelo(monkeypatch, -1)
    assert await confirm.decide({"text": "um dos dois primeiros"}, ESCOLHA, {}) is None


@pytest.mark.asyncio
async def test_soft_warning_nunca_passa_pelo_classificador_de_escolha(monkeypatch):
    """Ali os "candidatos" são AÇÕES, não itens.

    Deixar um classificador de escolha pescar *Confirmar* de uma hesitação
    recria o defeito de "clicar Trocar de Cartão autoriza a compra": escolher
    uma opção nunca é consentir a compra. Quem interpreta lá é `_classificar_aviso`.
    """
    from unittest.mock import AsyncMock
    from app.services import gemini

    def nunca(*a, **kw):
        raise AssertionError("soft_warning não pode usar o classificador de escolha")

    monkeypatch.setattr(gemini, "structured", nunca)
    monkeypatch.setattr(
        confirm, "_classificar_aviso", AsyncMock(return_value={"decision": "unclear"})
    )
    aviso = {
        "id": "p2", "thread_id": "t", "summary": "compra acima do limite",
        "action": {"kind": "soft_warning", "action_type": "create_installment_purchase",
                   "candidates": [{"id": "confirm", "label": "Confirmar"},
                                  {"id": "change_card", "label": "Trocar de Cartão"}]},
    }
    resultado = await confirm.decide({"text": "acho que sim"}, aviso, {})
    assert resultado["keep_pending"] is True and not resultado["approved"]


@pytest.mark.asyncio
async def test_escolha_conta_a_chamada_para_a_cota(monkeypatch):
    _modelo(monkeypatch, 1)
    uso = {}
    await confirm.decide({"text": "o do mercado"}, ESCOLHA, uso)
    assert uso["llm_calls"] == 1


@pytest.mark.asyncio
async def test_sim_NAO_resolve_uma_pergunta_de_escolha(monkeypatch):
    """"Sim" não aponta linha nenhuma — e aprovar sem apontar matava a pergunta.

    Reproduz o que aconteceu em produção em 09/09/2026: com nove candidatos
    abertos, "é para apagar esse último que eu acabei de mandar" não casou no
    classificador de ESCOLHA (que devolveu None) e caiu no de SIM/NÃO, que
    respondeu SIM. O `approved: True` voltava sem `candidate_id`, o grafo não
    achava o candidato e respondia "não mexi em nada" — a pergunta e as nove
    opções morriam, e o usuário repetia a frase.
    """
    _modelo(monkeypatch, -1)  # a escolha não casa
    monkeypatch.setattr(confirm, "interpret_text", _sempre(True))

    decisao = await confirm.decide(
        {"text": "é para apagar esse último que eu acabei de mandar"}, ESCOLHA, {}
    )

    assert decisao.get("approved") is not True, "aprovou sem escolher candidato"
    assert decisao["keep_pending"] is True, "a pergunta tem que sobreviver"
    # e o usuário precisa VER as opções de novo: com 3+ candidatos a lista do
    # WhatsApp esconde as linhas atrás de um toque que ele não deu.
    for c in LISTA:
        assert c["label"] in decisao["clarification"]


@pytest.mark.asyncio
async def test_nao_continua_cancelando_a_escolha(monkeypatch):
    """A recusa não muda: "deixa pra lá" numa lista continua cancelando."""
    _modelo(monkeypatch, -1)
    monkeypatch.setattr(confirm, "interpret_text", _sempre(False))

    decisao = await confirm.decide({"text": "deixa pra lá"}, ESCOLHA, {})

    assert decisao == {"approved": False}
