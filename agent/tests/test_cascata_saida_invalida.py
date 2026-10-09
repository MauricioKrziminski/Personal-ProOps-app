"""Cascata por falha OBJETIVA: o principal responde mas a saída não valida -> a MESMA chamada vai à reserva.

Não é escalonamento por confiança (`ia.md` proíbe). O mecanismo é o `except` de
`_ComReserva`; estes testes o prendem com dublês: saída inválida -> reserva; válida -> não;
indisponível -> o caminho de sempre (conta para o disjuntor). O portão segue sem reserva.
"""

import pytest
from langchain_core.exceptions import OutputParserException
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, ValidationError

from app.services import ia


class _S(BaseModel):
    x: int


class _Fora(Exception):
    code = 503


@pytest.fixture(autouse=True)
def _limpo():
    ia._falhas.clear()
    ia._aberto_ate.clear()


def _montar(principal):
    chamadas = {"principal": 0, "reserva": 0, "meta_reserva": None}

    async def p(_):
        chamadas["principal"] += 1
        return principal()

    async def r(_, config=None):
        chamadas["reserva"] += 1
        chamadas["meta_reserva"] = (config or {}).get("metadata")
        return "da-reserva"

    return ia._ComReserva(runnable=RunnableLambda(p), fallbacks=[RunnableLambda(r)],
                              chave="lite", metadados={"papel": "parse"}), chamadas


def _levanta(erro):
    def f():
        raise erro
    return f


def _validacao():
    try:
        _S.model_validate({"x": "nao-e-int"})
    except ValidationError as e:
        return e


async def test_saida_invalida_vai_uma_vez_a_reserva_sem_abrir_o_disjuntor():
    for erro in (_validacao(), OutputParserException("json quebrado")):
        r, c = _montar(_levanta(erro))
        assert await r.ainvoke("x") == "da-reserva"
        assert (c["principal"], c["reserva"]) == (1, 1)
        assert c["meta_reserva"]["reserva_motivo"] == "invalida"
        assert c["meta_reserva"]["reserva"] is True
    assert "lite" not in ia._falhas, "saída inválida não é queda do modelo"


async def test_saida_vazia_tambem_e_invalida():
    r, c = _montar(lambda: None)
    assert await r.ainvoke("x") == "da-reserva"
    assert c["meta_reserva"]["reserva_motivo"] == "invalida"


async def test_saida_valida_nao_chama_a_reserva():
    r, c = _montar(lambda: _S(x=1))
    assert await r.ainvoke("x") == _S(x=1)
    assert (c["principal"], c["reserva"]) == (1, 0)


async def test_indisponivel_segue_o_caminho_de_hoje():
    r, c = _montar(_levanta(_Fora("503")))
    assert await r.ainvoke("x") == "da-reserva"
    assert c["meta_reserva"]["reserva_motivo"] == "indisponivel"
    assert len(ia._falhas["lite"]) == 1, "indisponibilidade continua alimentando o disjuntor"


def test_saida_invalida_segue_a_cadeia_de_causas():
    try:
        try:
            raise OutputParserException("x")
        except OutputParserException as e:
            raise RuntimeError("embrulhado") from e
    except RuntimeError as embrulhado:
        assert ia._saida_invalida(embrulhado)
    assert not ia._saida_invalida(ValueError("400"))
    assert not ia._saida_invalida(_Fora("503"))


def test_o_portao_em_gemini_continua_sem_reserva(monkeypatch):
    monkeypatch.setenv("IA_TABELA", "economica")
    ia._cache.clear()
    assert not isinstance(ia.structured(_S, "gate"), ia._ComReserva)
