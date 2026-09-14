"""Expurgo dos checkpoints do LangGraph (pega carona no cron diário).

## Por que existe

Medido no staging em 14/09/2026, com duas semanas de tráfego de teste:

| tabela | tamanho |
|---|---|
| `langgraph.checkpoint_writes` | 8,5 MB |
| `langgraph.checkpoints` | 6,2 MB |
| `langgraph.checkpoint_blobs` | 3,6 MB |
| **as três** | **18 MB de um banco de 35 MB** |

Metade do banco, sem um único usuário real. O Supabase da camada gratuita tem **500 MB**, e
`docs/PROXIMAS-FASES.md` já apontava o suspeito antes de qualquer medição: *"os checkpoints são o
que estoura primeiro; veja se há política de expurgo"*. Não havia nenhuma — nada nunca apagou uma
linha dessas três tabelas.

## O que é seguro apagar, e por quê

O id que vai no config do LangGraph é o **efetivo** (`security.effective_thread_id`):
`thread_id` quando o epoch é 0, `thread_id:epoch` daí em diante. Subir o epoch é o produto
dizendo *"esta conversa acabou"* — inatividade, ou o usuário apagando a conversa no app.

Daí a regra, que não precisa de data nenhuma: **sobrevive o thread que é a época ATUAL de alguma
sessão viva; todo o resto é conversa que o produto já esqueceu.** Medido no staging: 11 threads
vivos contra 231 mortos.

⚠️ **A trava é `pending_actions`.** Um HITL em aberto guarda o thread EFETIVO para o
`Command(resume=...)`; apagar o checkpoint dele faria o "sim" do usuário cair no vazio — o mesmo
modo de falha que `agent.md` descreve para thread_id recalculado. Nenhum pendente pode estar num
thread morto (no staging: zero), mas a condição fica no SQL, não na confiança.

⚠️ **Teto por execução.** Uma conta antiga pode ter dezenas de milhares de threads mortos, e um
`delete` sem limite segura lock nas três tabelas enquanto o worker responde ao WhatsApp. Com o
teto, a sobra vai na execução de amanhã — este job não tem pressa.

⚠️ **As três tabelas saem JUNTAS, pelo thread.** `checkpoint_blobs` é chaveada por
(thread, ns, channel, version) e não por checkpoint: apagar checkpoint a checkpoint deixaria blob
órfão sem jeito barato de descobrir. Por thread inteiro, a consistência é por construção.
"""

from __future__ import annotations

import logging

from app import db

log = logging.getLogger(__name__)

# Quantos threads mortos por execução. Diário: 500/dia dá conta de qualquer acúmulo real.
MAX_THREADS_POR_EXECUCAO = 500

# O id efetivo de cada sessão viva — a mesma conta de `security.effective_thread_id`, em SQL.
_VIVOS = """
    select case
             when coalesce(s.session_epoch, 0) = 0 then s.thread_id
             else s.thread_id || ':' || s.session_epoch
           end
    from public.user_sessions s
"""

_MORTOS = f"""
    select distinct k.thread_id
    from langgraph.checkpoints k
    where k.thread_id not in ({_VIVOS})
      and not exists (
        select 1 from public.pending_actions p
        where p.thread_id = k.thread_id and p.status = 'pending'
      )
    limit %s
"""


async def run() -> dict:
    """Apaga os checkpoints de threads que o produto já esqueceu. Idempotente."""
    mortos = await db.fetch(_MORTOS, MAX_THREADS_POR_EXECUCAO)
    ids = [linha["thread_id"] for linha in mortos]
    if not ids:
        return {"threads": 0, "checkpoints": 0, "writes": 0, "blobs": 0}

    # A ordem é a das dependências lógicas: primeiro o que referencia, depois o referenciado.
    writes = await db.execute(
        "delete from langgraph.checkpoint_writes where thread_id = any(%s)", ids
    )
    blobs = await db.execute(
        "delete from langgraph.checkpoint_blobs where thread_id = any(%s)", ids
    )
    checkpoints = await db.execute(
        "delete from langgraph.checkpoints where thread_id = any(%s)", ids
    )

    log.info(
        "expurgo de checkpoints: %s threads, %s checkpoints, %s writes, %s blobs",
        len(ids),
        checkpoints,
        writes,
        blobs,
    )
    return {
        "threads": len(ids),
        "checkpoints": checkpoints,
        "writes": writes,
        "blobs": blobs,
    }
