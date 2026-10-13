"""Páginas legais públicas (Termos, Privacidade, Apagar conta): HTML estático, sem login.

Fonte do texto: docs/legal/*.md; o HTML é gerado por docs/legal/gerar.py. Exigência das lojas:
URLs públicas e estáveis (a Apple e o Google abrem os links na revisão).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app import db

router = APIRouter(tags=["legal"])

_DIR = Path(__file__).resolve().parent.parent / "static" / "legal"
_CACHE = {"Cache-Control": "public, max-age=300"}


def _pagina(nome: str) -> HTMLResponse:
    return HTMLResponse((_DIR / f"{nome}.html").read_text(encoding="utf-8"), headers=_CACHE)


@router.get("/termos", include_in_schema=False)
def termos() -> HTMLResponse:
    return _pagina("termos")


@router.get("/privacidade", include_in_schema=False)
def privacidade() -> HTMLResponse:
    return _pagina("privacidade")


@router.get("/apagar-conta", include_in_schema=False)
def apagar_conta() -> HTMLResponse:
    return _pagina("apagar-conta")


# Descadastro do contato comercial (Política de Privacidade §2-A). O link de cada e-mail leva o
# `profiles.marketing_token` da pessoa, então funciona sem login. O GET só MOSTRA o botão: leitores de
# e-mail e antivírus abrem links sozinhos, e um GET que descadastrasse tiraria gente da lista sem ela
# pedir. O POST descadastra, e é também o "um clique" do cabeçalho List-Unsubscribe-Post (RFC 8058).
_SEM_CACHE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}
_ESTILO = (
    ":root{color-scheme:light dark}body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:32rem;"
    "margin:0 auto;padding:2rem 1.25rem;background:#fff;color:#1c1c1e}h1{font-size:1.4rem}"
    "button{font:inherit;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#0b0b0c;color:#fff}"
    "@media(prefers-color-scheme:dark){body{background:#111;color:#f2f2f7}button{background:#f4f4f2;color:#0b0b0c}}"
)


def _contato(titulo: str, corpo: str, status: int = 200) -> HTMLResponse:
    html = (
        f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{titulo}</title>'
        f"<style>{_ESTILO}</style></head><body><h1>{titulo}</h1>{corpo}</body></html>"
    )
    return HTMLResponse(html, status_code=status, headers=_SEM_CACHE)


def _token(valor: str) -> UUID | None:
    try:
        return UUID(valor)
    except ValueError:
        return None


_LINK_INVALIDO = ("Link inválido", "<p>Este link não vale mais. Para deixar de receber, desligue em "
                  "<strong>Perfil → Privacidade e dados</strong> no app ou escreva para gestao@proops.com.br.</p>")


@router.get("/contato/sair/{token}", include_in_schema=False)
def contato_sair_pergunta(token: str) -> HTMLResponse:
    t = _token(token)
    if t is None:
        return _contato(*_LINK_INVALIDO, status=404)
    return _contato(
        "Deixar de receber novidades",
        f'<p>Você não vai mais receber novidades e ofertas do ProOps. Avisos da sua conta continuam.</p>'
        f'<form method="post" action="/contato/sair/{t}"><button type="submit">Confirmar</button></form>',
    )


@router.post("/contato/sair/{token}", include_in_schema=False)
async def contato_sair(token: str) -> HTMLResponse:
    t = _token(token)
    feito = t is not None and await db.execute(
        "update public.profiles set marketing_opt_out_at = coalesce(marketing_opt_out_at, now())"
        " where marketing_token = %s",
        t,
    )
    if not feito:
        return _contato(*_LINK_INVALIDO, status=404)
    return _contato(
        "Pronto",
        "<p>Você não vai mais receber novidades e ofertas. Se mudar de ideia, ligue de novo em "
        "<strong>Perfil → Privacidade e dados</strong> no app.</p>",
    )
