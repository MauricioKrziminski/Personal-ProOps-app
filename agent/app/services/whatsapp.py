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


async def mark_as_read(wa_message_id: str) -> None:
    """Marca mensagem como lida na Graph API (feedback visual instantâneo)."""
    settings = get_settings()
    if not settings.whatsapp_token or not settings.whatsapp_phone_number_id or not wa_message_id:
        return
    await client().post(
        f"{GRAPH_BASE}/{settings.whatsapp_phone_number_id}/messages",
        headers={"Authorization": f"Bearer {settings.whatsapp_token}"},
        json={
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": wa_message_id,
        },
    )


async def try_mark_read(wa_message_id: str) -> bool:
    """Best-effort: não derruba o fluxo se a Meta falhar."""
    if not wa_message_id:
        return False
    try:
        await mark_as_read(wa_message_id)
        return True
    except Exception as err:  # noqa: BLE001
        log.debug("marcar lido no WhatsApp falhou (ignorado): %s", err)
        return False


# Limites físicos da Cloud API. Estourar não dá erro bonito: vira 400 que o
# `try_send` engole, e a pergunta simplesmente não chega.
BTN_MAX, BTN_TITLE_MAX = 3, 20
ROW_MAX, ROW_TITLE_MAX, ROW_DESC_MAX = 10, 24, 72
BODY_MAX = 1024


def _cut(texto: str, n: int) -> str:
    texto = (texto or "").strip()
    encoded = texto.encode("utf-8")
    if len(encoded) <= n:
        return texto
    cuted = encoded[: max(0, n - 3)].decode("utf-8", errors="ignore")
    return cuted.strip() + "…"


async def send_buttons(to: str, body: str, buttons: list[tuple[str, str]]) -> None:
    """Até 3 botões de resposta rápida. `buttons` é [(id, título)].

    Os rótulos chegam aqui já prefixados por número ("1) ", "2) ") e o corte é
    sempre NO FIM — o número nunca é cortado, então duas opções truncadas
    continuam distinguíveis, e o número é a mesma chave que o fallback de texto
    entende. Truncar no meio ou no começo criaria duas opções idênticas na tela.
    """
    if not 1 <= len(buttons) <= BTN_MAX:
        raise ValueError(f"WhatsApp aceita 1..{BTN_MAX} botões, recebi {len(buttons)}")

    body_str = (body or "").strip()
    # Se o corpo for longo (> 800 bytes em UTF-8), envia o texto principal completo primeiro
    # e manda os botões em seguida com prompt conciso para evitar rejeição 400 da Meta (limite 1024 bytes).
    if len(body_str.encode("utf-8")) > 800:
        await send_text(to, body_str)
        prompt_botoes = "Deseja ver mais detalhes ou opções?"
    else:
        prompt_botoes = _cut(body_str, BODY_MAX)

    await _graph_post(
        {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": prompt_botoes},
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {"id": bid, "title": _cut(titulo, BTN_TITLE_MAX)},
                        }
                        for bid, titulo in buttons
                    ]
                },
            },
        }
    )


async def send_list(to: str, body: str, label: str, rows: list[tuple[str, str, str]]) -> None:
    """Até 10 linhas. `rows` é [(id, título, descrição)].

    Valor e data vão na DESCRIÇÃO (72 chars), não no título (24): é onde cabe
    informação sem competir com o número que identifica a opção.
    """
    if not 1 <= len(rows) <= ROW_MAX:
        raise ValueError(f"WhatsApp aceita 1..{ROW_MAX} linhas, recebi {len(rows)}")

    body_str = (body or "").strip()
    if len(body_str.encode("utf-8")) > 800:
        await send_text(to, body_str)
        prompt_lista = "Escolha uma opção na lista abaixo:"
    else:
        prompt_lista = _cut(body_str, BODY_MAX)

    await _graph_post(
        {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": prompt_lista},
                "action": {
                    "button": _cut(label, BTN_TITLE_MAX),
                    "sections": [
                        {
                            "title": "Opções",
                            "rows": [
                                {
                                    "id": rid,
                                    "title": _cut(titulo, ROW_TITLE_MAX),
                                    "description": _cut(desc, ROW_DESC_MAX),
                                }
                                for rid, titulo, desc in rows
                            ],
                        }
                    ],
                },
            },
        }
    )


async def try_send_interactive(to: str, spec: dict) -> None:
    """Manda a pergunta interativa; cai para TEXTO se qualquer coisa falhar.

    O texto de fallback contém a MESMA lista numerada, então cliente que não
    renderiza interativo (ou envio que falhou) ainda mostra a pergunta inteira e
    o usuário responde pelo número. Best-effort como todo envio: nunca levanta.
    """
    try:
        if spec.get("ui") == "list":
            await send_list(to, spec["body"], spec.get("label", "Escolher"), spec["rows"])
        else:
            await send_buttons(to, spec["body"], spec["buttons"])
        return
    except Exception as err:  # noqa: BLE001
        log.error("envio interativo falhou (spec=%s): %s", spec, err, exc_info=True)
    await try_send(to, spec.get("text") or spec.get("body", ""))


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
