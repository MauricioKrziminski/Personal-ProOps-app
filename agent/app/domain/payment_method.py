"""Forma de pagamento (F01/F05): os valores do banco e como a pessoa os chama.

O banco guarda `pix | credit | debit | cash | bank_transfer | boleto`; null é "Não informado" e
NUNCA vira Pix nem crédito. O modelo recebe os valores no schema; este mapa só aceita também a
palavra em português (rede de segurança) e recusa o resto — um filtro que não entendeu a forma
não pode devolver a lista sem filtro, porque aí o total sai errado com cara de certo.
"""

from __future__ import annotations

from app.domain.matching import normalize

ROTULOS = {
    "pix": "Pix",
    "credit": "Crédito",
    "debit": "Débito",
    "cash": "Dinheiro",
    "bank_transfer": "Transferência",
    "boleto": "Boleto",
    "not_informed": "Não informado",
}

_DITAS = {
    "pix": "pix",
    "credit": "credit", "credito": "credit", "cartao de credito": "credit", "no credito": "credit",
    "debit": "debit", "debito": "debit", "cartao de debito": "debit", "no debito": "debit",
    "cash": "cash", "dinheiro": "cash", "especie": "cash", "em dinheiro": "cash",
    "bank transfer": "bank_transfer", "transferencia": "bank_transfer", "ted": "bank_transfer",
    "doc": "bank_transfer", "transferencia bancaria": "bank_transfer",
    "boleto": "boleto",
    "not informed": "not_informed", "nao informado": "not_informed", "nao informada": "not_informed",
    "sem forma": "not_informed", "sem forma de pagamento": "not_informed",
}

ACEITAS = "Pix, crédito, débito, dinheiro, transferência, boleto ou não informado"


def forma_de_pagamento(texto: str | None) -> str | None:
    """O código do banco (ou `not_informed`); vazio é "sem filtro"; desconhecido levanta ValueError."""
    if texto is None or not str(texto).strip():
        return None
    achado = _DITAS.get(normalize(str(texto)))
    if achado is None:
        raise ValueError(texto)
    return achado
