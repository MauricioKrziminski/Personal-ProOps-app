"""Gera `app/graph/exemplos_vetores.json` a partir de `exemplos.json` (rodar ao mexer no banco).

Reaproveita os vetores que já estão no arquivo (mesma frase, mesmo modelo) e vetoriza só o resto,
em lotes abaixo das 100 requisições/min do nível gratuito (cada frase conta como uma).

    cd agent && PYTHONPATH=. .venv/bin/python scripts/vetorizar_exemplos.py
"""

from __future__ import annotations

import asyncio
import json

from app.graph import exemplos
from app.services import embeddings
from app.services.ia import modelo

LOTE = 80
PAUSA_S = 65


def gravar(frases: list[str], vetores: dict[str, list[float]]) -> None:
    exemplos.ARQUIVO_VETORES.write_text(json.dumps({
        "modelo": modelo("embedding"),
        "dimensoes": embeddings.DIMENSOES,
        "vetores": {f: exemplos.codificar(vetores[f]) for f in frases if f in vetores},
    }, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")


async def main() -> None:
    frases = [e["frase"] for e in exemplos.carregar()]
    vetores = {f: v for f, v in exemplos.vetores_gravados().items() if f in frases}
    faltam = [f for f in frases if f not in vetores]
    print(f"{len(frases)} frases; {len(vetores)} reaproveitadas; {len(faltam)} a vetorizar")
    for i in range(0, len(faltam), LOTE):
        if i:
            await asyncio.sleep(PAUSA_S)
        lote = faltam[i:i + LOTE]
        novos = await embeddings.embed_documentos(lote)
        if novos is None:
            raise SystemExit("embedding falhou (429?) — rode de novo; o que já foi feito não se perde")
        vetores.update(zip(lote, novos, strict=True))
        gravar(frases, vetores)  # a cada lote: um 429 no seguinte não perde este
        print(f"  {i + len(lote)}/{len(faltam)}")
    gravar(frases, vetores)
    print(f"gravado {exemplos.ARQUIVO_VETORES}")


if __name__ == "__main__":
    asyncio.run(main())
