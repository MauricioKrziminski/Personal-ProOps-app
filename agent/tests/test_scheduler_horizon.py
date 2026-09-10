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
