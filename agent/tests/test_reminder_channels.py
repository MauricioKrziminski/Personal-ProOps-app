"""O WhatsApp de lembrete obedece ao interruptor do Perfil.

## Por que este arquivo existe

Em 08/09/2026 o dono do produto perguntou se religar os crons voltaria a mandar mensagem para o
WhatsApp dele. Para os **avisos financeiros** a resposta era não — `_alerts_to_send()` só devolve
perfil com `alerts_push_enabled` ou `alerts_whatsapp_enabled` ligado, e desde a `0052` os dois
nascem `false`. Para os **lembretes**, era sim:

- o job não lia flag nenhuma, só o `channel` gravado na linha do lembrete;
- a tela de lembrete criava com `channel = 'both'`, então bastava criar um lembrete no app para
  receber um template PAGO no WhatsApp;
- e mesmo com `channel = 'push'` havia **fallback**: sem `expo_push_token` o job caía no WhatsApp,
  transformando o canal "grátis" no canal pago sem ninguém pedir.

O portão do Perfil dizia "Avisos financeiros no WhatsApp: desligado" e não desligava nada aqui.
Um interruptor que não desliga é pior que nenhum interruptor — é por isso que estes casos são
teste e não uma linha num handoff.
"""

from __future__ import annotations

import pytest

from app.jobs import reminders


class _Espiao:
    """Dublê dos dois canais: teste que fala com a Meta ou com a Expo não entra (`agent.md`)."""

    def __init__(self) -> None:
        self.push: list[str] = []
        self.whatsapp: list[str] = []


@pytest.fixture
def canais(monkeypatch) -> _Espiao:
    espiao = _Espiao()

    async def push_fake(token, titulo, corpo, canal):  # noqa: ANN001
        espiao.push.append(corpo)

    async def wa_fake(telefone, template, params):  # noqa: ANN001
        espiao.whatsapp.append(params[0])

    monkeypatch.setattr(reminders.push, "send", push_fake)
    monkeypatch.setattr(reminders.whatsapp, "send_template", wa_fake)
    return espiao


def lembrete(**alteracoes):
    base = {
        "title": "pagar aluguel",
        "channel": "push",
        "phone": "5535998744200",
        "expo_push_token": "ExponentPushToken[abc]",
        "alerts_whatsapp_enabled": False,
    }
    return {**base, **alteracoes}


@pytest.mark.asyncio
async def test_push_sozinho_nao_encosta_no_whatsapp(canais):
    await reminders._entregar(lembrete())
    assert canais.push == ["pagar aluguel"]
    assert canais.whatsapp == []


@pytest.mark.asyncio
async def test_sem_token_de_push_o_fallback_NAO_vira_template_pago(canais):
    """O caso que pegava o dono do produto: conta nova, sem token, canal 'push'."""
    with pytest.raises(RuntimeError) as erro:
        await reminders._entregar(lembrete(expo_push_token=None))

    assert canais.whatsapp == []
    assert "desligado no Perfil" in str(erro.value)


@pytest.mark.asyncio
async def test_com_o_portao_ligado_o_fallback_volta_a_existir(canais):
    await reminders._entregar(
        lembrete(expo_push_token=None, alerts_whatsapp_enabled=True)
    )
    assert canais.whatsapp == ["pagar aluguel"]


@pytest.mark.asyncio
async def test_pedir_whatsapp_no_lembrete_nao_burla_o_portao(canais):
    """Escolher "WhatsApp" na tela não é autorização: o Perfil é a última palavra."""
    with pytest.raises(RuntimeError):
        await reminders._entregar(lembrete(channel="whatsapp", expo_push_token=None))
    assert canais.whatsapp == []


@pytest.mark.asyncio
async def test_both_com_portao_desligado_entrega_o_push_e_segue(canais):
    """Push entregue basta: um canal bloqueado não pode reprocessar um lembrete que já chegou."""
    await reminders._entregar(lembrete(channel="both"))
    assert canais.push == ["pagar aluguel"]
    assert canais.whatsapp == []


@pytest.mark.asyncio
async def test_perfil_sem_telefone_falha_dizendo_o_motivo(canais):
    with pytest.raises(RuntimeError) as erro:
        await reminders._entregar(
            lembrete(expo_push_token=None, phone=None, alerts_whatsapp_enabled=True)
        )
    assert "sem telefone verificado" in str(erro.value)
