"""SPA do painel /admin (build do Vite em `app/static/admin/`, gerado no Dockerfile).

Registrada DEPOIS do router da API (`/admin/api/*`): o fallback para o index.html nunca pode
engolir uma rota da API. `ADMIN_USER_IDS` vazio = painel desligado = 404, igual à API.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response

from app.config import get_settings

router = APIRouter(tags=["admin-web"])

DIST = Path(__file__).resolve().parent.parent / "static" / "admin"
_SEGURANCA = {"X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}


def _csp() -> str:
    conecta = " ".join(filter(None, ["'self'", get_settings().supabase_url.rstrip("/")]))
    return (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; "
        f"connect-src {conecta}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )


def _headers(extra: dict[str, str]) -> dict[str, str]:
    return {**_SEGURANCA, "Content-Security-Policy": _csp(), **extra}


@router.get("/admin", include_in_schema=False)
@router.get("/admin/{caminho:path}", include_in_schema=False)
def painel(caminho: str = "") -> Response:
    if not get_settings().admin_ids:
        raise HTTPException(status_code=404, detail="not found")
    if caminho == "api" or caminho.startswith("api/"):
        # rota de API inexistente: nunca responder HTML
        return JSONResponse({"error": "not_found"}, status_code=404, headers=_headers({"Cache-Control": "no-store"}))
    index = DIST / "index.html"
    if not index.is_file():
        return JSONResponse({"error": "painel indisponível: build do admin-web ausente"}, status_code=503, headers=_headers({"Cache-Control": "no-store"}))
    alvo = (DIST / caminho).resolve()
    if caminho and alvo.is_file() and alvo.is_relative_to(DIST.resolve()):
        # assets do Vite levam hash no nome: cache longo e imutável
        cache = "public, max-age=31536000, immutable" if caminho.startswith("assets/") else "public, max-age=3600"
        return FileResponse(alvo, headers=_headers({"Cache-Control": cache}))
    if "." in Path(caminho).name:
        raise HTTPException(status_code=404, detail="not found")  # arquivo inexistente não vira index.html
    return FileResponse(index, media_type="text/html", headers=_headers({"Cache-Control": "no-store"}))
