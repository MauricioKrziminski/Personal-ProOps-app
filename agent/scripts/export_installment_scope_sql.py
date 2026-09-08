"""Capture the actual payment tool SQL with a fictional frozen confirmation."""

import asyncio
import json
import sys
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph.schemas import FinanceAction
from app.tools.base import ExecContext
from app.tools.finance import mark_paid

from app import db


async def main():
    async def capture(sql, *args):
        parts = sql.split("%s")
        query = parts[0] + "".join(f"${i}{p}" for i, p in enumerate(parts[1:], 1))
        print(json.dumps({"query": query, "params": args}, default=str))
        return {"matched": 8, "changed": 8}

    db.fetch_one = capture
    rows = [
        {
            "id": str(UUID(int=i)),
            "installment_no": i,
            "amount_cents": 147000,
            "occurred_at": f"2026-{i:02d}-08",
            "status": "pending",
            "paid_at": None,
            "account_id": None,
            "invoice_id": None,
        }
        for i in range(1, 9)
    ]
    candidate = {
        "id": str(UUID(int=1000)),
        "label": "8 parcelas (1–8) — carro",
        "installment_snapshot": {"version": 2, "rows": rows, "total_cents": 1176000},
    }
    ctx = ExecContext(
        user_id=UUID(int=2000),
        workspace_id=UUID(int=2000),
        phone="",
        timezone="America/Sao_Paulo",
        texto="",
        source_message_id="fake",
        target={"table": "installment_plans", "candidates": [candidate]},
    )
    await mark_paid(ctx, FinanceAction(type="mark_paid"))


asyncio.run(main())
