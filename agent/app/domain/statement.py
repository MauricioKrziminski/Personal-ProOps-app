"""Parsers de extrato bancário — puros, sem I/O.

Puros de propósito: é a lógica de maior risco da importação (formato de banco
brasileiro não tem padrão) e a única forma de confiar nela é teste rápido, sem
banco e sem rede.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass


@dataclass
class ParsedLine:
    kind: str  # expense | income
    amount_cents: int
    occurred_at: str  # YYYY-MM-DD
    description: str


def to_cents(raw: str) -> int | None:
    """"1.234,56" | "1234.56" | "-45,90" -> centavos (sempre positivo)."""
    limpo = re.sub(r"[^\d,.-]", "", raw or "").strip()
    if not limpo:
        return None
    # BR (1.234,56) vs US (1,234.56): manda quem vem por último
    if limpo.rfind(",") > limpo.rfind("."):
        normalizado = limpo.replace(".", "").replace(",", ".")
    else:
        normalizado = limpo.replace(",", "")
    try:
        return round(abs(float(normalizado)) * 100)
    except ValueError:
        return None


def is_negative(raw: str) -> bool:
    return (raw or "").strip().startswith("-")


def ofx_date(raw: str) -> str | None:
    """DTPOSTED é YYYYMMDD (com hora opcional colada)."""
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", raw or "")
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


def any_date(raw: str) -> str | None:
    """dd/mm/aaaa, aaaa-mm-dd ou dd-mm-aaaa -> ISO."""
    t = (raw or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    m = re.match(r"^(\d{2})[/-](\d{2})[/-](\d{4})", t)
    if m:
        return f"{m[3]}-{m[2]}-{m[1]}"
    return None


def parse_ofx(conteudo: str) -> list[ParsedLine]:
    """OFX é XML-ish com tag não fechada — regex por bloco <STMTTRN> é o caminho
    pragmático (o mesmo que os apps de finanças usam), sem dependência externa."""
    linhas: list[ParsedLine] = []
    for bloco in re.findall(r"<STMTTRN>([\s\S]*?)</STMTTRN>", conteudo or "", re.I):
        def tag(nome: str) -> str:
            m = re.search(rf"<{nome}>([^<\r\n]*)", bloco, re.I)
            return m.group(1).strip() if m else ""

        valor_raw = tag("TRNAMT")
        cents = to_cents(valor_raw)
        data = ofx_date(tag("DTPOSTED"))
        if not cents or not data:
            continue
        negativo = is_negative(valor_raw) or tag("TRNTYPE").upper() == "DEBIT"
        linhas.append(
            ParsedLine(
                kind="expense" if negativo else "income",
                amount_cents=cents,
                occurred_at=data,
                description=tag("MEMO") or tag("NAME") or "Lançamento importado",
            )
        )
    return linhas


def parse_csv(conteudo: str) -> list[ParsedLine]:
    """CSV de banco brasileiro não tem padrão: descobre as colunas pelo cabeçalho
    e cai para posicional (0,1,2) quando não acha."""
    texto = (conteudo or "").strip()
    if not texto:
        return []

    primeira = texto.split("\n", 1)[0]
    sep = ";" if primeira.count(";") > primeira.count(",") else ","
    linhas = list(csv.reader(io.StringIO(texto), delimiter=sep))
    linhas = [[c.strip() for c in l] for l in linhas if any(c.strip() for c in l)]
    if not linhas:
        return []

    cabecalho = [c.lower() for c in linhas[0]]

    def acha(*nomes: str) -> int:
        for i, coluna in enumerate(cabecalho):
            if any(n in coluna for n in nomes):
                return i
        return -1

    i_data = acha("data", "date")
    i_descr = acha(
        "descri", "histórico", "historico", "memo", "lançamento", "lancamento", "estabelecimento"
    )
    i_valor = acha("valor", "amount", "montante")
    tem_cabecalho = i_data >= 0 and i_valor >= 0
    if not tem_cabecalho:
        i_data, i_descr, i_valor = 0, 1, 2

    saida: list[ParsedLine] = []
    for campos in linhas[1:] if tem_cabecalho else linhas:
        data = any_date(campos[i_data] if i_data < len(campos) else "")
        valor_raw = campos[i_valor] if i_valor < len(campos) else ""
        cents = to_cents(valor_raw)
        if not data or not cents:
            continue
        descricao = campos[i_descr].strip() if 0 <= i_descr < len(campos) else ""
        saida.append(
            ParsedLine(
                kind="expense" if is_negative(valor_raw) else "income",
                amount_cents=cents,
                occurred_at=data,
                description=descricao or "Lançamento importado",
            )
        )
    return saida
