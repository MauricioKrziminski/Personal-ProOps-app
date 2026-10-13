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


@pytest.mark.parametrize("conteudo, esperado", [
    ("# Lista do mercado\n- [ ] arroz\n- [ ] feijão\n- [ ] café", "*Lista do mercado* (arroz, feijão e café)"),
    ("- [ ] leite\n- [ ] ovos", "*leite e ovos*"),
    ("O João ligou", "*O João ligou*"),
    ("# Filmes\n1. A\n2. B\n3. C\n4. D\n5. E\n6. F\n7. G", "*Filmes* (A, B, C, D, E e mais 2)"),
    ("", "*(vazia)*"),
])
def test_previa_da_nota_numa_linha_sem_marcacao(conteudo, esperado):
    from app.graph.policy import previa_da_nota

    assert previa_da_nota(conteudo) == esperado
