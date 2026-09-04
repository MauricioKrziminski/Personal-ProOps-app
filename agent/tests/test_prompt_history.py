"""A janela de contexto é por CANAL, e o corte é por mensagem inteira.

O app conversa com o dedo e a tela: turnos curtos, encadeados, e o usuário
enxerga o histórico enquanto escreve — 10 pares. O WhatsApp é assíncrono e caro,
e o histórico dele mora no checkpoint — 5 pares.

O corte nunca fatia uma mensagem no meio: metade de "gastei 45 no mercado e 120
na farmácia" é um valor que o modelo lê como se fosse o total.

Função PURA de propósito. Regra de contexto que só dá para testar subindo o grafo
é regra que ninguém testa — o mesmo argumento de `policy.py`.
"""

from __future__ import annotations

import pytest

from app.conversation import CHANNEL_LIMITS, trim_prompt_history


def _pares(n: int, tamanho: int = 10) -> list[dict]:
    """2n mensagens alternando user/assistant, numeradas para dar para rastrear."""
    saida: list[dict] = []
    for i in range(n):
        saida.append({"role": "user", "content": f"u{i}".ljust(tamanho, "x")})
        saida.append({"role": "assistant", "content": f"a{i}".ljust(tamanho, "y")})
    return saida


def test_limites_por_canal_sao_os_do_desenho():
    assert CHANNEL_LIMITS["app"] == {"turns": 10, "chars": 12_000}
    assert CHANNEL_LIMITS["whatsapp"] == {"turns": 5, "chars": 8_000}


def test_app_guarda_dez_pares():
    cortado = trim_prompt_history(_pares(11), "app")
    assert len(cortado) == 20
    assert cortado[0]["content"].startswith("u1"), "o par mais ANTIGO é o que sai"
    assert cortado[-1]["content"].startswith("a10")


def test_whatsapp_guarda_cinco_pares():
    cortado = trim_prompt_history(_pares(6), "whatsapp")
    assert len(cortado) == 10
    assert cortado[0]["content"].startswith("u1")


def test_historico_curto_passa_inteiro():
    curto = _pares(2)
    assert trim_prompt_history(curto, "app") == curto


def test_orcamento_de_caracteres_remove_as_mais_antigas():
    grandes = _pares(4, tamanho=3_000)  # 8 mensagens × 3.000 = 24.000
    cortado = trim_prompt_history(grandes, "app")

    assert sum(len(m["content"]) for m in cortado) <= 12_000
    assert cortado[-1] is grandes[-1], "a mensagem mais recente nunca pode sair"
    assert len(cortado) < len(grandes)


def test_mensagem_nunca_e_fatiada():
    """Uma única mensagem maior que o orçamento inteiro."""
    enorme = [{"role": "user", "content": "z" * 20_000}]
    cortado = trim_prompt_history(enorme, "app")

    assert cortado == enorme, (
        "cortar no meio inventa conteúdo: metade de um valor lê como o valor todo"
    )


def test_nao_muta_a_lista_recebida():
    original = _pares(11)
    copia = [dict(m) for m in original]

    trim_prompt_history(original, "app")

    assert original == copia
    assert len(original) == 22


def test_canal_desconhecido_cai_na_janela_mais_estreita():
    """Errar para o lado barato: um canal novo sem limite escrito não pode
    herdar a janela maior por omissão."""
    cortado = trim_prompt_history(_pares(11), "telegrama")
    assert len(cortado) == 10


@pytest.mark.parametrize("canal", ["app", "whatsapp"])
def test_o_corte_nao_inventa_mensagem(canal):
    origem = _pares(11)
    cortado = trim_prompt_history(origem, canal)
    for m in cortado:
        assert m in origem
