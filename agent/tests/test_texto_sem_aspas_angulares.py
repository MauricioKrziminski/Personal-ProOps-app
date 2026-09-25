"""Nenhum « » em texto que o agente escreve para a pessoa (25/09/2026).

Pedido do dono do produto: *"Esse « » pode retirar completamente de todos os lugares… coloque em
negrito ou algo assim, mas não deixe nenhum caractere, nem no agente"*. O termo vai em `*negrito*`
(WhatsApp e o chat do app desenham). Docstring e comentário podem citar o caractere.
"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def _docstrings(arvore: ast.AST) -> set[int]:
    ids = set()
    for no in ast.walk(arvore):
        if isinstance(no, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            corpo = getattr(no, "body", [])
            if corpo and isinstance(corpo[0], ast.Expr) and isinstance(corpo[0].value, ast.Constant):
                ids.add(id(corpo[0].value))
    return ids


def test_nenhum_texto_do_agente_tem_aspas_angulares():
    achados = []
    for arquivo in APP.rglob("*.py"):
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        docs = _docstrings(arvore)
        for no in ast.walk(arvore):
            if isinstance(no, ast.Constant) and isinstance(no.value, str) and id(no) not in docs:
                if "«" in no.value or "»" in no.value:
                    achados.append(f"{arquivo.relative_to(APP)}:{no.lineno}")
    assert achados == []


def test_nenhum_texto_do_agente_cita_entre_aspas_curvas():
    """A padronização do mesmo dia: nome e exemplo entre “ ” também viram `*negrito*`."""
    achados = []
    for arquivo in APP.rglob("*.py"):
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        docs = _docstrings(arvore)
        for no in ast.walk(arvore):
            if isinstance(no, ast.Constant) and isinstance(no.value, str) and id(no) not in docs:
                if "“" in no.value or "”" in no.value:
                    achados.append(f"{arquivo.relative_to(APP)}:{no.lineno}")
    assert achados == []
