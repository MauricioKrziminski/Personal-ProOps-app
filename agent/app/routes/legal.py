"""Páginas legais públicas (Termos, Privacidade, Apagar conta): HTML estático, sem login.

Fonte do texto: docs/legal/*.md; o HTML é gerado por docs/legal/gerar.py. Exigência das lojas:
URLs públicas e estáveis (a Apple e o Google abrem os links na revisão).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

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
