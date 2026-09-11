"""O cron de materialização: pega quem PRECISA, e os mais atrasados primeiro.

A query era `where r.active = true limit 200`, sem filtro e sem ordem. Os dois defeitos só
apareceriam com escala, e nenhum dos dois daria erro:

  • relia tudo toda hora para descobrir que não havia o que fazer;
  • "as primeiras 200" é estável o bastante para as MESMAS 200 ganharem sempre — passando disso,
    as séries de fora nunca seriam materializadas e o usuário veria meses vazios.

Este teste prende a FORMA da query, porque foi a forma que regrediu.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app import db
from app.jobs import scheduler


@pytest.mark.asyncio
async def test_so_pede_as_series_que_faltam_e_as_mais_atrasadas_primeiro(monkeypatch):
    vistas: dict[str, object] = {}

    async def fetch(query, *args):
        vistas["query"] = " ".join(query.split())
        vistas["args"] = args
        return []

    monkeypatch.setattr(db, "fetch", fetch)
    await scheduler.materialize_horizon(datetime(2026, 9, 10, 12, 0, tzinfo=UTC))

    q = vistas["query"]
    assert "materialized_until is null or r.materialized_until <" in q, (
        "sem o filtro, toda rodada reprocessa séries já materializadas"
    )
    assert "order by r.materialized_until asc nulls first" in q, (
        "sem a ordem, as mesmas séries ganham sempre e as outras nunca materializam"
    )
    assert "limit" in q, "o teto por rodada é orçamento, não pode sumir"


def test_o_horizonte_cobre_um_ano():
    """Um ano é o que o Google Calendar pré-computa, e é o que faz a janela editável
    cobrir qualquer mês que o usuário abra sem cair na projeção da regra."""
    assert scheduler.HORIZON_DAYS >= 365


@pytest.mark.asyncio
async def test_um_passo_que_falha_nao_derruba_os_outros(monkeypatch):
    """Os quatro passos do cron são independentes — e não podiam cair juntos.

    Rodavam em sequência crua, então a primeira exceção matava os seguintes. O caso concreto:
    subir o agente antes de aplicar a migration faz `_roll_overdue_invoices` não existir, e o
    `undefined_function` levaria junto a PROMOÇÃO de lançamentos vencidos e o snapshot de
    patrimônio — dois comportamentos antigos apagados, de hora em hora, por um erro de ordem
    numa feature nova.
    """
    from app.jobs import scheduler

    chamados: list[str] = []

    async def fake_fetch_one(sql, *args):
        chamados.append(sql)
        if "_roll_overdue_invoices" in sql:
            raise RuntimeError('function public._roll_overdue_invoices() does not exist')
        return {"n": 7}

    async def sem_materializar(_agora):
        return 0

    monkeypatch.setattr(scheduler.db, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(scheduler, "materialize_horizon", sem_materializar)

    r = await scheduler.run()

    assert r["promoted"] == 7, "o passo seguinte ao que falhou tem que ter rodado"
    assert r["snapshots"] == 7, "o snapshot de patrimônio não pode depender do rotativo"
    assert r["invoices_rolled"] == 0
    # O erro NÃO some: vai para a resposta do cron, que é o que o Cloud Logging guarda.
    assert "roll_overdue" in r["errors"]
    assert any("_promote_due_transactions" in s for s in chamados)
