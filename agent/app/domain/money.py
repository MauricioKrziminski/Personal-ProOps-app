"""Dinheiro: sempre centavos inteiros, nunca float.

Porte de _shared/money-text.ts. A rede de segurança existe porque o modelo
devolve a ação certa SEM o valor de vez em quando ("coloca 200 na meta da
viagem" volta como goal_deposit sem amount_cents, e com confiança 1.0). Um
parser determinístico não depende de cota nem de humor do modelo.
"""

from __future__ import annotations

import re

# Números que claramente não são dinheiro numa mensagem de WhatsApp.
_RUIDO = [
    re.compile(r"\b\d{1,2}\s*x\b", re.IGNORECASE),                         # "12x", "3 x" — parcelas
    re.compile(r"\b\d{1,2}(?:ª|º|\.ª|\.º)?\s*parcelas?\b", re.IGNORECASE), # "2 parcelas", "3ª parcela"
    re.compile(r"\b(?:paguei|foram|faltam|são)\s+\d{1,2}\b", re.IGNORECASE), # "paguei 2", "foram 3"
    re.compile(r"\b\d{1,2}\s+(?:pagas|restantes)\b", re.IGNORECASE),       # "2 pagas"
    re.compile(r"\bdia\s+\d{1,2}\b", re.IGNORECASE),                       # "dia 5" — recorrência
    re.compile(r"\b\d{1,2}[/:]\d{1,2}(?:[/:]\d{2,4})?\b"),                 # 05/09, 14:30
    re.compile(r"\b\d{1,2}h(?:\d{2})?\b", re.IGNORECASE),                  # 8h, 8h30
    re.compile(r"\b\d{1,2}%"),                                             # 20%
]

_MULTIPLICADORES = [
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:milh(?:ão|oes|ões)|mi)\b", re.IGNORECASE), 1_000_000),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*mil\b", re.IGNORECASE), 1_000),
]

_NUMEROS = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?")

MAX_CENTS = 100_000_000_00  # R$ 100 milhões: acima disso é erro de digitação ou alucinação


def parse_valor_em_centavos(texto: str | None) -> int | None:
    """"1.234,56" | "45" | "2 mil" -> centavos. None se não houver UM candidato claro.

    Conservador de propósito: "parcelei 3600 em 12x" tem dois números, então
    devolve None e o fluxo pede para reformular. Chutar qual dos dois é o
    dinheiro é pior do que perguntar.
    """
    if not texto:
        return None

    limpo = f" {texto} "
    for padrao in _RUIDO:
        limpo = padrao.sub(" ", limpo)

    for padrao, fator in _MULTIPLICADORES:
        achados = padrao.findall(limpo)
        if len(achados) == 1:
            base = achados[0].replace(".", "").replace(",", ".")
            try:
                return round(float(base) * fator * 100)
            except ValueError:
                return None
        if len(achados) > 1:
            return None  # ambíguo

    candidatos = _NUMEROS.findall(limpo)
    if len(candidatos) != 1:
        return None

    bruto = candidatos[0]
    # quem vem por último manda: 1.234,56 (BR) vs 1,234.56 (US)
    if bruto.rfind(",") > bruto.rfind("."):
        normalizado = bruto.replace(".", "").replace(",", ".")
    else:
        normalizado = bruto.replace(",", "")

    try:
        valor = float(normalizado)
    except ValueError:
        return None
    if valor <= 0:
        return None
    return round(valor * 100)


def cents_to_brl(cents: int | float | None) -> str:
    """Formatação pt-BR sem depender de locale do sistema (container é C.UTF-8)."""
    valor = (int(cents or 0)) / 100
    inteiro, _, decimal = f"{abs(valor):.2f}".partition(".")
    grupos = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    sinal = "-" if valor < 0 else ""
    return f"{sinal}R$ {'.'.join(grupos)},{decimal}"


def format_number_br(valor: float, casas: int = 1) -> str:
    """Decimal com vírgula. Existe porque "90.4%" ao lado de "90,4%" na mesma
    tela foi um defeito real registrado nas regras do projeto."""
    return f"{valor:.{casas}f}".replace(".", ",")
