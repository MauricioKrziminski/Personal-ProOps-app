"""Catálogo do agente e app não divergem: toda rota existe e todo item do GUIA tem resposta."""

import re
from pathlib import Path

from app.conhecimento.app import CATALOGO, POR_ID
from app.conhecimento.ajuda import rota_interna

RAIZ = Path(__file__).resolve().parents[2]
SRC_APP = RAIZ / "src" / "app"


def _rotas_do_app() -> set[str]:
    rotas = set()
    for arq in SRC_APP.rglob("*.tsx"):
        partes = [p for p in arq.relative_to(SRC_APP).with_suffix("").parts if not re.match(r"^\(.*\)$", p)]
        if partes and partes[-1] == "index":
            partes = partes[:-1]
        rotas.add("/" + "/".join(partes))
    return rotas


def test_ids_unicos_e_exemplos_suficientes():
    assert len(POR_ID) == len(CATALOGO)
    for e in CATALOGO:
        assert 3 <= len(e.perguntas) <= 6, e.id
        assert e.resposta.strip(), e.id
        assert (e.rota is None) or e.tela, f"{e.id}: rota sem nome de tela"


def test_toda_rota_do_catalogo_existe_no_app():
    existentes = _rotas_do_app()
    for e in CATALOGO:
        if e.rota:
            assert rota_interna(e.rota), f"{e.id}: rota fora do formato interno"
            assert e.rota in existentes, f"{e.id}: {e.rota} não existe em src/app"


def test_todo_href_do_guia_tem_entrada():
    dicas = (RAIZ / "src" / "lib" / "dicas.ts").read_text()
    hrefs = set(re.findall(r"href: '(/[^']*)'", dicas))
    bloco = re.search(r"const ROTA_DA_TELA = \{(.*?)\} as const", dicas, re.S).group(1)
    hrefs |= set(re.findall(r":\s*'(/[^']*)'", bloco))
    assert hrefs, "regex não achou nenhum href"
    rotas = {e.rota for e in CATALOGO}
    assert hrefs <= rotas, f"sem entrada no catálogo: {sorted(hrefs - rotas)}"
