"""Retenção: cada tabela é apagada com teto, e uma falha não impede as outras."""

import pytest

from app import db
from app.jobs import retencao


@pytest.mark.asyncio
async def test_apaga_cada_tabela_com_teto_e_isola_falha(monkeypatch):
    sqls = []

    async def execute(sql, *args):
        assert args == (retencao.TETO_POR_TABELA,)
        sqls.append(sql)
        if "alerts_sent" in sql:
            raise RuntimeError("boom")
        return 3

    monkeypatch.setattr(db, "execute", execute)
    r = await retencao.run()
    assert len(sqls) == len(retencao._REGRAS)
    assert r["alerts_sent"] == "erro" and r["messages_queue"] == 3
    # app_chat_messages é do usuário e nunca entra; o awaiting vivo nunca é apagado
    assert not any("app_chat_messages" in s for s in sqls)
    pend = next(s for s in sqls if "pending_actions" in s)
    assert "status <> 'awaiting'" in pend
