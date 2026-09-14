"""Expo Push — canal proativo PREFERENCIAL porque é grátis.

Template do WhatsApp é pago (~US$0,007 por mensagem fora da janela de 24h), e o
produto foi desenhado para custar quase nada no começo. Push primeiro, WhatsApp
como complemento ou fallback.
"""

from __future__ import annotations

import httpx

EXPO_URL = "https://exp.host/--/api/v2/push/send"

# `target` é chave de uma allowlist no app (src/lib/notifications.ts), não rota
# livre: payload externo não pode escolher para onde o app navega.
TARGETS = ("today", "reminders", "budgets", "cards", "forecast", "cycle")


def target_for(kind: str) -> str:
    # `cycle` primeiro: o próximo `kind` que comece com "c" não pode sombrear o fechamento por
    # acidente de ordem. Hoje nenhum dos outros ramos casaria "cycle_closed", mas a ordem é a
    # documentação de qual é o mais específico.
    if kind.startswith("cycle"):
        return "cycle"
    if kind.startswith("budget"):
        return "budgets"
    if kind.startswith(("invoice", "card")):
        return "cards"
    # ⚠️ `startswith(("balance", "forecast"))` era ramo MORTO: o único kind de projeção é
    # `negative_forecast`, que começa com "negative". O aviso "seu saldo fica negativo dia DD/MM —
    # quer ver o que da pra adiar?" abria a HOJE, onde não se adia nada, em vez da Projeção, que
    # é a tela que responde a pergunta. Achado em 14/09/2026 ao escrever o teste de `target_for`.
    if "forecast" in kind or kind.startswith("balance"):
        return "forecast"
    return "today"


async def send(
    token: str, title: str, body: str, target: str = "today", ref: str | None = None
) -> None:
    """`ref` viaja junto para o app saber QUAL item abrir.

    Ele já existe em todo alerta (é a chave de dedupe em `alerts_sent`), então carregá-lo não
    inventa conceito novo. Quem decide se ele significa alguma coisa é o app: em `cycle` ele é o
    mês a abrir, e lá ele passa por uma regex antes de virar rota. A allowlist continua sendo o
    `target` — `ref` nunca escolhe PARA ONDE se navega, só qual item dentro do destino.
    """
    if target not in TARGETS:
        target = "today"
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(
            EXPO_URL,
            json={
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                "data": {"target": target, **({"ref": ref} if ref else {})},
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f"Expo push falhou ({res.status_code}): {res.text}")
