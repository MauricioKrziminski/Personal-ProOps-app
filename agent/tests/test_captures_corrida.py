"""Duas capturas da MESMA compra ao mesmo tempo (dois aparelhos, push + SMS) não escapam uma da outra.

O dublê reproduz o que o Postgres faz: `pg_advisory_xact_lock` bloqueia a segunda unidade até a primeira
terminar (commit), e a captura gravada só fica visível depois do commit. Sem o lock, as duas leem "sem
igual" e as duas viram `pending` (o segundo teste prova que o dublê enxerga isso).
"""

import asyncio
from contextvars import ContextVar
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app import db
from app.routes import captures
from app.routes.finance_draft import RascunhoOut

WS = uuid4()
QUANDO = datetime(2026, 10, 12, 15, 30, tzinfo=timezone.utc)


def _item(ext):
    return captures.NotificacaoIn(external_id=ext, package="com.nu.production", title="Compra aprovada",
                                  text="Compra de R$ 45,90 aprovada em MERCADO", posted_at=QUANDO)


@pytest.fixture
def banco(monkeypatch):
    estado = {"gravadas": [], "log": []}  # gravadas = só o que já commitou
    trava = asyncio.Lock()
    tem_lock = {"ligado": True}

    tx_atual: ContextVar = ContextVar("tx")  # cada captura roda na sua tarefa, com a sua transação

    @asynccontextmanager
    async def unidade():
        tx = {"escritas": [], "segura": False}
        marca = tx_atual.set(tx)
        try:
            yield
        finally:
            estado["gravadas"].extend(tx["escritas"])  # commit
            if tx["segura"]:
                trava.release()
            tx_atual.reset(marca)

    async def fetch(sql, *args):
        if "pg_advisory_xact_lock" in sql:
            if tem_lock["ligado"]:
                await trava.acquire()
                tx_atual.get()["segura"] = True
            estado["log"].append("lock")
            return [{}]
        if "status in ('pending', 'duplicate', 'confirmed')" in sql:
            await asyncio.sleep(0)  # cede a vez: é aqui que a segunda leitura escaparia sem o lock
            reserva = args[1]
            achou = [g for g in estado["gravadas"] if g["id"] != reserva]
            return [{"id": g["id"]} for g in achou]
        return []

    async def execute(sql, *args):
        assert sql.lstrip().startswith("update")
        reserva, status = args[-1], args[1]
        await asyncio.sleep(0)
        tx_atual.get()["escritas"].append({"id": reserva, "status": status})
        estado.setdefault("status", {})[reserva] = status
        return 1

    async def existentes(*_a):
        return []

    monkeypatch.setattr(db, "unidade_de_trabalho", unidade)
    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "execute", execute)
    monkeypatch.setattr(captures.importer, "carregar_existentes", existentes)
    estado["lock"] = tem_lock
    return estado


async def _guardar_duas():
    r = RascunhoOut(tipo="uma", params={"kind": "expense"}, perguntas=[], entendido="Gasto de R$ 45,90")
    acao = {"type": "create_expense", "amount_cents": 4590, "description": "mercado"}
    await asyncio.gather(*[
        captures._guardar(WS, f"res-{i}", _item(f"ext-0000000{i}"), "Nubank", r, acao, QUANDO.date())
        for i in (1, 2)
    ])


@pytest.mark.asyncio
async def test_duas_capturas_simultaneas_da_mesma_compra_viram_pendente_e_duplicada(banco):
    await _guardar_duas()
    assert sorted(banco["status"].values()) == ["duplicate", "pending"]


@pytest.mark.asyncio
async def test_sem_o_lock_o_duble_mostra_a_corrida(banco):
    banco["lock"]["ligado"] = False
    await _guardar_duas()
    assert sorted(banco["status"].values()) == ["pending", "pending"]


def test_a_chave_do_lock_separa_espaco_banco_tipo_e_valor():
    base = captures.chave_da_captura(WS, "Nubank", "expense", 4590)
    assert base == captures.chave_da_captura(WS, "Nubank", "expense", 4590)
    for outra in (captures.chave_da_captura(uuid4(), "Nubank", "expense", 4590),
                  captures.chave_da_captura(WS, "Itaú", "expense", 4590),
                  captures.chave_da_captura(WS, "Nubank", "income", 4590),
                  captures.chave_da_captura(WS, "Nubank", "expense", 4591)):
        assert outra != base
