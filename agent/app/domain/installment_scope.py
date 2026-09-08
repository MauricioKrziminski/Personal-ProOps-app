"""Bounded installment selection, validated before any confirmation."""

import re
import unicodedata
from datetime import date

from app.graph.schemas import InstallmentScope


def scope_from_text(
    text: str, parsed: InstallmentScope | None = None
) -> InstallmentScope | None:
    text = "".join(
        c
        for c in unicodedata.normalize("NFD", text.lower())
        if not unicodedata.combining(c)
    )
    # Explicit numbers outrank a model's accidental `all`.
    patterns = [
        (
            r"(?:primeiras?\s+(\d+)|(\d+)\s+(?:parcelas?\s+)?(?:anteriores|primeiras))",
            "first",
        ),
        (r"(?:ultimas?\s+(\d+)|(\d+)\s+ultimas?)", "last"),
        (
            r"ate\s+(?:a\s+)?(\d{1,3})(?:[ªaºo](?=\s|$)|(?=\s*(?:parcela|[,.!?]|$)))",
            "first",
        ),
    ]
    for pattern, mode in patterns:
        m = re.search(pattern, text)
        if m:
            # A range must be resolved before its inclusive end.
            span = re.search(
                r"(?:da[s]?\s+)?(\d+)[ªaºo]?\s+(?:a|ate)\s+(?:a\s+)?(\d+)[ªaºo]?", text
            )
            if span:
                return InstallmentScope(
                    mode="range", start=int(span[1]), end=int(span[2])
                )
            return InstallmentScope(
                mode=mode, count=int(next(v for v in m.groups() if v))
            )
    span = re.search(
        r"(?:da[s]?\s+)?(\d+)[ªaºo]?\s+(?:a|ate)\s+(?:a\s+)?(\d+)[ªaºo]?", text
    )
    if span:
        return InstallmentScope(mode="range", start=int(span[1]), end=int(span[2]))
    if parsed and parsed.mode != "all":
        return parsed
    if re.search(r"\b(anteriores|primeiras|ultimas|ate|entre)\b", text) or re.search(
        r"\d+\s+parcelas?", text
    ):
        return InstallmentScope(mode="unclear")
    if re.search(
        r"\b(todas?\s+as?\s+parcelas|plano\s+inteiro|compra\s+inteira)\b", text
    ):
        return InstallmentScope(mode="all")
    return InstallmentScope(mode="unclear") if parsed else None


def select_rows(
    rows: list[dict], scope: InstallmentScope, *, total_installments: int | None = None
) -> list[dict]:
    rows = sorted(rows, key=lambda r: int(r["installment_no"]))
    if not rows:
        raise ValueError("Não encontrei parcelas para essa compra.")
    if len({r["installment_no"] for r in rows}) != len(rows):
        raise ValueError("As parcelas precisam ser revisadas antes da baixa.")
    mode = scope.mode
    if mode in ("first", "last"):
        count = scope.count
        if count is None or count < 1 or count > len(rows):
            raise ValueError(
                "A quantidade não corresponde às parcelas existentes. Diga quais parcelas pagar."
            )
        if mode == "last":
            if not total_installments or count > total_installments:
                raise ValueError(
                    "Não consegui verificar o fim do plano. Diga o intervalo das parcelas."
                )
            expected = list(
                range(total_installments - count + 1, total_installments + 1)
            )
            selected = [row for row in rows if row["installment_no"] in expected]
            if [row["installment_no"] for row in selected] != expected:
                raise ValueError(
                    "Faltam parcelas no fim do plano. Diga quais parcelas pagar."
                )
            return selected
        selected = rows[:count]
        if mode == "first" and [r["installment_no"] for r in selected] != list(
            range(1, count + 1)
        ):
            raise ValueError(
                "Faltam parcelas nesse intervalo. Diga quais parcelas pagar."
            )
        return selected
    if mode == "range":
        start, end = scope.start, scope.end
        if start is None or end is None or start < 1 or end < start:
            raise ValueError(
                "Diga o intervalo de parcelas, por exemplo da 1ª até a 8ª."
            )
        selected = [r for r in rows if start <= r["installment_no"] <= end]
        if [r["installment_no"] for r in selected] != list(range(start, end + 1)):
            raise ValueError(
                "Faltam parcelas nesse intervalo. Diga quais parcelas pagar."
            )
        return selected
    if mode == "dates":
        start = date.fromisoformat(scope.from_date) if scope.from_date else date.min
        end = date.fromisoformat(scope.through_date) if scope.through_date else date.max
        if (not scope.from_date and not scope.through_date) or end < start:
            raise ValueError("Diga o período das parcelas que deseja pagar.")
        selected = [
            r for r in rows if start <= date.fromisoformat(str(r["occurred_at"])) <= end
        ]
        if not selected:
            raise ValueError("Não encontrei parcelas nesse período.")
        return selected
    if mode == "all":
        if total_installments is None or [r["installment_no"] for r in rows] != list(
            range(1, total_installments + 1)
        ):
            raise ValueError("Faltam parcelas no plano. Diga quais parcelas pagar.")
        return rows
    raise ValueError(
        "Quais parcelas deseja marcar como pagas? Diga a quantidade inicial, o intervalo ou até qual data."
    )
