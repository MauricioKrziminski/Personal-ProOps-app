"""A lista de ícones e cores da meta é a do app: falha se a cópia Python divergir da TypeScript."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.domain import goal_appearance as ga

SRC = Path(__file__).resolve().parents[2] / "src"
CATEGORIAS = SRC / "lib" / "categorias.ts"
TEMA = SRC / "constants" / "theme.ts"


@pytest.mark.skipif(not CATEGORIAS.exists(), reason="src/ não está neste checkout")
def test_icones_e_rotulos_iguais_aos_do_app():
    ts = CATEGORIAS.read_text()
    grade = re.search(r"ICONES_DE_CATEGORIA: readonly IconName\[\] = \[(.*?)\];", ts, re.S).group(1)
    assert tuple(re.findall(r"'([^']+)'", grade)) == ga.ICONES
    rotulos = re.search(r"ROTULO_DO_ICONE: Record<string, string> = \{(.*?)\};", ts, re.S).group(1)
    pares = dict(re.findall(r"""['"]?([\w.]+)['"]?: '([^']+)'""", rotulos))
    assert pares == ga.ROTULO_DO_ICONE


@pytest.mark.skipif(not TEMA.exists(), reason="src/ não está neste checkout")
def test_cores_iguais_as_da_paleta_das_notas():
    ts = TEMA.read_text()
    ordem = re.search(r"NOTE_COLOR_NAMES: readonly NoteColorName\[\] = \[(.*?)\]", ts, re.S).group(1)
    assert set(re.findall(r"'([^']+)'", ordem)) == set(ga.CORES)
    migration = (SRC.parent / "supabase" / "migrations" / "20261005170000_goal_milestones.sql").read_text()
    check = re.search(r"color in\s*\((.*?)\)", migration, re.S).group(1)
    assert set(re.findall(r"'([^']+)'", check)) == set(ga.CORES)
