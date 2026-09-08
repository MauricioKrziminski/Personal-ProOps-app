#!/usr/bin/env python3
"""One real Gemini schema probe using only a fictional transaction correction.

From agent/: .venv/bin/python scripts/probe_transaction_account_schema.py
No database, WhatsApp, or record mutation. Uses configured Gemini credentials.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph.prompts import FINANCE
from app.graph.schemas import FinanceAction, FinancePlan
from app.services import gemini


async def main():
    response = await gemini.structured(FinancePlan, gemini.GEMINI_PARSE).ainvoke([
        ('system', FINANCE),
        ('human', 'Muda meu último gasto para 54 reais na conta Nubank'),
    ])
    assert len(response.actions) == 1
    action = response.actions[0]
    assert action.type.value == 'update_transaction'
    assert action.new_amount_cents == 5400
    assert action.new_account and 'nubank' in action.new_account.lower()
    assert not action.account, 'current/search account must not carry the correction'
    print(f'PASS model={gemini.GEMINI_PARSE}, properties={len(FinanceAction.model_fields)}')
    print(response.model_dump_json())


if __name__ == '__main__':
    asyncio.run(main())
