#!/usr/bin/env python3
"""Paridade com o app, contra o Gemini REAL: o que o dedo faz, a frase faz.

    de agent/: .venv/bin/python scripts/probe_app_parity.py

Três botões do app que o agente não alcançava (auditoria de 09/09/2026):
`useSetDefaultAccount`, `useRestoreNote` e `usePurgeNote`. Nenhum virou tipo de
ação novo — `is_default` e `trashed` são campos VIRTUAIS do catálogo, validados no
servidor, então o schema continua em 5×5 e não houve o que remedir.

O que só o modelo real responde é se a FRASE chega no campo certo: um dublê sempre
concorda. Sem banco, sem WhatsApp, sem escrita — as leituras são substituídas.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.graph import nodes
from app.graph.schemas import ResourceAction
from app.tools import resources

CONTA = {"id": "00000000-0000-0000-0000-000000000020", "row_version": "1",
         "name": "Nubank", "type": "checking", "archived": False}
NOTA = {"id": "00000000-0000-0000-0000-000000000030", "row_version": "1",
        "content": "lista de compras", "folder_id": None, "pinned": False,
        "deleted_at": "2026-09-01T00:00:00Z"}


async def _leituras(sql, *args, **kw):
    if "public.accounts" in sql:
        return [CONTA]
    if "public.notes" in sql:
        return [NOTA]
    return []


# frase -> (recurso, operação, campo esperado, valor esperado)
CASOS = [
    ("deixa o Nubank como minha conta padrão", "accounts", "resource_update", "is_default", True),
    ("o Nubank não é mais a conta padrão", "accounts", "resource_update", "is_default", False),
    ("tira a nota lista de compras da lixeira", "notes", "resource_update", "trashed", False),
    ("restaura a nota lista de compras", "notes", "resource_update", "trashed", False),
    ("apaga de vez a nota lista de compras que está na lixeira", "notes", "resource_delete", "trashed", True),
]


async def main() -> int:
    resources.db.fetch = _leituras
    falhas = 0
    for texto, recurso, operacao, campo, esperado in CASOS:
        state = {
            "text": texto, "timezone": "America/Sao_Paulo",
            "workspace_id": "isolated", "user_id": "isolated", "phone": None,
            "source_message_id": "probe", "messages": [], "results": [],
            "resource_draft": [],
        }
        routed = await nodes.route(state)
        r = await nodes.resource_node({**state, **routed})
        acoes = r.get("resource_actions") or []
        if not acoes:
            print(f"FALHOU {texto!r}: sem ação — {r.get('results')}")
            falhas += 1
            continue
        acao = ResourceAction.model_validate(acoes[0])
        campos = {f.name: f.value for f in acao.fields}
        ok = (acao.resource == recurso and acao.type.value == operacao
              and campos.get(campo) == ("true" if esperado else "false"))
        falhas += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FALHOU'} {texto!r:58} -> {acao.resource}/{acao.type.value} {campos}")
    print(f"\n{len(CASOS) - falhas}/{len(CASOS)}")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
