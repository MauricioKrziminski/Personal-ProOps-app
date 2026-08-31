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
TARGETS = ("today", "reminders", "budgets", "cards", "forecast")


def target_for(kind: str) -> str:
    if kind.startswith("budget"):
        return "budgets"
    if kind.startswith(("invoice", "card")):
        return "cards"
    if kind.startswith(("balance", "forecast")):
        return "forecast"
    return "today"


async def send(token: str, title: str, body: str, target: str = "today") -> None:
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
                "data": {"target": target},
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f"Expo push falhou ({res.status_code}): {res.text}")
