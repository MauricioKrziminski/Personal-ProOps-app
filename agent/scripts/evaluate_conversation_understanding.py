"""Reproducible real-Gemini evaluation, fictional Portuguese, no DB/outbound.

Run in agent/: .venv/bin/python scripts/evaluate_conversation_understanding.py
--output /tmp/conversation-eval.json records observations. --cases id,id selects cases.
Network is Gemini only. SQL mutations are prohibited; reads use explicit fixtures.

## Verde é 22/22 — e como os quatro últimos foram fechados (09/09/2026)

A suíte passou o dia em 18/22. Diagnosticar os quatro custou mais do que consertá-los, e o
padrão vale para o próximo que aparecer: **três dos quatro não eram defeito do agente.**

| caso | o que era de verdade |
|---|---|
| `financing_complete` | o TESTE envelheceu: `due_day` virou obrigatório no mesmo dia (sem ele o cronograma ancora em HOJE e a data da parcela anda um dia por dia). O agente PEDIA o dia que faltava, que é o certo, e o caso contava isso como falha. A mensagem passou a dizer "vence dia 10". |
| `ambiguous_previous` | media a CAMADA ERRADA: olhava o `installment_scope` cru do modelo, que chuta `all` em ~1 de 3 execuções. Quem decide o escopo de uma baixa é `scope_from_text`, que roda por cima e força `unclear` ao ver "anteriores" sem número. O caso passou a checar o escopo FINAL, que é o que o produto usa. |
| `account_followup` | instabilidade real do modelo com valor por extenso ("trezentos reais"): ~1 falha em 3. O catálogo passou a ensinar que valor por extenso é valor — **mas isso NÃO foi medido depois**, e a evidência que existe ainda é ~2/3. Se reaparecer, meça antes de assumir que a linha do catálogo resolveu. |
| `financing_missing_contract` | instabilidade de roteamento, ~1 em 3. |

⚠️ **Uma linha de prompt "óbvia" piorou tudo, e só a medição mostrou.** Para estabilizar o
roteamento foi adicionada ao ROUTER uma explicação separando "TENHO um financiamento" (contrato
que existe → cadastros) de "COMPREI em 12x" (compra nova → financas). O raciocínio estava certo e
o efeito foi o contrário: `financing_missing_contract` caiu de 2/3 para **0/3** e
`financing_complete`, que roteava certo, passou a rotear errado também. Revertida a linha, os dois
voltaram a 3/3.

**Regra que sai daí: mexeu em prompt, meça ANTES e DEPOIS, três execuções de cada.** Uma passada
não distingue conserto de sorte, e neste modelo a intuição sobre "explicar melhor" erra o sinal.

Se você rodar e der menos de 22, compare com três execuções do commit anterior antes de caçar
bug: metade do que parece regressão é o Lite chutando diferente.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domain import confirm, draft
from app.graph import nodes
from app.graph.schemas import FinanceAction

from app import db

WS = "20000000-0000-0000-0000-000000000001"
ACCOUNT = "10000000-0000-0000-0000-000000000001"
BASE = {
    "timezone": "America/Sao_Paulo",
    "workspace_id": WS,
    "user_id": WS,
    "phone": None,
    "source_message_id": "fictional:evaluation",
    "results": [],
}


def state(text, history=(), **extra):
    return {
        **BASE,
        "text": text,
        "messages": [*history, {"role": "user", "content": text}],
        **extra,
    }


async def reads(sql, *args, **kwargs):
    if "public.installment_plans" in sql:
        return [
            {
                "id": "30000000-0000-0000-0000-000000000001",
                "description": "carro",
                "installments": 48,
                "total_cents": 7056000,
                "first_occurred_at": "2026-01-08",
            }
        ]
    if "public.accounts" in sql:
        return [
            {"id": ACCOUNT, "name": "Reserva", "type": "savings", "archived": False}
        ]
    return []


async def prohibited(*args, **kwargs):
    raise AssertionError("Unexpected real persistence/outbound call in evaluation")


async def financial(text, history=()):
    initial = state(text, history)
    routed = await nodes.route(initial)
    if routed["domains"] != ["financas"]:
        return {"domains": routed["domains"], "actions": []}
    result = await nodes.finance_node(initial)
    return {
        "domains": routed["domains"],
        "actions": result["finance_actions"],
        "halted": result.get("halted", False),
    }


async def resource(text, resource_draft=None):
    initial = state(text, resource_draft=resource_draft or [])
    routed = await nodes.route(initial)
    if routed["domains"] != ["cadastros"]:
        return {
            "domains": routed["domains"],
            "resource_actions": [],
            "resource_prepared": [],
            "resource_draft": [],
        }
    result = await nodes.resource_node(initial)
    return {"domains": routed["domains"], **result}


async def resource_followup(first, answer):
    initial = await resource(first)
    assert initial["resource_draft"], initial
    return await resource(answer, initial["resource_draft"])


def action(result):
    return result["actions"][0]


def fields(result):
    return result["resource_prepared"][0]["values"]


def scope(result):
    return action(result).get("installment_scope") or {}


def escopo_final(result, texto):
    """O escopo que o PRODUTO usa, não o palpite cru do modelo.

    `scope_from_text` é a rede determinística que roda por cima da saída do modelo antes de
    qualquer baixa (`app/tools/resolve.py`). Ela existe justamente porque o Lite chuta `all` em
    frases sem limite; medir o modelo sem ela é medir uma camada que ninguém consome.
    """
    from app.domain.installment_scope import scope_from_text
    from app.graph.schemas import InstallmentScope

    cru = action(result).get("installment_scope")
    parsed = InstallmentScope(**cru) if cru else None
    final = scope_from_text(texto, parsed)
    return final.mode if final else None


def eq(actual, expected):
    assert actual == expected, (actual, expected)


async def paid_history(text):
    stored = {
        "type": "create_installment_purchase",
        "description": "carro",
        "amount_cents": 7056000,
        "installments": 48,
        "current_installment": 9,
        "account": "Nubank",
    }
    answer = await draft.interpretar(
        text,
        {
            "slot": "already_paid_count",
            "missing": "Quantas parcelas anteriores já foram pagas?",
            "action": stored,
        },
    )
    return draft.mesclar(stored, answer) if answer else None


PENDING = {
    "id": "fictional-pending",
    "summary": "Esta compra de R$70.560 ultrapassa seu limite Nubank. Deseja registrar mesmo assim ou trocar de cartão?",
    "action": {
        "kind": "soft_warning",
        "candidates": [
            {"id": "confirm", "label": "Confirmar mesmo assim"},
            {"id": "change_card", "label": "Trocar de Cartão"},
        ],
    },
}


async def pending(text):
    return await confirm.decide({"text": text}, PENDING)


async def revise_scope():
    return await confirm.decide(
        {"text": "Não, só as 8 anteriores"},
        {
            "id": "fictional-scope",
            "summary": "Dar baixa em48parcelas do carro,R$70.560",
            "action": {
                "kind": "confirmation",
                "action_type": "mark_paid",
                "candidates": [],
            },
        },
    )


async def ambiguous_pronoun():
    from app.tools import resolve

    initial = await financial(
        "Marca essas como pagas",
        [
            {"role": "user", "content": "Quais contas estão pendentes?"},
            {
                "role": "assistant",
                "content": "Há luz de R$120 e internet de R$90. Qual delas você quer pagar?",
            },
        ],
    )
    rows = [
        {
            "id": "10000000-0000-0000-0000-000000000010",
            "kind": "expense",
            "description": "luz",
            "category": "casa",
            "amount_cents": 12000,
            "occurred_at": "2026-09-08",
        },
        {
            "id": "10000000-0000-0000-0000-000000000011",
            "kind": "expense",
            "description": "internet",
            "category": "casa",
            "amount_cents": 9000,
            "occurred_at": "2026-09-08",
        },
    ]

    # A second same-description bill makes the database target genuinely ambiguous.
    # The reference "essas" alone is valid for both explicitly listed bills.
    rows.append(
        {
            **rows[0],
            "id": "10000000-0000-0000-0000-000000000012",
            "occurred_at": "2026-08-08",
        }
    )

    async def list_reads(sql, *args):
        if "installment_plans" in sql:
            return []
        term = (
            (args[1] if len(args) > 1 and isinstance(args[1], str) else "")
            .strip("%")
            .lower()
        )
        return [r for r in rows if not term or term in r["description"]]

    with patch.object(db, "fetch", side_effect=list_reads):
        targets = await resolve.for_actions(
            WS,
            [FinanceAction.model_validate(a) for a in initial["actions"]],
            "Marca essas como pagas",
        )
    return {**initial, "targets": targets}


CASES = [
    (
        "card_complete",
        lambda: resource(
            "Crie o cartão Inter, fecha dia 8, vence dia 15, limite de 5000 reais"
        ),
        lambda r: (
            eq(r["domains"], ["cadastros"]),
            eq(fields(r)["closing_day"], 8),
            eq(fields(r)["due_day"], 15),
        ),
    ),
    (
        "account_complete",
        lambda: resource(
            "Crie uma conta poupança Reserva com saldo inicial de 300 reais"
        ),
        lambda r: (
            eq(r["domains"], ["cadastros"]),
            eq(fields(r)["initial_balance_cents"], 30000),
            eq(fields(r)["type"], "savings"),
        ),
    ),
    (
        # `due_day` virou obrigatório em 09/09/2026 (sem ele o cronograma ancora no dia de HOJE
        # e a data da próxima parcela anda um dia por dia). A mensagem passou a dizer o dia; sem
        # isso o caso media o agente PEDINDO o que falta — que é o certo — e contava como falha.
        "financing_complete",
        lambda: resource(
            "Cadastre financiamento Carro, principal 60000 reais, saldo devedor 50000 reais, juros 1 por cento ao mês, 48 parcelas, oito já pagas, vence dia 10"
        ),
        lambda r: (
            eq(r["domains"], ["cadastros"]),
            eq(fields(r)["installments_paid"], 8),
            eq(fields(r)["remaining_cents"], 5000000),
            eq(fields(r)["due_day"], 10),
        ),
    ),
    (
        "card_followup",
        lambda: resource_followup("Crie um cartão Inter", "Fecha dia 8 e vence dia 15"),
        lambda r: (
            eq(r["domains"], ["cadastros"]),
            eq(fields(r)["name"], "Inter"),
            eq(fields(r)["closing_day"], 8),
        ),
    ),
    (
        "account_followup",
        lambda: resource_followup(
            "Crie uma conta Reserva", "É poupança, começa com trezentos reais"
        ),
        lambda r: (
            eq(fields(r)["name"], "Reserva"),
            eq(fields(r)["initial_balance_cents"], 30000),
        ),
    ),
    (
        "financing_missing_contract",
        lambda: resource(
            "Tenho um financiamento do carro em 48x de1470, estou na nona"
        ),
        lambda r: (
            eq(r["domains"], ["cadastros"]),
            eq(r["resource_actions"], []),
            eq(r["resource_draft"][0]["resource"], "debts"),
        ),
    ),
    (
        "card_purchase",
        lambda: financial("Comprei uma TV em 10x de 300 no cartão Inter"),
        lambda r: (
            eq(r["domains"], ["financas"]),
            eq(action(r)["type"], "create_installment_purchase"),
            eq(action(r)["amount_cents"], 300000),
            eq(action(r)["account"], "Inter"),
        ),
    ),
    (
        "first_eight",
        lambda: financial("Todas as 8 anteriores do carro, marque como pagas"),
        lambda r: (eq(scope(r).get("mode"), "first"), eq(scope(r).get("count"), 8)),
    ),
    (
        "only_third",
        lambda: financial("Só a terceira parcela do carro foi paga"),
        lambda r: (
            eq(scope(r).get("mode"), "range"),
            eq(scope(r).get("start"), 3),
            eq(scope(r).get("end"), 3),
        ),
    ),
    (
        "last_two",
        lambda: financial("Marque as duas últimas parcelas do carro como pagas"),
        lambda r: (eq(scope(r).get("mode"), "last"), eq(scope(r).get("count"), 2)),
    ),
    (
        # ⚠️ Este caso media a CAMADA ERRADA. Ele olhava o `installment_scope` cru do modelo, que
        # devolve `all` em ~1 de 3 execuções — e concluía "defeito". Mas quem decide o escopo de
        # uma baixa não é o modelo: `scope_from_text` roda por cima dele e, vendo "anteriores"
        # sem número, força `unclear`. É a exceção sancionada da regra de padrões (rede de
        # segurança POR CIMA do modelo num caminho destrutivo, igual a dinheiro).
        #
        # Medir o palpite cru transformava um sistema correto em alarme falso recorrente. O que
        # o produto promete é o escopo FINAL, e é ele que este caso passou a checar.
        "ambiguous_previous",
        lambda: financial("Marque as anteriores do carro como pagas"),
        lambda r: eq(escopo_final(r, "Marque as anteriores do carro como pagas"), "unclear"),
    ),
    (
        "context_eight",
        lambda: financial(
            "Então marque as oito anteriores como pagas",
            [
                {
                    "role": "user",
                    "content": "Cadastrei o carro em 48x de1470 no Nubank",
                },
                {"role": "assistant", "content": "O plano do carro tem 48 parcelas."},
            ],
        ),
        lambda r: (
            eq(action(r).get("description"), "carro"),
            eq(scope(r).get("count"), 8),
        ),
    ),
    (
        "history_zero",
        lambda: paid_history("Nenhuma, estão todas em aberto"),
        lambda r: (eq(r["already_paid_count"], 0), eq(r["current_installment"], 9)),
    ),
    (
        "history_eight",
        lambda: paid_history("Já quitei as primeiras oito"),
        lambda r: (eq(r["already_paid_count"], 8), eq(r["current_installment"], 9)),
    ),
    (
        "pending_yes",
        lambda: pending("Pode registrar mesmo assim"),
        lambda r: eq(r, {"approved": True}),
    ),
    (
        "pending_cancel",
        lambda: pending("Melhor não, cancela essa compra"),
        lambda r: eq(r, {"approved": False}),
    ),
    (
        "pending_condition",
        lambda: pending("Sim, mas muda para 24 parcelas"),
        lambda r: eq((r or {}).get("keep_pending"), True),
    ),
    (
        "pending_change_card",
        lambda: pending("Quero usar outro cartão"),
        lambda r: eq((r or {}).get("candidate_id"), "change_card"),
    ),
    (
        "pending_change_named_card",
        lambda: pending("Usa o cartão Inter em vez do Nubank"),
        lambda r: eq((r or {}).get("candidate_id"), "change_card"),
    ),
    (
        "pending_change_short",
        lambda: pending("Troca para o Inter"),
        lambda r: (
            eq((r or {}).get("candidate_id"), "change_card"),
            eq((r or {}).get("new_account"), "Inter"),
        ),
    ),
    (
        "pending_revise_eight",
        revise_scope,
        lambda r: (
            eq((r or {}).get("approved"), False),
            eq((r or {}).get("revision_scope", {}).get("count"), 8),
        ),
    ),
    (
        "ambiguous_pronoun",
        ambiguous_pronoun,
        lambda r: eq(
            any(
                t.get("status") == "ambiguous" or t.get("correction_error")
                for t in r["targets"]
            ),
            True,
        ),
    ),
]


async def main(args):
    results = []
    selected = set(args.cases.split(",")) if args.cases else None
    with (
        patch.object(db, "fetch", side_effect=reads),
        patch.object(db, "fetch_one", side_effect=prohibited),
        patch.object(db, "execute", side_effect=prohibited),
        patch.object(db, "open_pools", side_effect=prohibited),
    ):
        for name, run, check in CASES:
            if selected and name not in selected:
                continue
            observation = None
            try:
                observation = await run()
                check(observation)
                expected_resources = {
                    "card_complete": ("cards", "Inter"),
                    "account_complete": ("accounts", "Reserva"),
                    "financing_complete": ("debts", "Carro"),
                    "card_followup": ("cards", "Inter"),
                    "account_followup": ("accounts", "Reserva"),
                }
                if name in expected_resources:
                    expected_resource, expected_name = expected_resources[name]
                    extracted = observation["resource_actions"][0]
                    eq(extracted["type"], "resource_create")
                    eq(extracted["resource"], expected_resource)
                    eq(extracted["name"].casefold(), expected_name.casefold())
                result = {"id": name, "pass": True, "observation": observation}
            except Exception as error:  # noqa: BLE001 — evaluation records failures and continues
                result = {
                    "id": name,
                    "pass": False,
                    "error": str(error),
                    "observation": locals().get("observation"),
                }
            results.append(result)
            print(json.dumps(result, ensure_ascii=False, default=str), flush=True)
    summary = {
        "cases": len(results),
        "passed": sum(r["pass"] for r in results),
        "failed": [r["id"] for r in results if not r["pass"]],
        "results": results,
    }
    if args.output:
        Path(args.output).write_text(
            json.dumps(summary, ensure_ascii=False, indent=2, default=str)
        )
    print(
        json.dumps(
            {k: v for k, v in summary.items() if k != "results"}, ensure_ascii=False
        )
    )
    return 0 if not summary["failed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    parser.add_argument("--cases")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args)))
