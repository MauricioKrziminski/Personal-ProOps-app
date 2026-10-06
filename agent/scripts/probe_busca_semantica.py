"""Sonda do Gemini REAL para calibrar a busca semântica de lançamento.

    cd agent && .venv/bin/python scripts/probe_busca_semantica.py

Faz 14 chamadas de embedding (1 lote de documentos, 12 consultas, 1 de inspeção) e NENHUMA ao banco.
Imprime a matriz de cosseno consulta x documento e o que o SDK expõe de uso (para ligar o custo
em `services/embeddings._registrar`). Com a saída, ajuste `SIMILARIDADE_MINIMA` e `FOLGA_MINIMA`
em `app/tools/resolve.py`: o limiar tem que ficar ACIMA de todos os pares "diferente" e abaixo
dos "mesmo", e a folga deve separar o vencedor do segundo nos casos "mesmo".
"""

from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import embeddings as emb  # noqa: E402

# o texto do documento é o que `private.texto_de_busca` monta: descrição · estabelecimento · categoria
DOCUMENTOS = [
    "Restaurante Fulano · alimentação",
    "Pizzaria Bella Napoli · alimentação",
    "Posto Shell · Gasolina · transporte",
    "Uber · transporte",
    "Netflix · assinaturas",
    "Farmácia Pague Menos · saúde",
    "Mercado Extra · supermercado",
    "Salário · salário",
    "Aluguel · moradia",
    "Academia Smart Fit · saúde",
    "ZZ conta de gás · contas",
    "Manutenção dentista · saúde",
]

# (consulta, índice do documento esperado ou None quando NÃO deve achar nada)
CONSULTAS = [
    ("almoço", 0),
    ("jantar", 1),
    ("gasolina", 2),
    ("corrida de app", 3),
    ("streaming", 4),
    ("remédio", 5),
    ("compras do mês", 6),
    ("dentista", 11),
    ("aluguel", 8),
    ("presente de aniversário", None),
    ("viagem para a praia", None),
    ("nuuvem", None),
]


def cosseno(a: list[float], b: list[float]) -> float:
    return math.fsum(x * y for x, y in zip(a, b, strict=True))  # já normalizados


async def main() -> None:
    print(f"{2 + len(CONSULTAS)} chamadas de embedding (1 lote de documentos, {len(CONSULTAS)} consultas, 1 de inspeção)")
    docs = await emb.embed_documentos(DOCUMENTOS)
    if docs is None:
        raise SystemExit("embedding dos documentos falhou (429? chave?) — veja o log acima")
    consultas = []
    for texto, _ in CONSULTAS:
        v = await emb.embed_consulta(texto)  # 1 chamada por consulta (a produção faz assim)
        if v is None:
            raise SystemExit(f"embedding da consulta {texto!r} falhou")
        consultas.append(v)

    print(f"\nmodelo: {emb.modelo('embedding')}  dimensões: {emb.DIMENSOES}\n")
    acertos, erros = [], []
    for (texto, esperado), v in zip(CONSULTAS, consultas, strict=True):
        notas = sorted(((cosseno(v, d), i) for i, d in enumerate(docs)), reverse=True)
        (s1, i1), (s2, _i2) = notas[0], notas[1]
        print(f"{texto!r:32} top: {s1:.3f} {DOCUMENTOS[i1]!r:42} folga p/ 2º: {s1 - s2:.3f}")
        (acertos if esperado is not None else erros).append((s1, s1 - s2, i1 == esperado))

    if acertos:
        print(f"\n'mesmo'    : topo entre {min(a[0] for a in acertos):.3f} e {max(a[0] for a in acertos):.3f}; "
              f"folga mínima {min(a[1] for a in acertos):.3f}; acertou {sum(a[2] for a in acertos)}/{len(acertos)}")
    if erros:
        print(f"'ninguém'  : topo chega a {max(e[0] for e in erros):.3f}  <- o limiar tem que ficar ACIMA disto")

    # o que o SDK devolve de uso, para ligar o custo (tokens) no futuro
    try:
        bruto = await emb._embeddings().aembed_query("almoço", task_type="RETRIEVAL_QUERY")
        print(f"\nretorno do SDK: {type(bruto).__name__} com {len(bruto)} floats — sem metadados de uso "
              "(o langchain devolve só os valores). Tokens, se quiser medir: client.models.count_tokens.")
    except Exception as erro:  # noqa: BLE001
        print(f"\nnão deu para inspecionar o retorno do SDK: {erro}")


if __name__ == "__main__":
    asyncio.run(main())
