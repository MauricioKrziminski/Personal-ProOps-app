"""O SIM/NÃO do HITL. Um falso positivo aqui apaga o lançamento de alguém."""

from app.domain.confirm import interpret


def test_aprova():
    for texto in ("sim", "Sim", "SIM", "s", "pode", "confirma", "ok", "beleza", "👍", "sim!"):
        assert interpret(texto) is True, texto


def test_recusa():
    for texto in ("não", "nao", "n", "cancela", "esquece", "melhor não", "❌"):
        assert interpret(texto) is False, texto


def test_ambiguo_nao_e_confirmacao():
    # qualquer coisa que não seja um sim/não claro vira INTENÇÃO NOVA.
    # "acho que sim" aprovando um delete é exatamente o que o HITL evita.
    for texto in ("acho que sim", "sim, mas muda pra 50", "gastei 45 no mercado", "", None, "?"):
        assert interpret(texto) is None, texto


# ---------------------------------------------------------------------------
# clique de botão / lista (o caminho de texto acima continua intacto)
# ---------------------------------------------------------------------------

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


class TestDecide:
    def test_clique_sem_pendencia_e_STALE_nao_vira_mensagem_nova(self):
        # o pior caso: o rótulo "1) R$45 mercado" viraria um lançamento de verdade
        assert decide({"clicked_id": f"pa:{PEND}:ok"}, None) is STALE

    def test_clique_cruzado_e_STALE(self):
        assert decide({"clicked_id": f"pa:{OUTRO}:ok"}, {"id": PEND}) is STALE

    def test_texto_continua_funcionando_sem_candidatos(self):
        assert decide({"text": "sim"}, {"id": PEND, "action": {}}) == {"approved": True}

    def test_escolha_por_numero_quando_ha_candidatos(self):
        pend = {"id": PEND, "action": {"candidates": [{"id": "a"}, {"id": "b"}]}}
        assert decide({"text": "2"}, pend) == {"approved": True, "candidate_id": "b"}

    def test_intencao_nova_devolve_none(self):
        assert decide({"text": "gastei 45 no mercado"}, {"id": PEND, "action": {}}) is None
