"""Meta WhatsApp Cloud API (oficial — nunca Baileys).

Porte de _shared/whatsapp.ts. Um cliente httpx compartilhado: abrir conexão nova
por mensagem no Cloud Run custa handshake TLS a cada envio.
"""

from __future__ import annotations

import logging

import httpx

from app.config import get_settings
from app.domain.phone import candidates

log = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.facebook.com/v21.0"

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _graph_post(payload: dict) -> httpx.Response:
    """POST na Graph API, tentando as duas formas do telefone brasileiro.

    A Meta ENTREGA o `from` sem o 9º dígito (`553598744200`) e ACEITA envio para
    a forma com o 9 (`5535998744200`), devolvendo o wa_id sem o 9 — ou seja, ela
    normaliza na entrada mas não na saída. Responder cegamente ao `from` recebido
    quebra sempre que o outro lado casa pela forma cadastrada; medido em
    31/08/2026 contra o número de teste, cuja allowed list guarda a forma COM o 9
    e recusa a sem, com `(#131030) Recipient phone number not in allowed list`.
    O envio falhava em silêncio (try_send engole) e a conversa ficava muda.

    Tenta primeiro o número como veio (é o que a Meta documenta) e só depois o
    candidato alternativo. Só troca em erro 4xx, que significa REJEITADO — nada
    foi entregue, então não há risco de mandar duas vezes. 5xx não troca: o
    problema é do servidor, não do número.
    """
    settings = get_settings()
    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
        raise RuntimeError("WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID ausentes")

    destinos = candidates(str(payload.get("to", ""))) or [str(payload.get("to", ""))]
    res: httpx.Response | None = None
    for i, destino in enumerate(destinos):
        res = await client().post(
            f"{GRAPH_BASE}/{settings.whatsapp_phone_number_id}/messages",
            headers={"Authorization": f"Bearer {settings.whatsapp_token}"},
            json={**payload, "to": destino},
        )
        if res.status_code < 400:
            if i:
                log.info("WhatsApp aceitou a forma alternativa do telefone")
            return res
        if res.status_code >= 500:
            break
    assert res is not None
    raise RuntimeError(f"WhatsApp send falhou ({res.status_code}): {res.text}")


async def send_text(to: str, body: str) -> None:
    """Texto livre — grátis dentro da janela de 24h iniciada pelo usuário."""
    await _graph_post(
        {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": body}}
    )


async def send_template(
    to: str, template_name: str, body_params: list[str], language: str = "pt_BR"
) -> None:
    """Template Utility — proativas (lembrete) fora da janela de 24h. PAGO."""
    components = (
        [{"type": "body", "parameters": [{"type": "text", "text": t} for t in body_params]}]
        if body_params
        else []
    )
    await _graph_post(
        {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                "components": components,
            },
        }
    )


async def send_auth_code(to: str, code: str, template_name: str, language: str = "pt_BR") -> None:
    """Template de categoria Authentication: repete o código no corpo e no botão."""
    await _graph_post(
        {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": code}]},
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [{"type": "text", "text": code}],
                    },
                ],
            },
        }
    )


async def try_send(to: str, body: str) -> bool:
    """Envio best-effort: NUNCA levanta.

    A confirmação sai depois de o dado estar gravado. Falha de envio (janela de
    24h fechada, Meta fora) não pode reprocessar a mensagem — reprocessar
    duplicaria lançamento, que é muito pior do que uma confirmação perdida.
    """
    try:
        await send_text(to, body)
        return True
    except Exception as err:  # noqa: BLE001
        log.warning("confirmação WhatsApp falhou (ignorado): %s", err)
        return False


async def download_media(media_id: str) -> tuple[bytes, str]:
    """Baixa mídia recebida. Devolve (bytes, mime_type)."""
    settings = get_settings()
    headers = {"Authorization": f"Bearer {settings.whatsapp_token}"}

    meta = await client().get(f"{GRAPH_BASE}/{media_id}", headers=headers)
    if meta.status_code >= 400:
        raise RuntimeError(f"Media metadata falhou ({meta.status_code})")
    info = meta.json()

    arquivo = await client().get(info["url"], headers=headers)
    if arquivo.status_code >= 400:
        raise RuntimeError(f"Media download falhou ({arquivo.status_code})")
    mime = info.get("mime_type") or arquivo.headers.get("content-type", "application/octet-stream")
    return arquivo.content, mime
