"""Toda mutação em `public.*` filtra por workspace_id — verificado mecanicamente.

O serviço conecta com um papel que IGNORA RLS. O que o banco garantia sozinho
virou responsabilidade do código, e "responsabilidade do código" sem teste é
responsabilidade de quem lembrar.

Dois casos reais que este teste pega, ambos encontrados em 31/08/2026:
`undo_last` fazia `delete ... where id = %s` e `mark_paid` fazia
`update ... where id = %s`. Os dois se sustentavam porque o id vinha de um select
escopado — ou seja, dependiam de quem chamava.
"""

import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parents[1] / "app" / "tools"

# `update public.x set ... where ...` / `delete from public.x where ...`
_MUTACAO = re.compile(
    r"((?:update|delete\s+from)\s+public\.\w+.*?)(?=\"\"\"|\";|',|\)\s*$)",
    re.IGNORECASE | re.DOTALL,
)


def test_toda_mutacao_filtra_por_workspace():
    faltando = []
    for arquivo in sorted(RAIZ.glob("*.py")):
        texto = arquivo.read_text()
        for trecho in _MUTACAO.findall(texto):
            achatado = " ".join(trecho.split())
            if "where" not in achatado.lower():
                continue
            if "workspace_id" in achatado:
                continue
            # RPC do banco resolve o escopo por dentro; aqui só olhamos SQL nosso
            faltando.append(f"{arquivo.name}: {achatado[:110]}")

    assert not faltando, (
        "mutação sem filtro de workspace_id (o papel do serviço IGNORA RLS):\n  "
        + "\n  ".join(faltando)
    )
