"""Rascunho: extração incompleta que espera o dado que falta.

"comprei um mac em 12x" tem intenção clara e não tem valor. Descartar obriga o
usuário a repetir a frase; travar a conversa na pergunta o impede de mudar de
assunto. O rascunho é o meio-termo: fica inerte, e volta quando ele responder.

A decisão de SE a mensagem responde ao rascunho é semântica (modelo). O QUE é o
número, quando responde, é parse determinístico — a mesma divisão de trabalho da
confirmação.
"""

import pytest

from app.domain import draft


class TestClassificacao:
    @pytest.mark.asyncio
    async def test_valor_solto_completa_o_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return "answer"

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("foi 5000", {"missing": "qual o valor?"})
        assert r == {"acao": "completar", "amount_cents": 500000}

    @pytest.mark.asyncio
    async def test_desistir_apaga_o_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return "discard"

        monkeypatch.setattr(draft, "_classificar", falso)
        r = await draft.interpretar("esquece o mac", {"missing": "qual o valor?"})
        assert r == {"acao": "descartar"}

    @pytest.mark.asyncio
    async def test_assunto_novo_nao_toca_no_rascunho(self, monkeypatch):
        async def falso(texto, pergunta):
            return "unrelated"

        monkeypatch.setattr(draft, "_classificar", falso)
        assert await draft.interpretar("anota: comprar café", {"missing": "x"}) is None

    @pytest.mark.asyncio
    async def test_respondeu_mas_sem_numero_nao_completa(self, monkeypatch):
        """O modelo achou que é resposta, mas não há valor extraível.

        Sem esta guarda, "foi caro" viraria um lançamento com valor None — que é
        exatamente o bug do "registrar None em 12x" voltando por outra porta.
        """
        async def falso(texto, pergunta):
            return "answer"

        monkeypatch.setattr(draft, "_classificar", falso)
        assert await draft.interpretar("foi caro", {"missing": "x"}) is None

    @pytest.mark.asyncio
    async def test_modelo_fora_do_ar_nao_mexe_no_rascunho(self, monkeypatch):
        async def explode(texto, pergunta):
            raise RuntimeError("429")

        monkeypatch.setattr(draft, "_classificar", explode)
        # falha fechada: sem classificação, o rascunho fica onde está
        assert await draft.interpretar("5000", {"missing": "x"}) is None


class TestMescla:
    def test_valor_entra_na_acao_guardada(self):
        guardado = {"type": "create_installment_purchase", "installments": 12,
                    "description": "mac", "amount_cents": None}
        assert draft.mesclar(guardado, 500000)["amount_cents"] == 500000

    def test_nao_sobrescreve_o_que_ja_existia(self):
        guardado = {"type": "create_expense", "amount_cents": 100, "description": "x"}
        assert draft.mesclar(guardado, 999)["amount_cents"] == 100


class TestLembrete:
    def test_frase_cita_o_rascunho_sem_gastar_modelo(self):
        frase = draft.lembrete({"raw_text": "comprei um mac em 12x"})
        assert "mac em 12x" in frase
        assert "rascunho" in frase.lower()


class TestTrocaDeContexto:
    """A nota é salva e o rascunho continua lá, mencionado de leve.

    É o contrato que o usuário pediu: liberdade de mudar de assunto no meio de
    um lançamento incompleto, sem que o sistema perca o contexto anterior nem
    trave a conversa esperando o dado que falta.
    """

    def test_lembrete_entra_depois_da_confirmacao_da_nota(self):
        resposta = "📝 Nota salva!"
        rascunho = {"raw_text": "comprei um mac em 12x"}
        final = f"{resposta}\n\n{draft.lembrete(rascunho)}".strip()

        assert final.startswith("📝 Nota salva!")
        assert "mac em 12x" in final

    def test_texto_longo_e_truncado_sem_virar_ambiguo(self):
        # o que precisa ser limitado é o TRECHO do usuário (a moldura é fixa):
        # sem corte, uma mensagem longa empurraria a frase inteira para fora da
        # tela e o lembrete deixaria de ser discreto
        longo = {"raw_text": "comprei um macbook pro de 16 polegadas " * 3}
        frase = draft.lembrete(longo)
        trecho = frase.split("*")[1]

        assert len(trecho) <= 60
        assert trecho.endswith("…")
        assert frase.endswith(")")
