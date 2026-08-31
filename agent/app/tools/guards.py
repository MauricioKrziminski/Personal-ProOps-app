"""Validação de Nível 1 — determinística, depois do modelo e ANTES do banco.

Regra do projeto: nenhuma escrita nem cálculo sai do raciocínio livre da IA. Ela
preenche argumentos; estes guards decidem se aquilo pode virar linha no banco.

Tudo aqui é puro e testável sem rede — é o único jeito de ter certeza de que o
comportamento não muda quando o modelo muda.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from app.domain.categories import normalize as normalize_category
from app.domain.dates import local_iso_date
from app.domain.money import MAX_CENTS

# Um lançamento com data absurda ("0045-01-02", "2190-05-01") é alucinação ou
# erro de OCR de cupom — não é o usuário registrando o futuro distante.
MAX_ANOS_PARA_TRAS = 5
MAX_ANOS_PARA_FRENTE = 5

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Aceita só o que o expansor de RRULE do projeto sabe ler.
_RRULE = re.compile(
    r"^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Za-z0-9,\-+=]+)*$"
)


class Level1Error(ValueError):
    """Falha de validação com mensagem pronta para o WhatsApp.

    A mensagem é escrita para o usuário, não para o log: ele precisa saber o que
    reformular, não que o campo `amount_cents` falhou.
    """

    def __init__(self, mensagem_usuario: str, motivo: str = "") -> None:
        super().__init__(motivo or mensagem_usuario)
        self.mensagem_usuario = mensagem_usuario


def require_amount(cents: int | None, *, o_que: str = "o valor") -> int:
    if cents is None:
        raise Level1Error(f"❌ Não entendi {o_que}. Manda de novo com o número (ex.: \"mercado 45\").")
    if not isinstance(cents, int) or isinstance(cents, bool):
        raise Level1Error(f"❌ Não entendi {o_que}.", f"tipo inválido: {type(cents)}")
    if cents <= 0:
        raise Level1Error(f"❌ {o_que.capitalize()} precisa ser maior que zero.")
    if cents > MAX_CENTS:
        raise Level1Error(
            "❌ Esse valor está fora do que eu registro (acima de R$ 100 milhões). "
            "Se estiver certo mesmo, cadastra pelo app."
        )
    return cents


def optional_amount(cents: int | None, *, o_que: str = "o valor") -> int | None:
    return None if cents is None else require_amount(cents, o_que=o_que)


def require_date(value: str | None, timezone_name: str, *, default_hoje: bool = True) -> str:
    """YYYY-MM-DD dentro de uma janela plausível, no fuso do usuário."""
    if not value:
        if default_hoje:
            return local_iso_date(timezone_name)
        raise Level1Error("❌ Não entendi a data. Tenta \"ontem\", \"dia 5\" ou \"05/09\".")

    if not _ISO_DATE.match(value):
        raise Level1Error("❌ Não entendi a data.", f"formato inesperado: {value!r}")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise Level1Error("❌ Não entendi a data.", f"data inválida: {value!r}") from None

    hoje = date.fromisoformat(local_iso_date(timezone_name))
    if parsed < hoje - timedelta(days=365 * MAX_ANOS_PARA_TRAS):
        raise Level1Error("❌ Essa data é antiga demais. Confere o ano?")
    if parsed > hoje + timedelta(days=365 * MAX_ANOS_PARA_FRENTE):
        raise Level1Error("❌ Essa data é longe demais no futuro. Confere o ano?")
    return parsed.isoformat()


def optional_date(value: str | None, timezone_name: str) -> str | None:
    return None if not value else require_date(value, timezone_name, default_hoje=False)


def require_text(value: str | None, *, o_que: str, maximo: int = 2000) -> str:
    limpo = (value or "").strip()
    if not limpo:
        raise Level1Error(f"❌ Me diz {o_que}.")
    return limpo[:maximo]


def clean_category(value: str | None) -> str | None:
    return normalize_category(value)


def require_installments(n: int | None) -> int:
    if not isinstance(n, int) or isinstance(n, bool) or n < 2:
        raise Level1Error(
            "❌ Parcelamento precisa de 2 ou mais parcelas. Se foi à vista, é só me falar o valor."
        )
    if n > 99:
        raise Level1Error("❌ Mais de 99 parcelas eu não registro.")
    return n


def clean_rrule(value: str | None) -> str | None:
    """RRULE inválida vira None em vez de erro.

    Um lançamento com recorrência mal formada é melhor gravado como lançamento
    simples do que perdido — o usuário vê o item e conserta a repetição no app.
    """
    if not value:
        return None
    candidata = value.strip().upper()
    if not _RRULE.match(candidata):
        return None
    return candidata.removeprefix("RRULE:")


def split_installment_total(total_cents: int, parcelas: int) -> list[int]:
    """Divide o total entre as parcelas, com o resto na ÚLTIMA.

    Mesma regra da RPC create_installment_plan: a soma das parcelas SEMPRE bate
    com o total. Dividir "certinho" e arredondar cada uma cria centavos do nada.
    """
    base = total_cents // parcelas
    valores = [base] * parcelas
    valores[-1] += total_cents - base * parcelas
    return valores
