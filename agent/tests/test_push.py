"""O payload do push é a fronteira entre o servidor e o app.

O `data` que sai daqui é lido por `routeFor` em `src/lib/notifications.ts`, que trata `target`
como allowlist e `ref` como ponteiro validado por regex. Mudar a forma deste dicionário sem mexer
lá faz o toque na notificação não levar a lugar nenhum — sem erro, sem log, sem sintoma.
"""

from __future__ import annotations

import pytest

from app.services import push


class _Res:
    status_code = 200
    text = ""


def _captura(monkeypatch):
    enviados: list[dict] = []

    class _Client:
        def __init__(self, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def post(self, _url, json):  # noqa: A002
            enviados.append(json)
            return _Res()

    monkeypatch.setattr(push.httpx, "AsyncClient", _Client)
    return enviados


@pytest.mark.asyncio
async def test_o_fechamento_leva_target_cycle_e_o_mes_no_ref(monkeypatch):
    enviados = _captura(monkeypatch)

    await push.send("tok", "Setembro fechou", "Entrou...", "cycle", "2026-09-10")

    assert enviados[0]["data"] == {"target": "cycle", "ref": "2026-09-10"}


@pytest.mark.asyncio
async def test_sem_ref_o_data_nao_ganha_a_chave(monkeypatch):
    """`reminders.py` chama com 4 argumentos. O payload dele não pode mudar de forma."""
    enviados = _captura(monkeypatch)

    await push.send("tok", "⏰ Lembrete", "Pagar aluguel", "reminders")

    assert enviados[0]["data"] == {"target": "reminders"}


@pytest.mark.asyncio
async def test_alvo_fora_da_allowlist_cai_em_today(monkeypatch):
    """A allowlist é a última linha: alvo desconhecido nunca vira rota no app."""
    enviados = _captura(monkeypatch)

    await push.send("tok", "t", "b", "/etc/passwd", "x")

    assert enviados[0]["data"]["target"] == "today"


def test_target_for_mapeia_cycle_closed():
    assert push.target_for("cycle_closed") == "cycle"
    # e os que já existiam continuam onde estavam
    assert push.target_for("budget_100") == "budgets"
    assert push.target_for("invoice_due") == "cards"
    assert push.target_for("negative_forecast") == "forecast"
    assert push.target_for("bill_due") == "today"


def test_todo_alvo_de_target_for_esta_em_targets():
    for kind in ("cycle_closed", "budget_80", "invoice_due", "balance_x", "qualquer"):
        assert push.target_for(kind) in push.TARGETS
