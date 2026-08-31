"""Webhooks de terceiros. Cada um com o seu próprio segredo — nenhum usa OIDC."""

from __future__ import annotations

import logging

import orjson
from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb
from fastapi.responses import JSONResponse

from app import db
from app.config import get_settings
from app.domain import billing
from app.security import verify_shared_secret, verify_standardwebhooks
from app.services import whatsapp

log = logging.getLogger(__name__)
router = APIRouter(prefix="/hooks", tags=["hooks"])


@router.post("/otp")
async def otp(request: Request) -> JSONResponse:
    """Send SMS Hook do Supabase Auth: entrega o código de login por WhatsApp."""
    settings = get_settings()
    if not settings.send_sms_hook_secret:
        return JSONResponse({"error": {"message": "hook secret ausente"}}, status_code=500)

    raw = await request.body()
    if not verify_standardwebhooks(
        raw,
        request.headers.get("webhook-id"),
        request.headers.get("webhook-timestamp"),
        request.headers.get("webhook-signature"),
        settings.send_sms_hook_secret,
    ):
        return JSONResponse({"error": {"message": "assinatura inválida"}}, status_code=401)

    try:
        corpo = orjson.loads(raw)
        telefone = (corpo.get("user") or {}).get("phone")
        codigo = (corpo.get("sms") or {}).get("otp")
        if not telefone or not codigo:
            return JSONResponse({"error": {"message": "phone/otp ausentes"}}, status_code=400)

        await whatsapp.send_auth_code(telefone, codigo, settings.wa_otp_template)
        return JSONResponse({}, status_code=200)
    except Exception as err:  # noqa: BLE001
        log.exception("hook de OTP falhou")
        # erro estruturado para o Supabase conseguir mostrar
        return JSONResponse(
            {"error": {"http_code": 500, "message": str(err)}}, status_code=500
        )


@router.post("/billing")
async def revenuecat(request: Request) -> JSONResponse:
    """Webhook da RevenueCat: concede/revoga plano pago."""
    settings = get_settings()
    if not settings.revenuecat_webhook_secret:
        return JSONResponse({"error": "not configured"}, status_code=500)
    if not verify_shared_secret(
        request.headers.get("authorization"), settings.revenuecat_webhook_secret
    ):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        corpo = orjson.loads(await request.body())
    except orjson.JSONDecodeError:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    evento = corpo.get("event") or {}
    tipo = str(evento.get("type") or "")
    evento_id = str(evento.get("id") or "")
    if not evento_id or not tipo:
        return JSONResponse({"error": "evento sem id ou type"}, status_code=400)

    concede = billing.grants_access(tipo)
    if concede is None:
        log.info("billing: evento %s ignorado (não mexe em plano)", tipo)
        return JSONResponse({"ok": True, "ignorado": tipo})

    produto = str(evento.get("product_id") or "")
    eh_sandbox = str(evento.get("environment") or "").upper() == "SANDBOX"
    permite_sandbox = settings.billing_allow_sandbox == "true"
    if eh_sandbox and permite_sandbox:
        log.warning(
            "⚠️ BILLING_ALLOW_SANDBOX ligada: concedendo a partir de evento de SANDBOX. "
            "Desligue antes de publicar."
        )

    resultado = await db.fetch_one(
        """
        select public._apply_entitlement(
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        ) as resultado
        """,
        evento_id,
        str(evento.get("app_user_id") or ""),
        billing.provider_for_store(evento.get("store")) or "",
        str(
            evento.get("original_transaction_id")
            or evento.get("transaction_id")
            or evento_id
        ),
        produto,
        billing.plan_for_product(produto),
        "sandbox" if (eh_sandbox and not permite_sandbox) else "production",
        billing.ms_to_date(evento.get("expiration_at_ms")),
        str(evento.get("period_type") or "") == "TRIAL",
        concede,
        Jsonb(evento),
    )
    return JSONResponse({"ok": True, "resultado": (resultado or {}).get("resultado")})
