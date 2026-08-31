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
    monkeypatch.setattr(gemini, "structured", lambda schema: falso)

    assert await confirm._classificar("manda bala", "apagar X") == "approve"

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
    monkeypatch.setattr(gemini, "structured", lambda schema: falso)

    assert (await draft._classificar("foi 5000", "qual o valor?")).decision == "answer"
    assert "<user_input>" in falso.mensagens[1][1]


@pytest.mark.asyncio
async def test_classificar_de_rascunho_extrai_na_MESMA_chamada(monkeypatch):
    """Classificar e extrair juntos não é economia de linha, é de cota: separar
    dobraria a latência e comeria duas das 500 requisições diárias do Flash-Lite
    para chegar no mesmo lugar."""
    from app.domain import draft
    from app.services import gemini

    falso = _ModeloFalso("answer", extracted_value="nubank")
    monkeypatch.setattr(gemini, "structured", lambda schema: falso)

    decisao = await draft._classificar(
        "acabei de criar um pelo app, chama nubank cartao", "qual cartão?"
    )
    assert (decisao.decision, decisao.extracted_value) == ("answer", "nubank")
    # uma chamada, não duas
    assert len(falso.mensagens) == 2
