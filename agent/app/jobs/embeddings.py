"""Mantém os vetores da busca semântica de lançamento (pega carona no cron de 1 minuto).

Embeda o lançamento que não tem vetor, cujo texto mudou (`content_hash`) ou cujo vetor é de outro
modelo — o que o agente acabou de gravar, o que o APP gravou por supabase-js e o que já existia.

**Por que no cron de MINUTO e não no de hora em hora:** o de hora em hora (`finance-scheduler`)
não roda no staging, e feature que só funciona em produção não se testa. Custo: um SELECT barato
por minuto; o Gemini só é chamado quando há linha pendente, e cada rodada tem teto (`LOTE`), então
o backlog inicial escorre em vez de estourar a cota.

**Falha do embedding NÃO é erro**: 429 do nível gratuito é esperado. Depois de uma falha o job
descansa `DESCANSO_S` — sem isso a mesma rodada bateria na cota a cada minuto.
"""

from __future__ import annotations

import time

from app import db
from app.services import embeddings
from app.services.gemini import modelo

# Lançamentos por rodada. Uma chamada de embedding em lote cobre todos; 50 por minuto zera um
# backlog de milhares em algumas horas e fica longe do teto de pedidos do nível gratuito.
LOTE = 50
DESCANSO_S = 300

_descansa_ate = 0.0


async def run() -> dict:
    global _descansa_ate
    if time.monotonic() < _descansa_ate:
        return {"embedded": 0, "descansando": True}
    nome = modelo("embedding")
    pendentes = await db.transacoes_sem_vetor(nome, LOTE)
    if not pendentes:
        return {"embedded": 0}
    vetores = await embeddings.embed_documentos([p["texto"] for p in pendentes])
    if vetores is None:
        _descansa_ate = time.monotonic() + DESCANSO_S
        return {"embedded": 0, "falhou": True}
    gravados = await db.gravar_vetores(
        [
            {"transaction_id": p["transaction_id"], "workspace_id": p["workspace_id"],
             "hash": p["hash"], "vetor": embeddings.literal(v)}
            for p, v in zip(pendentes, vetores, strict=True)
        ],
        nome,
    )
    return {"embedded": gravados}
