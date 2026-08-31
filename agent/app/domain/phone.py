"""Telefone brasileiro: a Meta às vezes manda sem o 9º dígito.

Porte do phoneCandidates() do process-jobs (index.ts:42-54). O usuário se
cadastra com 55 51 992553295 e o webhook chega como 55 51 92553295 — casar as
duas formas é o que impede "não encontrei sua conta" para quem tem conta.
"""

import re

_ONLY_DIGITS = re.compile(r"\D")
_BR_WITH_9 = re.compile(r"^55\d{2}9\d{8}$")
_BR_WITHOUT_9 = re.compile(r"^55\d{10}$")


def only_digits(raw: str) -> str:
    return _ONLY_DIGITS.sub("", raw or "")


def candidates(raw: str) -> list[str]:
    """Formatos possíveis do número, para casar com profiles.phone."""
    digits = only_digits(raw)
    if not digits:
        return []
    out = [digits]
    if _BR_WITH_9.match(digits):
        out.append(digits[:4] + digits[5:])          # remove o 9
    elif _BR_WITHOUT_9.match(digits):
        out.append(digits[:4] + "9" + digits[4:])    # acrescenta o 9
    return out


def canonical(raw: str) -> str:
    """Forma estável usada para derivar o thread_id.

    Sempre a versão COM o 9º dígito quando o número é brasileiro e móvel: se a
    Meta alternar entre os dois formatos no meio da conversa, o thread_id não
    pode mudar — o interrupt() pendente ficaria órfão.
    """
    digits = only_digits(raw)
    if _BR_WITHOUT_9.match(digits):
        return digits[:4] + "9" + digits[4:]
    return digits
