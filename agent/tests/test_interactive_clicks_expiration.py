"""Testes da Etapa 3.6: Uniformização de Timezone e Validação de Cliques Interativos."""

import pytest
from app import worker, db
from app.domain import confirm

SESSAO = {
    "id": "44444444-4444-4444-4444-444444444444",
    "channel": "whatsapp",
    "phone": "5551999999999",
    "user_id": "11111111-1111-1111-1111-111111111111",
    "workspace_id": "22222222-2222-2222-2222-222222222222",
    "timezone": "America/Sao_Paulo",
    "thread_id": "t:1",
    "session_epoch": 1,
}


class TestInteractiveClicksExpiration:
    @pytest.mark.asyncio
    async def test_clique_qpage_nao_e_tratado_como_stale_mesmo_sem_pendencia(self, monkeypatch):
        """Clique 'Ver mais' (qpage:...) não é confirmação HITL nem rascunho: nunca pode dar 'expirou'."""
        async def mock_open_pending(phone):
            return None

        async def mock_open_draft(phone):
            return None

        monkeypatch.setattr(db, "open_pending", mock_open_pending)
        monkeypatch.setattr(db, "open_draft", mock_open_draft)
        monkeypatch.setattr(db, "expire_pending", lambda *_: None)
        monkeypatch.setattr(db, "expire_drafts", lambda *_: None)

        conteudo = {
            "clicked_id": "qpage:all:5",
            "text": "ver mais lançamentos anteriores",
            "media": None,
            "raw_texts": ["ver mais lançamentos anteriores"],
        }

        # Em confirm.decide:
        decisao = await confirm.decide(conteudo, None)
        assert decisao is None
        assert decisao is not confirm.STALE

    @pytest.mark.asyncio
    async def test_clique_pa_sem_pendencia_aberta_retorna_stale(self):
        """Clique 'pa:...' (HITL) sem pendência aberta deve retornar STALE."""
        conteudo = {
            "clicked_id": "pa:00000000-0000-0000-0000-000000000001:ok",
            "text": "Confirmar",
        }
        decisao = await confirm.decide(conteudo, None)
        assert decisao is confirm.STALE

    @pytest.mark.asyncio
    async def test_clique_ds_sem_rascunho_aberto_retorna_stale(self):
        """Clique 'ds:...' (Rascunho) sem rascunho aberto deve retornar STALE."""
        conteudo = {
            "clicked_id": "ds:00000000-0000-0000-0000-000000000001:c:c1",
            "text": "Nubank",
        }
        decisao = await confirm.decide(conteudo, None)
        assert decisao is confirm.STALE
