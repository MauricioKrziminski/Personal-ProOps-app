"""Escolha entre candidatos e leitura do clique.

O SIM/NÃO por regex saiu em 31/08/2026 — o contrato que ele protegia ("ambíguo
NÃO aprova") vive agora em `test_confirm_semantic.py`, sobre o classificador.
"""

import pytest

# ---------------------------------------------------------------------------
# clique de botão / lista (o caminho de texto acima continua intacto)
# ---------------------------------------------------------------------------

from app.domain import confirm  # noqa: E402
from app.domain.confirm import STALE, decide, interpret_choice, parse_click  # noqa: E402

PEND = "11111111-2222-3333-4444-555555555555"
OUTRO = "99999999-8888-7777-6666-555555555555"


class TestParseClick:
    def test_confirmar_e_cancelar(self):
        assert parse_click(f"pa:{PEND}:ok", PEND) == {"approved": True}
        assert parse_click(f"pa:{PEND}:no", PEND)["approved"] is False

    def test_escolha_de_candidato(self):
        d = parse_click(f"pa:{PEND}:c:tx-9", PEND)
        assert d == {"approved": True, "candidate_id": "tx-9"}

    def test_nenhuma_dessas(self):
        d = parse_click(f"pa:{PEND}:none", PEND)
        assert d["approved"] is False and d["none_of_these"] is True

    def test_clique_de_OUTRA_pergunta_nao_vale(self):
        # botão do WhatsApp fica clicável para sempre; sem esta checagem, um
        # "Confirmar" de dias atrás aprovaria a pergunta aberta AGORA
        assert parse_click(f"pa:{OUTRO}:ok", PEND) is None


class TestInterpretChoice:
    def test_numero_dentro_da_faixa(self):
        assert interpret_choice("2", 3) == 2

    def test_valor_digitado_NAO_e_escolha(self):
        # "45" com 3 candidatos é intenção nova (um gasto), não a opção 45
        assert interpret_choice("45", 3) is None

    def test_ordinais_e_nenhuma(self):
        assert interpret_choice("a segunda", 3) == 2
        assert interpret_choice("nenhuma", 3) == 0
        assert interpret_choice("a de baixo", 3) == 3

    def test_frase_comum_nao_e_escolha(self):
        assert interpret_choice("gastei 45 no mercado", 3) is None


@pytest.mark.asyncio
class TestDecide:
    async def test_clique_sem_pendencia_e_STALE_nao_vira_mensagem_nova(self):
        # o pior caso: o rótulo "1) R$45 mercado" viraria um lançamento de verdade
        assert await decide({"clicked_id": f"pa:{PEND}:ok"}, None) is STALE

    async def test_clique_cruzado_e_STALE(self):
        assert await decide({"clicked_id": f"pa:{OUTRO}:ok"}, {"id": PEND}) is STALE

    async def test_texto_digitado_vai_para_o_classificador(self, monkeypatch):
        async def falso(texto, resumo):
            return "approve"

        monkeypatch.setattr(confirm, "_classificar", falso)
        assert await decide({"text": "manda bala"}, {"id": PEND, "action": {}}) == {"approved": True}

    async def test_escolha_por_numero_quando_ha_candidatos(self):
        pend = {"id": PEND, "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}
        assert await decide({"text": "2"}, pend) == {"approved": True, "candidate_id": "b"}

    async def test_intencao_nova_devolve_none(self, monkeypatch):
        async def falso(texto, resumo):
            return "unclear"

        monkeypatch.setattr(confirm, "_classificar", falso)
        assert await decide({"text": "gastei 45 no mercado"}, {"id": PEND, "action": {}}) is None

    async def test_sem_pendencia_nao_gasta_chamada(self, monkeypatch):
        """Mensagem comum não pode custar um token só para descobrir que não é
        confirmação — seria uma chamada extra em CADA mensagem do produto."""
        async def explode(texto, resumo):
            raise AssertionError("não devia classificar sem pendência aberta")

        monkeypatch.setattr(confirm, "_classificar", explode)
        assert await decide({"text": "gastei 45 no mercado"}, None) is None
