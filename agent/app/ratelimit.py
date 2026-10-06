"""Limite de taxa por usuário nas rotas do app (`current_user`): janela deslizante de 60 s.

ponytail: em memória e POR INSTÂNCIA — com N instâncias do Cloud Run o limite efetivo chega a N×
`rate_limit_per_minute`, e o contador some quando a instância é desligada (`min_instances = 0`).
Serve de freio contra laço de cliente e abuso casual, não de cota. Quando precisar de limite
exato: contador compartilhado (tabela/Redis) ou Cloud Armor na borda. Chaves de quem parou de
chamar só saem na próxima chamada do mesmo usuário (um deque vazio por usuário inativo).
"""

from __future__ import annotations

import time
from collections import deque
from uuid import UUID

from fastapi import HTTPException

from app.config import get_settings

JANELA_S = 60.0
_agora = time.monotonic  # trocável nos testes
_chamadas: dict[UUID, deque[float]] = {}


def checar(user_id: UUID) -> None:
    """Conta a chamada; acima do limite levanta 429. `rate_limit_per_minute = 0` desliga."""
    limite = get_settings().rate_limit_per_minute
    if limite <= 0:
        return
    agora = _agora()
    janela = _chamadas.setdefault(user_id, deque())
    while janela and agora - janela[0] >= JANELA_S:
        janela.popleft()
    if len(janela) >= limite:
        raise HTTPException(
            status_code=429,
            detail="muitas requisições, tente de novo em instantes",
            headers={"Retry-After": str(int(JANELA_S - (agora - janela[0])) + 1)},
        )
    janela.append(agora)
