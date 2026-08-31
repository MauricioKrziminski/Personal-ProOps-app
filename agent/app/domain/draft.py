"""Rascunho de lançamento: o que fazer com uma extração incompleta.

O usuário diz "comprei um mac em 12x". A intenção é inequívoca e o valor não
está lá. Havia duas saídas ruins:

- **descartar** — ele repete a frase inteira, e o agente parece surdo;
- **travar** a conversa na pergunta — ele não pode mudar de assunto, e um "anota
  aí que preciso de café" no meio vira confusão ou perda.

O rascunho é a terceira: fica inerte no banco, a vida segue, e ele volta quando
o dado chegar.

Divisão de trabalho, igual à da confirmação: **SE a mensagem responde ao
rascunho é semântico** (o modelo decide, porque "foi 5 mil", "5000", "custou
cinco mil" e "esquece isso" não cabem numa lista de padrões); **QUAL é o número
é parse determinístico** (`parse_valor_em_centavos`, que só aceita UM valor
plausível).
"""

from __future__ import annotations

import logging

from app.domain.money import parse_valor_em_centavos

log = logging.getLogger(__name__)

_PROMPT = """O usuário tem um lançamento pela metade. Faltou este dado: {pergunta}

Classifique a mensagem dele em UMA palavra:
- answer     — está respondendo o dado que faltava ("foi 5000", "5 mil", "custou 4500")
- discard    — está desistindo daquele lançamento ("esquece", "deixa pra lá", "cancela aquilo")
- unrelated  — é outro assunto ("anota comprar café", "quanto gastei esse mês?")

Na dúvida, responda unrelated: mexer no rascunho errado é pior que não mexer."""


async def _classificar(texto: str, pergunta: str) -> str:
    from app.graph.schemas import DraftDecision
    from app.security import wrap_untrusted
    from app.services.gemini import structured

    modelo = structured(DraftDecision)
    resposta = await modelo.ainvoke(
        [
            ("system", _PROMPT.format(pergunta=pergunta or "o valor")),
            ("human", wrap_untrusted(texto)),
        ]
    )
    return resposta.decision


async def interpretar(texto: str, rascunho: dict) -> dict | None:
    """O que fazer com o rascunho, ou None para deixá-lo intacto.

    `{"acao": "completar", "amount_cents": N}` · `{"acao": "descartar"}` · None.
    """
    if not texto or not texto.strip():
        return None
    try:
        decisao = await _classificar(texto, rascunho.get("missing", ""))
    except Exception:  # noqa: BLE001
        # falha fechada: sem classificação, o rascunho fica onde está
        log.warning("classificador de rascunho falhou — mantendo o rascunho", exc_info=True)
        return None

    if decisao == "discard":
        return {"acao": "descartar"}
    if decisao != "answer":
        return None

    valor = parse_valor_em_centavos(texto)
    if valor is None:
        # O modelo achou que é resposta, mas não há número extraível ("foi caro").
        # Completar assim recriaria o "registrar None em 12x" por outra porta.
        return None
    return {"acao": "completar", "amount_cents": valor}


def mesclar(acao_guardada: dict, amount_cents: int) -> dict:
    """Põe o valor no rascunho, sem sobrescrever o que já estava preenchido."""
    juntado = dict(acao_guardada)
    if not juntado.get("amount_cents"):
        juntado["amount_cents"] = amount_cents
    return juntado


def lembrete(rascunho: dict) -> str:
    """A frase discreta que lembra do rascunho. Template puro, zero modelo."""
    trecho = (rascunho.get("raw_text") or "").strip()
    if len(trecho) > 60:
        trecho = trecho[:59] + "…"
    return f"(Ainda tenho seu rascunho — *{trecho}*. É só me mandar o valor quando quiser.)"
