"""Lote de extrato em pedaços que cabem no envelope, e o disjuntor do modelo principal."""

import asyncio
import re

import pytest
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, ValidationError

from app.security import MAX_UNTRUSTED_CHARS
from app.domain import importacao_ia as imp
from app.services import ia


# --- A1: lote dividido -------------------------------------------------------


class _Modelo:
    """Dublê do `structured(...)`: guarda o que o modelo VIU e responde por linha."""

    def __init__(self, resposta, visto, ativos):
        self.resposta, self.visto, self.ativos = resposta, visto, ativos

    async def ainvoke(self, mensagens):
        humano = mensagens[1][1]
        self.visto.append(humano)
        self.ativos["agora"] += 1
        self.ativos["pico"] = max(self.ativos["pico"], self.ativos["agora"])
        await asyncio.sleep(0.001)
        self.ativos["agora"] -= 1
        linhas = re.findall(r"^\d+\. (.*)$", humano, re.M)
        return self.resposta(linhas)


def _instalar(monkeypatch, resposta):
    visto, ativos = [], {"agora": 0, "pico": 0}
    monkeypatch.setattr(ia, "structured", lambda *a, **kw: _Modelo(resposta, visto, ativos))
    return visto, ativos


async def test_extrato_grande_chega_inteiro_ao_modelo_cada_linha_uma_vez(monkeypatch):
    visto, ativos = _instalar(monkeypatch, lambda ls: imp._Linhas(
        # a categoria devolvida É o texto da linha: prova o alinhamento por índice
        categories=[l.split("] ", 1)[1] for l in ls], natures=["compra"] * len(ls)))
    entrada = [("saída", f"COMPRA NUMERO {i} NO MERCADO DO BAIRRO") for i in range(500)]

    saida = await imp.classify_statement_lines(entrada, cartao=True)

    assert len(visto) > 1
    for payload in visto:
        assert "truncado" not in payload, "o envelope cortou parte do lote"
        assert len(payload) < MAX_UNTRUSTED_CHARS + 100
    tudo = "\n".join(visto)
    for _, descricao in entrada:
        assert tudo.count(descricao) == 1, descricao  # exatamente UMA vez
    assert [c for c, _ in saida] == [d.lower() for _, d in entrada]
    assert ativos["pico"] <= imp.CONCORRENCIA_LOTE


async def test_ultima_linha_de_cada_pedaco_chega_ao_modelo(monkeypatch):
    visto, _ = _instalar(monkeypatch, lambda ls: imp._Linhas(
        categories=["x"] * len(ls), natures=["compra"] * len(ls)))
    entrada = [("saída", "L" * 90 + f" {i:03d}") for i in range(300)]
    await imp.classify_statement_lines(entrada, cartao=False)
    for faixa, payload in zip(imp._pedacos([f"[saída] {d}" for _, d in entrada]), visto, strict=False):
        assert entrada[faixa[1] - 1][1] in payload


async def test_modelo_que_devolve_menos_itens_completa_com_none_no_lugar_certo(monkeypatch):
    _instalar(monkeypatch, lambda ls: imp._Linhas(
        categories=["a"] * (len(ls) - 1), natures=["compra"] * (len(ls) - 1)))
    entrada = [("saída", f"LINHA {i}") for i in range(3)]
    saida = await imp.classify_statement_lines(entrada, cartao=False)
    assert saida == [("a", "compra"), ("a", "compra"), (None, None)]


async def test_pares_em_pedacos_alinhados(monkeypatch):
    visto, _ = _instalar(monkeypatch, lambda ls: imp._Julgamentos(
        verdicts=["mesmo" if int(l.split()[-1]) % 2 == 0 else "diferente" for l in ls]))
    pares = [f"EXTRATO: {'X' * 120} | APP: Y {i}" for i in range(80)]
    veredictos = await imp.judge_statement_pairs(pares)
    assert len(visto) > 1 and all("truncado" not in v for v in visto)
    assert veredictos == ["mesmo" if i % 2 == 0 else "diferente" for i in range(80)]


async def test_pedaco_que_falha_deixa_so_as_linhas_dele_sem_resposta(monkeypatch):
    chamadas = {"n": 0}

    def resposta(ls):
        chamadas["n"] += 1
        if chamadas["n"] == 1:
            raise RuntimeError("503")
        return imp._Julgamentos(verdicts=["mesmo"] * len(ls))

    _instalar(monkeypatch, resposta)
    pares = [f"EXTRATO: {'X' * 120} | APP: Y {i}" for i in range(80)]
    veredictos = await imp.judge_statement_pairs(pares)
    assert veredictos.count(None) > 0 and veredictos.count("mesmo") > 0


async def test_todos_os_pedacos_falhando_levanta_para_o_importador_tratar(monkeypatch):
    def resposta(ls):
        raise RuntimeError("fora do ar")

    _instalar(monkeypatch, resposta)
    with pytest.raises(RuntimeError):
        await imp.judge_statement_pairs(["a", "b"])


# --- disjuntor ----------------------------------------------------------------


class _Fora(Exception):
    code = 503


class _S(BaseModel):
    x: int


@pytest.fixture
def relogio(monkeypatch):
    t = [1000.0]
    monkeypatch.setattr(ia, "_agora", lambda: t[0])
    ia._falhas.clear()
    ia._aberto_ate.clear()
    return t


def _montar(principal_erro):
    chamadas = {"principal": 0, "reserva": 0}

    async def principal(_):
        chamadas["principal"] += 1
        if principal_erro():
            raise principal_erro()
        return "do-principal"

    async def reserva(_):
        chamadas["reserva"] += 1
        return "da-reserva"

    r = ia._ComReserva(runnable=RunnableLambda(principal), fallbacks=[RunnableLambda(reserva)],
                           chave="lite", metadados={"papel": "parse"})
    return r, chamadas


async def test_depois_de_n_falhas_pula_o_principal_e_depois_tenta_de_novo(relogio):
    erro = [_Fora("503")]
    r, c = _montar(lambda: erro[0])
    for _ in range(ia.FALHAS_PARA_ABRIR):
        assert await r.ainvoke("x") == "da-reserva"
    assert c["principal"] == ia.FALHAS_PARA_ABRIR

    assert await r.ainvoke("x") == "da-reserva"
    assert c["principal"] == ia.FALHAS_PARA_ABRIR, "aberto: não pode esperar o principal"

    relogio[0] += ia.PAUSA_S + 1  # meio aberto: UMA tentativa
    erro[0] = None
    assert await r.ainvoke("x") == "do-principal"
    assert c["principal"] == ia.FALHAS_PARA_ABRIR + 1
    # sucesso fecha de vez
    assert await r.ainvoke("x") == "do-principal"
    assert "lite" not in ia._aberto_ate


async def test_meio_aberto_que_falha_reabre_com_uma_so_falha(relogio):
    r, c = _montar(lambda: _Fora("503"))
    for _ in range(ia.FALHAS_PARA_ABRIR):
        await r.ainvoke("x")
    relogio[0] += ia.PAUSA_S + 1
    await r.ainvoke("x")  # a tentativa do meio aberto falha
    antes = c["principal"]
    await r.ainvoke("x")
    assert c["principal"] == antes, "uma falha no meio aberto tem que reabrir"


async def test_erro_de_schema_nao_conta_para_abrir(relogio):
    try:
        _S.model_validate({"x": "nao-e-int"})
    except ValidationError as e:
        invalido = e
    r, c = _montar(lambda: invalido)
    for _ in range(ia.FALHAS_PARA_ABRIR + 2):
        assert await r.ainvoke("x") == "da-reserva"
    assert c["principal"] == ia.FALHAS_PARA_ABRIR + 2, "erro de schema não é queda do modelo"


def test_indisponibilidade_segue_a_cadeia_de_causas():
    class ReadTimeout(Exception):
        pass

    try:
        try:
            raise ReadTimeout()
        except ReadTimeout as e:
            raise RuntimeError("embrulhado") from e
    except RuntimeError as embrulhado:
        assert ia._indisponivel(embrulhado)
    assert not ia._indisponivel(ValueError("400"))


def test_papel_do_portao_nao_ganha_disjuntor_nem_reserva(monkeypatch):
    # portão em Gemini (suítes): sem reserva, como sempre. Com Claude ele tem a reserva no Gemini.
    monkeypatch.setenv("IA_TABELA", "economica")
    ia._cache.clear()
    assert not isinstance(ia.structured(_S, "gate"), ia._ComReserva)
    assert isinstance(ia.structured(_S, "parse"), ia._ComReserva)
