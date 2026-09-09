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

    assert await confirm._classificar("manda bala", "apagar X") == "approve"

    # O portão roda no modelo BOM, não no barato do parse. Medido em 09/09/2026:
    # no Lite, "apaga todos" voltava approved=True. Cair para o padrão aqui é
    # regressão de SEGURANÇA e não aparece em nenhum outro teste.
    assert modelos == [gemini.GEMINI_GATE]

    papeis = [m[0] for m in falso.mensagens]
    assert papeis == ["system", "human"]
    # o texto do usuário vai ENVELOPADO como dado, nunca solto no system
    assert "<user_input>" in falso.mensagens[1][1]
    assert "manda bala" in falso.mensagens[1][1]


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
