"""Exporta os dados de UMA pessoa (pedido de titular por e-mail, para quem não tem o app).

    DATABASE_URL=... agent/.venv/bin/python agent/scripts/exportar_dados.py <user_id> > dados.json

Usa a MESMA função do `GET /internal/export` (`app/services/exportar_dados.py`). Confira a identidade
de quem pediu ANTES de enviar o arquivo. O painel não exporta dado financeiro; este script é o caminho.
"""
import asyncio, json, os, sys
from uuid import UUID

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db
from app.services.exportar_dados import exportar


async def main(user_id: UUID) -> None:
    await db.open_pools()
    try:
        print(json.dumps(await exportar(user_id), ensure_ascii=False, indent=2, default=str))
    finally:
        await db.close_pools()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("uso: exportar_dados.py <user_id>")
    asyncio.run(main(UUID(sys.argv[1])))
