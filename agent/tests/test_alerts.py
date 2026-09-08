"""Canais independentes dos alertas proativos.

O token de push e o telefone são capacidades, não preferências. Estes testes
impedem que a ausência de um canal volte a ativar o outro como fallback pago.
"""

from types import SimpleNamespace

import pytest
from psycopg.errors import UniqueViolation

from app.jobs import alerts


def _alert(**overrides):
    return {
        "workspace_id": "workspace-1",
        "user_id": "user-1",
        "phone": "5535999999999",
        "expo_push_token": "ExponentPushToken[token]",
        "alerts_push_enabled": True,
        "alerts_whatsapp_enabled": True,
        "kind": "negative_forecast",
        "ref": "2026-09-10",
        "title": "Saldo vai ficar negativo",
        "body": "Veja o que pode ser adiado.",
        **overrides,
    }


def _install(
    monkeypatch,
    candidates,
    *,
    duplicate_channels=frozenset(),
    failed_channels=frozenset(),
):
    reservations: list[str] = []
    pushes: list[tuple] = []
    whatsapps: list[tuple] = []

    async def fetch(_sql):
        return candidates

    async def execute(_sql, *args):
        channel = args[-1]
        reservations.append(channel)
        if channel in duplicate_channels:
            raise UniqueViolation("já reservado")
        return 1

    async def send_push(*args):
        if "push" in failed_channels:
            raise RuntimeError("push indisponível")
        pushes.append(args)

    async def send_whatsapp(*args):
        if "whatsapp" in failed_channels:
            raise RuntimeError("WhatsApp indisponível")
        whatsapps.append(args)

    monkeypatch.setattr(alerts.db, "fetch", fetch)
    monkeypatch.setattr(alerts.db, "execute", execute)
    monkeypatch.setattr(alerts.push, "send", send_push)
    monkeypatch.setattr(alerts.whatsapp, "send_template", send_whatsapp)
    monkeypatch.setattr(
        alerts,
        "get_settings",
        lambda: SimpleNamespace(wa_alert_template="personal_proops_alert"),
    )
    return reservations, pushes, whatsapps


@pytest.mark.asyncio
async def test_entrega_nos_dois_canais_e_reserva_cada_um(monkeypatch):
    reservations, pushes, whatsapps = _install(monkeypatch, [_alert()])

    result = await alerts.run()

    assert reservations == ["push", "whatsapp"]
    assert len(pushes) == 1
    assert whatsapps == [
        (
            "5535999999999",
            "personal_proops_alert",
            ["Saldo vai ficar negativo: Veja o que pode ser adiado."],
        )
    ]
    assert result == {"candidatos": 1, "enviados": 2, "pulados": 0}


@pytest.mark.asyncio
async def test_preferencia_nao_faz_fallback_para_outro_canal(monkeypatch):
    reservations, pushes, whatsapps = _install(
        monkeypatch,
        [
            _alert(
                expo_push_token=None,
                alerts_push_enabled=True,
                alerts_whatsapp_enabled=False,
            )
        ],
    )

    result = await alerts.run()

    assert reservations == []
    assert pushes == []
    assert whatsapps == []
    assert result == {"candidatos": 1, "enviados": 0, "pulados": 1}


@pytest.mark.asyncio
async def test_duplicata_em_push_nao_bloqueia_whatsapp(monkeypatch):
    reservations, pushes, whatsapps = _install(
        monkeypatch,
        [_alert()],
        duplicate_channels={"push"},
    )

    result = await alerts.run()

    assert reservations == ["push", "whatsapp"]
    assert pushes == []
    assert len(whatsapps) == 1
    assert result == {"candidatos": 1, "enviados": 1, "pulados": 1}


@pytest.mark.asyncio
async def test_ambos_desligados_nao_reserva_nem_entrega(monkeypatch):
    reservations, pushes, whatsapps = _install(
        monkeypatch,
        [_alert(alerts_push_enabled=False, alerts_whatsapp_enabled=False)],
    )

    result = await alerts.run()

    assert reservations == []
    assert pushes == []
    assert whatsapps == []
    assert result == {"candidatos": 1, "enviados": 0, "pulados": 1}


@pytest.mark.asyncio
async def test_whatsapp_habilitado_sem_telefone_nao_cria_historico_fantasma(monkeypatch):
    reservations, pushes, whatsapps = _install(
        monkeypatch,
        [_alert(phone=None, alerts_push_enabled=False, alerts_whatsapp_enabled=True)],
    )

    result = await alerts.run()

    assert reservations == []
    assert pushes == []
    assert whatsapps == []
    assert result["pulados"] == 1


@pytest.mark.asyncio
async def test_falha_no_push_nao_impede_tentativa_do_whatsapp(monkeypatch):
    reservations, pushes, whatsapps = _install(
        monkeypatch,
        [_alert()],
        failed_channels={"push"},
    )

    result = await alerts.run()

    assert reservations == ["push", "whatsapp"]
    assert pushes == []
    assert len(whatsapps) == 1
    assert result == {"candidatos": 1, "enviados": 1, "pulados": 1}


@pytest.mark.asyncio
async def test_teto_conta_alertas_logicos_e_nao_entregas(monkeypatch):
    candidates = [_alert(ref=f"alerta-{index}") for index in range(5)]
    reservations, pushes, whatsapps = _install(monkeypatch, candidates)

    result = await alerts.run()

    assert reservations == ["push", "whatsapp"] * 4
    assert len(pushes) == 4
    assert len(whatsapps) == 4
    assert result == {"candidatos": 5, "enviados": 8, "pulados": 1}
