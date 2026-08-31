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
