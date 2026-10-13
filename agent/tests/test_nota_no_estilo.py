"""Acrescentar a uma lista segue o marcador que a nota JÁ usa (13/10/2026)."""

import pytest

from app.tools.notes import no_estilo_da_nota


@pytest.mark.parametrize("trecho, nota, esperado", [
    ("pão", "# Mercado\n- [ ] leite\n- [x] ovos", "- [ ] pão"),
    ("- pão\n- café", "# Mercado\n- [ ] leite", "- [ ] pão\n- [ ] café"),
    ("• Duna 2\n• Alien", "# Filmes\n1. Duna\n2. Oppenheimer", "3. Duna 2\n4. Alien"),
    ("- [ ] arroz", "- modo escuro", "- arroz"),
    ("ligar amanhã", "reunião foi boa", "ligar amanhã"),
    ("pão", None, "pão"),
])
def test_segue_o_marcador_da_nota(trecho, nota, esperado):
    assert no_estilo_da_nota(trecho, nota) == esperado
