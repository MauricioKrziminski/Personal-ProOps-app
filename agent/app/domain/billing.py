"""Assinatura por In-App Purchase (RevenueCat). Porte de _shared/billing.ts.

O mapa evento -> concede/revoga é o coração: errar aqui é cobrar de quem
cancelou ou cortar quem pagou.
"""

from __future__ import annotations

from datetime import date, timezone as _tz
from datetime import datetime

STORE_PRODUCTS: dict[str, str] = {
    "proops.personal.pro.monthly": "pro",
    "proops.personal.pro.annual": "pro",
    "proops.personal.family.monthly": "family",
    "proops.personal.family.annual": "family",
}

# CANCELLATION mantém acesso de propósito: "não vai renovar" ≠ "acabou agora".
# O acesso vale até a data de expiração — cortar antes é o tipo de coisa que
# vira reclamação no Reclame Aqui.
MANTEM_ACESSO = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "CANCELLATION",
    "BILLING_ISSUE",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
}

REVOGA = {
    "EXPIRATION",
    "REFUND",
    "REFUND_REVERSED",
    "SUBSCRIPTION_PAUSED",
    "TRANSFER",
}

PROVIDERS = {
    "APP_STORE": "app_store",
    "MAC_APP_STORE": "app_store",
    "PLAY_STORE": "play_store",
    "AMAZON": "amazon",
    "STRIPE": "stripe",
    "RC_BILLING": "rc_billing",
    "PROMOTIONAL": "promotional",
}


def plan_for_product(product_id: str | None) -> str | None:
    return STORE_PRODUCTS.get(product_id or "")


def grants_access(event_type: str) -> bool | None:
    """None = evento que registra e NÃO mexe no plano (TEST, INVOICE_ISSUANCE)."""
    if event_type in MANTEM_ACESSO:
        return True
    if event_type in REVOGA:
        return False
    return None


def provider_for_store(store: str | None) -> str | None:
    return PROVIDERS.get((store or "").upper())


def ms_to_date(ms: int | None) -> str | None:
    """expiration_at_ms -> data ISO (a checagem no banco usa DATA, não instante)."""
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=_tz.utc).date().isoformat()
    except (ValueError, OSError, OverflowError):
        return None
