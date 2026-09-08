"""Explicit live Gemini probe; database reads/writes replaced. Never sends WhatsApp."""

import asyncio
from app.graph import nodes
from app.graph.schemas import ResourceAction
from app.tools import resources


async def no_rows(sql, *args, **kw):
    if "public.debts" in sql and "select *" in sql:
        return [
            {
                "id": "00000000-0000-0000-0000-000000000010",
                "row_version": "1",
                "name": "Carro",
                "principal_cents": 6000000,
                "remaining_cents": 5000000,
                "account_id": "00000000-0000-0000-0000-000000000020",
            }
        ]
    if "public.accounts" in sql:
        return [
            {
                "id": "00000000-0000-0000-0000-000000000020",
                "name": "Reserva",
                "type": "savings",
            }
        ]
    return []


async def main():
    resources.db.fetch = no_rows
    cases = [
        (
            "Crie um cartão Nubank, fechamento dia 5, vencimento dia 12, limite de 20 mil reais.",
            "cards",
        ),
        ("Crie uma conta poupança Reserva com saldo inicial de 300 reais.", "accounts"),
        ("Cadastre uma pasta Trabalho para minhas notas.", "folders"),
        (
            "Cadastre o financiamento Carro. Principal original 60000 reais, saldo devedor 50000 reais, juros 1 por cento ao mês, 48 parcelas no total e 8 pagas.",
            "debts",
        ),
        (
            "Pague a prestação do financiamento Carro de 1470 reais pela conta Reserva hoje.",
            "debts",
        ),
    ]
    for text, expected in cases:
        state = {
            "text": text,
            "timezone": "America/Sao_Paulo",
            "workspace_id": "isolated",
            "user_id": "isolated",
            "phone": None,
            "source_message_id": "test:probe",
            "messages": [],
            "results": [],
        }
        print("routing", expected, flush=True)
        routed = await nodes.route(state)
        assert "cadastros" in routed["domains"], routed
        print("extracting", expected, flush=True)
        result = await nodes.resource_node({**state, **routed})
        assert result["resource_actions"], result["results"]
        action = ResourceAction.model_validate(result["resource_actions"][0])
        assert action.resource == expected, (expected, action.resource)
        print(expected, result["resource_prepared"][0]["summary"], flush=True)
    # Missing fields must stay incomplete, then a contextual answer can complete them.
    state = {**state, "text": "Crie um cartão Inter", "resource_draft": []}
    incomplete = await nodes.resource_node(state)
    assert not incomplete["resource_actions"] and incomplete["resource_draft"]
    filled = await nodes.resource_node(
        {
            **state,
            "text": "Fecha dia 8 e vence dia 15",
            "resource_draft": incomplete["resource_draft"],
        }
    )
    assert filled["resource_actions"], filled
    print("draft", filled["resource_prepared"][0]["summary"], flush=True)


if __name__ == "__main__":
    asyncio.run(main())
