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
