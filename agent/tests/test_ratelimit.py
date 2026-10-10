"""Limite de taxa por usuário: janela deslizante, por usuário, e plugado em `current_user`."""

from uuid import uuid4

import pytest
from fastapi import HTTPException, Request

from app import auth, ratelimit
from app.config import get_settings


@pytest.fixture(autouse=True)
def _limite(monkeypatch):
    ratelimit._chamadas.clear()
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 3)
    relogio = {"t": 1000.0}
    monkeypatch.setattr(ratelimit, "_agora", lambda: relogio["t"])
    return relogio


def test_passa_do_limite_vira_429_e_a_janela_desliza(_limite):
    u = uuid4()
    for _ in range(3):
        ratelimit.checar(u)
    with pytest.raises(HTTPException) as e:
        ratelimit.checar(u)
    assert e.value.status_code == 429
    _limite["t"] += 61
    ratelimit.checar(u)  # a janela andou


def test_limite_e_por_usuario():
    a, b = uuid4(), uuid4()
    for _ in range(3):
        ratelimit.checar(a)
    ratelimit.checar(b)


def test_zero_desliga(monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 0)
    u = uuid4()
    for _ in range(50):
        ratelimit.checar(u)


async def test_current_user_aplica_o_limite(monkeypatch):
    u = uuid4()
    monkeypatch.setattr(get_settings(), "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(auth, "decode_token", lambda _t: {"sub": str(u)})
    req = Request({"type": "http", "path": "/chat", "headers": [(b"authorization", b"Bearer t")]})
    for _ in range(3):
        assert await auth.current_user(req) == u
    with pytest.raises(HTTPException) as e:
        await auth.current_user(req)
    assert e.value.status_code == 429


async def test_painel_tem_limite_proprio_por_admin_sem_afrouxar_o_resto(monkeypatch):
    u = uuid4()
    monkeypatch.setattr(get_settings(), "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(get_settings(), "admin_rate_limit_per_minute", 10)
    monkeypatch.setattr(auth, "decode_token", lambda _t: {"sub": str(u)})
    cab = [(b"authorization", b"Bearer t")]
    painel = Request({"type": "http", "path": "/admin/api/overview", "headers": cab})
    app = Request({"type": "http", "path": "/chat/x", "headers": cab})
    for _ in range(10):  # acima do limite geral (3), dentro do do painel (10)
        await auth.current_user(painel)
    with pytest.raises(HTTPException) as e:
        await auth.current_user(painel)
    assert e.value.status_code == 429
    for _ in range(3):  # o contador do app é outro: o painel não o consumiu
        await auth.current_user(app)
    with pytest.raises(HTTPException):
        await auth.current_user(app)
