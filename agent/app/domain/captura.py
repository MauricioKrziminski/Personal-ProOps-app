"""Captura de notificações: o que o CÓDIGO confere depois do modelo (puro, sem rede nem banco).

O modelo diz o que a notificação SIGNIFICA (gasto, entrada, nada); o código diz QUANTO (ia.md). O valor
só vale se o texto da notificação o cita em reais, ou se é N×V de um "Nx de R$ V". Na dúvida não escolhe:
o rascunho nasce sem valor e com a pergunta.
"""

from __future__ import annotations

import re
from datetime import date

from app.domain.money import MAX_CENTS, cents_to_brl, valores_em_reais

# O modelo nunca devolve `mark_paid` aqui: "pagamento realizado" é gasto (o boleto), e `mark_paid` guarda o
# valor em `new_amount_cents`, onde a conciliação não o vê.
TIPOS = {"create_expense", "create_income", "create_installment_purchase"}

_PARCELADA = re.compile(
    r"(?<!\d)(\d{1,3})\s*(?:x|vezes)\s*(?:de\s*)?(?:R\$|BRL)\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?!\d)",
    re.IGNORECASE,
)


def _parcelas_ditas(texto: str) -> list[tuple[int, int]]:
    """[(N, V em centavos)] de cada "Nx de R$ V" (N de 2 a 99)."""
    achados = []
    for m in _PARCELADA.finditer(texto):
        n = int(m[1])
        if 2 <= n <= 99:
            achados.append((n, int(m[2].replace(".", "")) * 100 + int((m[3] or "0").ljust(2, "0"))))
    return achados


# Quantia que a notificação ROTULA como limite ou saldo ("Limite disponível: R$ 1.980,00"): não é o
# gasto. Não escolhe nada sozinha, só tira o rótulo da disputa quando há outro valor (aí, pergunta).
_ROTULADA = re.compile(r"(?:limite|saldo)[^.\n]{0,25}?((?:R\$|BRL)\s*[\d.,]+)", re.IGNORECASE)


def ancorar_valor(texto: str, valor_modelo: int | None) -> tuple[int | None, str | None]:
    """(valor em centavos, pergunta). O valor do modelo só passa se o texto o sustenta."""
    reais, estrangeiras = valores_em_reais(texto)
    rotuladas = {v for m in _ROTULADA.finditer(texto) for v in valores_em_reais(m[1])[0]}
    if rotuladas and any(r not in rotuladas for r in reais):
        reais = [r for r in reais if r not in rotuladas]
    candidatos = list(reais)
    dadas = _parcelas_ditas(texto)
    if len(dadas) == 1:  # "3x de R$ 100,00": a compra é N×V, e o V sozinho é a parcela, não o gasto
        n, v = dadas[0]
        candidatos = [c for c in candidatos if c != v] + [n * v]
    modelo = valor_modelo if isinstance(valor_modelo, int) and 0 < valor_modelo <= MAX_CENTS else None
    if modelo in candidatos:
        return modelo, None
    if len(candidatos) == 1:
        return candidatos[0], None
    if not candidatos and estrangeiras:
        return None, f"Compra de {estrangeiras[0]}: quanto foi em reais?"
    if candidatos:
        return None, "Confira o valor: a notificação cita " + " e ".join(cents_to_brl(c) for c in candidatos) + "."
    return None, "Confira o valor: não achei a quantia em reais na notificação."


def fechar(finance_actions: list[dict], titulo: str, texto: str) -> tuple[dict | None, list[str]]:
    """A ação da captura já conferida e as perguntas que o rascunho deve fazer; (None, []) = não é lançamento."""
    brutas = [a for a in finance_actions if a.get("type") in TIPOS | {"mark_paid"}]
    if not brutas:
        return None, []
    a = dict(brutas[0])  # uma notificação é um acontecimento só
    if a["type"] == "mark_paid":
        a["type"] = "create_expense"
        a["amount_cents"] = a.get("amount_cents") or a.get("new_amount_cents")
    perguntas: list[str] = []
    valor, pergunta = ancorar_valor(f"{titulo}\n{texto}", a.get("amount_cents"))
    a["amount_cents"] = valor
    if pergunta:
        perguntas.append(pergunta)
    if a.get("occurred_at"):
        try:
            date.fromisoformat(str(a["occurred_at"]))
        except ValueError:  # data alucinada ("2026-09-31"): sem ela vale a da notificação, e a pessoa confere
            a["occurred_at"] = None
            perguntas.append("Confira a data: não consegui lê-la na notificação.")
    return a, perguntas
