"""Real Gemini extraction probe, fictional inputs only, no DB or messaging."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.graph.nodes import finance_node
from app.graph.schemas import FinanceAction


async def main():
    cases = [
        ("Todas as 8 anteriores do carro, marque como pagas", "first", 8),
        ("As 8 parcelas anteriores criadas do carro, marque como paga", "first", 8),
        ("Marque apenas a terceira parcela do carro como paga", "range", 3),
        (
            "Cadastre meu carro no Nubank em 48x de 1470, estou na nona parcela",
            None,
            None,
        ),
        (
            "Cadastre meu carro no Nubank em 48x de 1470, já paguei as primeiras oito",
            None,
            8,
        ),
    ]
    for text, mode, value in cases:
        result = await finance_node({"text": text, "timezone": "America/Sao_Paulo"})
        assert len(result["finance_actions"]) == 1, result
        action = FinanceAction.model_validate(result["finance_actions"][0])
        if mode:
            assert action.type.value == "mark_paid", action
            assert action.installment_scope and action.installment_scope.mode == mode, (
                action
            )
            assert (
                action.installment_scope.count
                if mode == "first"
                else action.installment_scope.start
            ) == value, action
        else:
            assert action.type.value == "create_installment_purchase", action
            assert action.already_paid_count == value, action
            assert action.amount_cents == 7056000, action
            assert action.current_installment == 9, action
        print("PASS", text, action.model_dump_json(exclude_none=True), flush=True)
    print("SCHEMA properties=", len(FinanceAction.model_fields))


asyncio.run(main())
