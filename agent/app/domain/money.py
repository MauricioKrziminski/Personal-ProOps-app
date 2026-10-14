"""Dinheiro: sempre centavos inteiros, nunca float.

Porte de _shared/money-text.ts. A rede de segurança existe porque o modelo
devolve a ação certa SEM o valor de vez em quando ("coloca 200 na meta da
viagem" volta como goal_deposit sem amount_cents, e com confiança 1.0). Um
parser determinístico não depende de cota nem de humor do modelo.
"""

from __future__ import annotations

import re
import unicodedata

# Números que claramente não são dinheiro numa mensagem de WhatsApp.
_RUIDO = [
    re.compile(r"\b\d{1,2}\s*x\b", re.IGNORECASE),                         # "12x", "3 x" — parcelas
    re.compile(r"\b\d{1,2}(?:ª|º|\.ª|\.º)?\s*parcelas?\b", re.IGNORECASE), # "2 parcelas", "3ª parcela"
    re.compile(r"\b(?:paguei|foram|faltam|são)\s+\d{1,2}\b", re.IGNORECASE), # "paguei 2", "foram 3"
    re.compile(r"\b\d{1,2}\s+(?:pagas|restantes)\b", re.IGNORECASE),       # "2 pagas"
    re.compile(r"\bdia\s+\d{1,2}\b", re.IGNORECASE),                       # "dia 5" — recorrência
    re.compile(r"\b\d{1,2}[/:]\d{1,2}(?:[/:]\d{2,4})?\b"),                 # 05/09, 14:30
    re.compile(r"\b\d{1,2}h(?:\d{2})?\b", re.IGNORECASE),                  # 8h, 8h30
    re.compile(r"\b\d{1,3}%"),                                             # 20%
    re.compile(r"\b\d{1,3}\s*(?:dias?|semanas?|meses|mês|anos?)\b", re.IGNORECASE),  # "30 dias", "10 meses"
]

_MULTIPLICADORES = [
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:milh(?:ão|oes|ões)|mi)\b", re.IGNORECASE), 1_000_000),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*mil\b", re.IGNORECASE), 1_000),
]

_NUMEROS = re.compile(r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?")

MAX_CENTS = 100_000_000_00  # R$ 100 milhões: acima disso é erro de digitação ou alucinação


_UNIDADES = {
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7,
    "oito": 8, "nove": 9, "dez": 10, "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quatorze": 14,
    "quinze": 15, "dezesseis": 16, "dezessete": 17, "dezoito": 18, "dezenove": 19,
    "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60, "setenta": 70,
    "oitenta": 80, "noventa": 90, "cem": 100, "cento": 100,
    "duzentos": 200, "duzentas": 200, "trezentos": 300, "trezentas": 300, "quatrocentos": 400,
    "quatrocentas": 400, "quinhentos": 500, "quinhentas": 500, "seiscentos": 600, "seiscentas": 600,
    "setecentos": 700, "setecentas": 700, "oitocentos": 800, "oitocentas": 800, "novecentos": 900,
    "novecentas": 900,
}
_GRANDEZAS = {"mil": 1_000, "milhao": 1_000_000, "milhoes": 1_000_000}
_MOEDA = {"real", "reais", "centavo", "centavos"}
_TOKENS = re.compile(r"\d[\d.,]*|[^\W\d_]+|\s+|.", re.UNICODE)

# "uns trezentos", "duzentos e tantos", "mais ou menos 100": quantia que a pessoa NÃO cravou.
_VAGO = re.compile(
    r"\b(?:uns|umas|alguns|algumas|quase|aproximadamente|cerca\s+de|perto\s+de|em\s+torno\s+de|"
    r"por\s+volta\s+de|mais\s+ou\s+menos|pouco\s+mais\s+de)\s+(?:de\s+)?(?:r\$\s*)?\d"
    r"|\d[\d.,]*(?:\s*(?:reais|real|mil))?\s+e\s+(?:tantos|tantas|tanto|pouco|poucos|poucas)\b",
    re.IGNORECASE,
)


def _sem_acento(palavra: str) -> str:
    return unicodedata.normalize("NFD", palavra.lower()).encode("ascii", "ignore").decode()


def _numeros_por_extenso(texto: str) -> str:
    """"trezentos e cinquenta reais" -> "350 reais". Só o que é inequívoco: 1..19 sozinho ("um", "duas")
    é artigo ou contagem, então só vale diante de "real/reais/centavos"; vinte ou mais, cem, mil... valem."""
    toks = _TOKENS.findall(texto)
    saida: list[str] = []
    i = 0

    def proximo_palavra(j: int) -> int | None:
        j += 1
        while j < len(toks) and toks[j].isspace():
            j += 1
        return j if j < len(toks) else None

    while i < len(toks):
        w = _sem_acento(toks[i])
        ultimo = next((t for t in reversed(saida) if not t.isspace()), "")
        anterior_digito = ultimo[-1:].isdigit()
        eh_num = w in _UNIDADES or w in _GRANDEZAS
        if not eh_num or (w in _GRANDEZAS and anterior_digito):
            saida.append(toks[i])
            i += 1
            continue
        total = atual = 0
        piso = 4  # dentro do grupo, centena > dezena > unidade: "cem e duzentos" não é um número
        j = i
        fim = i
        while j is not None and j < len(toks):
            w = _sem_acento(toks[j])
            if w in _UNIDADES:
                v = _UNIDADES[w]
                classe = 3 if v >= 100 else 2 if v >= 20 else 1
                if classe >= piso:
                    break
                piso = classe
                atual += v
            elif w in _GRANDEZAS:
                total += max(atual, 1) * _GRANDEZAS[w]
                atual, piso = 0, 4
            else:
                break
            fim = j
            n = proximo_palavra(j)
            if n is not None and _sem_acento(toks[n]) == "e":
                n = proximo_palavra(n)
            if n is not None and (_sem_acento(toks[n]) in _UNIDADES or _sem_acento(toks[n]) in _GRANDEZAS):
                j = n
                continue
            break
        valor = total + atual
        depois = proximo_palavra(fim)
        moeda = depois is not None and _sem_acento(toks[depois]) in _MOEDA
        so_mil = i == fim and _sem_acento(toks[i]) == "mil"  # "mil vezes obrigado"
        if (valor >= 20 and not so_mil) or moeda:
            saida.append(str(valor))
            i = fim + 1
        else:
            saida.append(toks[i])
            i += 1
    return "".join(saida)


def leitura_de_valores(texto: str | None) -> tuple[list[int], bool]:
    """(valores em centavos que o texto cita, a quantia foi dita de forma vaga?).

    Entende dígitos ("1.234,56", "2 mil", "1,5 mil e 200"), reais e centavos ("3 reais e 50 centavos") e
    número por extenso ("trezentos e cinquenta", "dois mil e quinhentos"). Vago ("uns trezentos",
    "duzentos e tantos", "mais ou menos 100") devolve vago=True e nenhum valor: chutar a quantia é o erro caro.
    """
    if not texto:
        return [], False
    # "cem por cento" é taxa, não dinheiro (e o "cento" não pode virar um segundo número)
    texto = re.sub(r"(\w)\s+por\s+cento\b", r"\1% ", texto, flags=re.IGNORECASE)
    limpo = f" {_numeros_por_extenso(texto)} "
    if _VAGO.search(limpo):
        return [], True
    for padrao in _RUIDO:
        limpo = padrao.sub(" ", limpo)
    limpo = re.sub(r"\b(\d[\d.]*)\s*reais?\s+e\s+(\d{1,2})\s*centavos?\b",
                   lambda m: f"{m[1]},{m[2].zfill(2)}", limpo, flags=re.IGNORECASE)
    limpo = re.sub(r"\b(\d{1,2})\s*centavos?\b", lambda m: f"0,{m[1].zfill(2)}", limpo, flags=re.IGNORECASE)
    limpo = re.sub(r"\b(\d{1,3})\s*mil\s+(?:e\s+)?(\d{1,3})\b(?!\s*(?:x\b|vez|parcela|%|[/:]|h\b|[.,]\d))",
                   lambda m: str(int(m[1]) * 1000 + int(m[2])), limpo, flags=re.IGNORECASE)

    for padrao, fator in _MULTIPLICADORES:
        achados = padrao.findall(limpo)
        if achados:
            try:
                return [round(float(a.replace(".", "").replace(",", ".")) * fator * 100) for a in achados], False
            except ValueError:
                return [], False

    valores = []
    for bruto in _NUMEROS.findall(limpo):
        # quem vem por último manda: 1.234,56 (BR) vs 1,234.56 (US)
        if bruto.rfind(",") > bruto.rfind("."):
            normalizado = bruto.replace(".", "").replace(",", ".")
        else:
            normalizado = bruto.replace(",", "")
        try:
            valor = float(normalizado)
        except ValueError:
            continue
        valores.append(round(valor * 100))
    return valores, False


def parse_valor_em_centavos(texto: str | None) -> int | None:
    """"1.234,56" | "45" | "2 mil" | "trezentos reais" -> centavos. None se não houver UM candidato claro.

    Conservador de propósito: "parcelei 3600 em 12x" tem dois números, então
    devolve None e o fluxo pede para reformular. Chutar qual dos dois é o
    dinheiro é pior do que perguntar.
    """
    valores, _vago = leitura_de_valores(texto)
    if len(valores) != 1 or valores[0] <= 0:
        return None
    return valores[0]


def parse_installment_total(text: str, installments: int | None) -> int | None:
    """"Nx de V", "N vezes de V" e "N parcelas de V": V é o valor DE CADA parcela.

    Estrutura, não sentido: o N tem que ser o `installments` que o modelo extraiu.
    Com o padrão presente e N diferente (ou mais de um), devolve None — cair em
    `parse_valor_em_centavos` leria o V da parcela como TOTAL (fator N). "em N de V"
    fica de fora de propósito: "dia 12 de 150"/"12 de setembro" usam a mesma forma. Em
    "vezes"/"parcelas" o "de" é obrigatório: "12 vezes 3000" pode ser o total.
    """
    matches = _parcelas_ditas(text)
    if matches:
        each = parcela_dita(text, installments)
        return each * installments if each else None
    return parse_valor_em_centavos(text)


def _parcelas_ditas(text: str) -> list[tuple[str, str]]:
    return re.findall(
        r"\b(\d{1,3})\s*(?:x\s*(?:de\s*)?|(?:vezes|parcelas)\s+de\s*)(?:R\$\s*)?(\d[\d.,]*)",
        text or "", re.IGNORECASE,
    )


def parcela_dita(text: str, installments: int | None) -> int | None:
    """O V de UM "Nx de V" com N == `installments`, em centavos; senão None (mesma régua acima).

    Rede por cima do modelo (09/10/2026): o Claude Haiku devolveu `amount_cents` = 30000 para
    "TV em 10x de 300" em toda repetição — a PARCELA no lugar do total, com o exemplo exato no
    prompt. Quem chama compara: valor do modelo igual à parcela dita = ele esqueceu de multiplicar.
    """
    matches = _parcelas_ditas(text)
    if len(matches) == 1 and int(matches[0][0]) == installments:
        return parse_valor_em_centavos(matches[0][1].rstrip(".,"))
    return None


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
