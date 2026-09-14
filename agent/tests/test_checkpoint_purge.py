"""O expurgo dos checkpoints: o que ele apaga, e o que ele NUNCA pode apagar.

O SQL é a regra inteira aqui, então o que este arquivo prende são as três decisões que estão
dentro dele — e cada uma tem um modo de falha que só aparece meses depois:

1. **Thread vivo não entra na lista.** A conta é a mesma de `security.effective_thread_id`; se
   o SQL divergir dela, o expurgo apaga a conversa que o usuário está tendo agora.
2. **Pendente de HITL segura o thread.** Apagar o checkpoint de um `interrupt()` em aberto faz o
   "sim" do usuário cair no vazio, sem erro nenhum.
3. **As três tabelas saem juntas, pelo thread.** `checkpoint_blobs` é chaveada por canal e
   versão, não por checkpoint: qualquer expurgo mais fino deixa blob órfão.
"""

from __future__ import annotations

import pytest

from app import db
from app.jobs import checkpoints
from app.security import effective_thread_id


@pytest.mark.asyncio
async def test_nao_apaga_nada_quando_nao_ha_thread_morto(monkeypatch):
    async def fetch(sql, *args):
        return []

    apagou: list[str] = []

    async def execute(sql, *args):
        apagou.append(sql)
        return 0

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "execute", execute)

    assert await checkpoints.run() == {"threads": 0, "checkpoints": 0, "writes": 0, "blobs": 0}
    assert apagou == [], "sem thread morto, nenhum delete pode sair"


@pytest.mark.asyncio
async def test_apaga_as_tres_tabelas_pelo_mesmo_conjunto_de_threads(monkeypatch):
    mortos = ["551199:1", "app-abc"]

    async def fetch(sql, *args):
        assert args == (checkpoints.MAX_THREADS_POR_EXECUCAO,), "o teto tem que chegar no SQL"
        return [{"thread_id": t} for t in mortos]

    chamadas: list[tuple[str, tuple]] = []

    async def execute(sql, *args):
        chamadas.append((sql, args))
        return len(mortos)

    monkeypatch.setattr(db, "fetch", fetch)
    monkeypatch.setattr(db, "execute", execute)

    r = await checkpoints.run()
    assert r["threads"] == 2

    alvos = [sql.split("from ")[1].split(" ")[0] for sql, _ in chamadas]
    assert alvos == [
        "langgraph.checkpoint_writes",
        "langgraph.checkpoint_blobs",
        "langgraph.checkpoints",
    ], "as três tabelas, e a que referencia antes da referenciada"
    for _, args in chamadas:
        assert args == (mortos,), "o MESMO conjunto nas três — senão sobra órfão"


def test_o_sql_dos_vivos_reproduz_effective_thread_id():
    """A conta do SQL e a do Python têm que ser a mesma, e é fácil elas divergirem.

    `effective_thread_id` devolve o id cru quando o epoch é 0 e `id:epoch` daí em diante. O SQL
    faz isso com um `case`; se alguém mudar o separador em um dos dois lados, o expurgo passa a
    enxergar TODO thread vivo como morto — e apaga a conversa de todo mundo numa execução só.
    """
    assert effective_thread_id("abc", 0) == "abc"
    assert effective_thread_id("abc", 3) == "abc:3"
    assert "coalesce(s.session_epoch, 0) = 0 then s.thread_id" in checkpoints._VIVOS
    assert "s.thread_id || ':' || s.session_epoch" in checkpoints._VIVOS


def test_pendente_de_hitl_esta_na_clausula():
    """A trava mora no SQL, não na confiança de que "nunca vai acontecer"."""
    assert "public.pending_actions" in checkpoints._MORTOS
    assert "p.status = 'pending'" in checkpoints._MORTOS
    assert "not exists" in checkpoints._MORTOS
