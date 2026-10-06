"""Lote C da paridade: forma de pagamento (F01), classificação (F06) e detalhe (F09) ao CRIAR pelo
agente. Dublês no lugar do Gemini e do banco: o que se prova é a REGRA (null nunca vira Pix, crédito
exige cartão, receita não classifica, detalhe ambíguo pergunta, falha da leitura não bloqueia)."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest

from app.domain import atributos as dom
from app.graph import policy
from app.graph.schemas import AtributosItem, AtributosLote, FinanceAction
from app.tools import atributos, finance
from app.tools.base import ExecContext

WS = "ws-1"
NUBANK = {"id": uuid4(), "name": "Nubank", "type": "checking"}
CARTAO = {"id": uuid4(), "name": "Nubank Cartão", "type": "credit_card"}
CARTEIRA = {"id": uuid4(), "name": "Carteira", "type": "cash"}
FEIRA = {"id": uuid4(), "name": "feira"}
FEIRINHA = {"id": uuid4(), "name": "feirinha"}


def gasto(**kw):
    base = dict(type="create_expense", amount_cents=4500, description="mercado", category="mercado")
    return FinanceAction(**{**base, **kw})


@pytest.fixture
def banco(monkeypatch):
    estado = {"filhas": [FEIRA]}

    async def fetch(sql, *args):
        return estado["filhas"] if "from public.subcategories" in sql else []

    async def accounts(_ws, **_k):
        return [NUBANK, CARTAO, CARTEIRA]

    monkeypatch.setattr(atributos.db, "fetch", fetch)
    monkeypatch.setattr(atributos.db, "accounts", accounts)
    return estado


def leitura(monkeypatch, *itens, chamadas=None):
    async def _extrair(texto, linhas):
        if chamadas is not None:
            chamadas.append(linhas)
        return AtributosLote(itens=list(itens))

    monkeypatch.setattr(atributos, "_extrair", _extrair)


async def congela(texto, acao, alvo=None):
    alvos, n = await atributos.congelar(WS, texto, [acao], [alvo or {"default_account": {"id": str(NUBANK["id"])}}])
    return alvos[0], n


# --- paridade com src/lib/payment-method.ts (a mesma tabela do teste do app) -------------------

PARIDADE = [
    (None, "checking", None), (None, None, None),
    ("credit", "credit_card", None), ("credit", "checking", "cartão"), ("credit", None, "cartão"),
    ("debit", "checking", None), ("debit", "savings", None), ("debit", "cash", "conta"),
    ("debit", "credit_card", "conta"), ("debit", None, None),
    ("cash", "cash", None), ("cash", "checking", "dinheiro"), ("cash", None, None),
    ("pix", "checking", None), ("pix", "credit_card", None), ("pix", "cash", "bancária"), ("pix", None, None),
    ("boleto", "investment", None), ("bank_transfer", "cash", "bancária"), ("bank_transfer", "savings", None),
]


@pytest.mark.parametrize("metodo,tipo,erro", PARIDADE)
def test_forma_x_conta_espelha_o_app(metodo, tipo, erro):
    obtido = dom.erro_da_forma(metodo, tipo)
    assert (obtido is None) if erro is None else (erro in (obtido or "")), (metodo, tipo, obtido)


# --- F01: null nunca vira pix ------------------------------------------------------------------


@pytest.mark.parametrize("valor,texto,esperado", [
    ("pix", "gastei 45 no mercado", None),            # modelo inventou: a frase não diz pix
    ("pix", "gastei 45 no mercado no pix", "pix"),
    ("Pix", "paguei 45 via PIX", "pix"),
    ("credit", "gastei 45 no mercado", None),
    ("credito", "comprei 45 no crédito", "credit"),
    ("cartao de debito", "45 no débito", "debit"),
    ("not_informed", "45 no pix", None),
    ("dinheiro", "paguei 20 em dinheiro", "cash"),
    ("cartão", "gastei 45 no cartão", None),          # forma desconhecida
    (None, "45 no pix", None),
])
def test_forma_so_vale_se_a_frase_sustenta(valor, texto, esperado):
    assert dom.forma_proposta(valor, texto) == esperado


@pytest.mark.asyncio
async def test_sem_atributo_dito_nada_e_congelado(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    alvo, n = await congela("gastei 45 no mercado, gasto fixo", gasto())  # a frase não diz pix
    assert n == 1 and "atributos" not in alvo


@pytest.mark.asyncio
async def test_frase_sem_nenhuma_pista_nem_chama_o_modelo(banco, monkeypatch):
    chamadas: list = []
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"), chamadas=chamadas)
    alvo, n = await congela("gastei 45 no mercado", gasto())
    assert n == 0 and chamadas == [] and "atributos" not in alvo


@pytest.mark.asyncio
async def test_nome_de_detalhe_existente_na_frase_conta_como_pista(banco, monkeypatch):
    chamadas: list = []
    leitura(monkeypatch, chamadas=chamadas)
    _, n = await congela("gastei 45 na feira", gasto())
    assert n == 1 and len(chamadas) == 1


@pytest.mark.asyncio
async def test_banco_fora_do_ar_lanca_sem_atributos(banco, monkeypatch):
    async def quebra(*_a, **_k):
        raise ConnectionError("banco")

    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    monkeypatch.setattr(atributos.db, "accounts", quebra)
    alvos, n = await atributos.congelar(WS, "gastei 45 no pix", [gasto()], [{}])
    assert alvos == [{}] and n == 0


@pytest.mark.asyncio
async def test_pix_dito_vai_para_a_frase_do_sim(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix", expense_pattern="fixed",
                                       expense_necessity="essential"))
    alvo, _ = await congela("gastei 45 no mercado no pix, gasto fixo e essencial", gasto())
    assert alvo["atributos"]["frase"] == "no Pix · fixo · essencial"
    frase = policy.describe_for_confirmation(gasto(), alvo)
    assert frase.endswith(", no Pix · fixo · essencial")


@pytest.mark.asyncio
async def test_credito_sem_cartao_pergunta_e_nada_e_gravado(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="credit"))
    alvo, _ = await congela("gastei 45 no crédito", gasto())  # conta padrão é corrente
    assert "cartão" in alvo["correction_error"] and "atributos" not in alvo


@pytest.mark.asyncio
async def test_credito_com_cartao_citado_passa(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="credit"))
    alvo, _ = await congela("gastei 45 no crédito do nubank", gasto(account="Nubank Cartão"),
                            {"cited_account": {"name": "Nubank Cartão", "type": "credit_card"}})
    assert alvo["atributos"]["payment_method"] == "credit"


@pytest.mark.asyncio
async def test_forma_que_nao_combina_com_a_conta_fica_sem_forma_e_avisa(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="cash"))
    alvo, _ = await congela("paguei 20 em dinheiro", gasto())  # padrão = corrente
    assert alvo["atributos"]["payment_method"] is None
    assert "sem forma" in alvo["atributos"]["frase"] and "correction_error" not in alvo


# --- F06: só gasto classifica ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_receita_nunca_recebe_classificacao(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix", expense_pattern="fixed",
                                       expense_necessity="essential"))
    receita = FinanceAction(type="create_income", amount_cents=50000, description="freela")
    alvo, _ = await congela("recebi 500 de freela no pix, fixo e essencial", receita)
    assert alvo["atributos"]["expense_pattern"] is None and alvo["atributos"]["expense_necessity"] is None
    assert await atributos.colunas(WS, "income", None, alvo["atributos"]) == {"payment_method": "pix"}
    assert dom.colunas_de_classificacao("transfer", {"expense_pattern": "fixed"}, {}) == {}


def test_classificacao_dita_e_explicit_e_o_padrao_e_category_default():
    assert dom.colunas_de_classificacao(
        "expense", {"expense_pattern": "fixed"},
        {"default_expense_pattern": "variable", "default_expense_necessity": "essential"},
    ) == {"expense_pattern": "fixed", "expense_pattern_source": "explicit",
          "expense_necessity": "essential", "expense_necessity_source": "category_default"}
    assert dom.colunas_de_classificacao("expense", {}, None) == {}
    # nunca `explicit` com valor null, nem `category_default` sem valor
    assert dom.colunas_de_classificacao("expense", {"expense_pattern": None}, {"default_expense_pattern": None}) == {}


@pytest.mark.asyncio
async def test_colunas_leem_o_padrao_da_categoria_final(monkeypatch):
    async def fetch_one(sql, *args):
        assert "public.categories" in sql and args == (WS, "mercado")
        return {"default_expense_pattern": "variable", "default_expense_necessity": None}

    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    assert await atributos.colunas(WS, "expense", "mercado", {}) == {
        "expense_pattern": "variable", "expense_pattern_source": "category_default"}


@pytest.mark.parametrize("valor,texto,esperado", [
    ("fixed", "é um gasto fixo", "fixed"), ("fixed", "gastei 45 todo mês", None),
    ("variable", "gasto variável", "variable"),
])
def test_padrao_so_vale_com_a_palavra(valor, texto, esperado):
    assert dom.padrao_proposto(valor, texto) == esperado


# --- F09: detalhe pelo nome --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_detalhe_unico_vira_id_e_nome_na_frase(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="feira"))
    alvo, _ = await congela("gastei 45 no mercado, detalhe feira", gasto())
    a = alvo["atributos"]
    assert a["subcategory_id"] == str(FEIRA["id"]) and a["subcategory_parent"] == "mercado"
    assert a["frase"] == "detalhe feira"


@pytest.mark.asyncio
async def test_detalhe_ambiguo_pergunta_com_a_lista(banco, monkeypatch):
    banco["filhas"] = [FEIRA, FEIRINHA]
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="fei"))
    alvo, _ = await congela("gastei 45 no mercado, detalhe fei", gasto())
    assert "feira" in alvo["correction_error"] and "feirinha" in alvo["correction_error"]
    assert "Ainda não registrei nada" in alvo["correction_error"]


@pytest.mark.asyncio
async def test_detalhe_que_nao_existe_pergunta_e_nunca_cria(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="padaria"))
    alvo, _ = await congela("gastei 45 no mercado, detalhe padaria", gasto())
    assert "Não achei o detalhe" in alvo["correction_error"] and "feira" in alvo["correction_error"]


@pytest.mark.asyncio
async def test_detalhe_que_a_frase_nao_tem_e_ignorado(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="feira"))
    alvo, _ = await congela("gastei 45 no mercado", gasto())
    assert "atributos" not in alvo and "correction_error" not in alvo


def test_detalhe_so_vale_na_categoria_final():
    attrs = {"subcategory_id": "x", "subcategory_parent": "mercado"}
    assert atributos.detalhe_valido(attrs, "Mercado") == "x"
    assert atributos.detalhe_valido(attrs, "saúde") is None  # a regra do usuário trocou a categoria
    assert atributos.detalhe_valido(None, "mercado") is None


# --- a leitura falhar nunca bloqueia -----------------------------------------------------------


@pytest.mark.asyncio
async def test_leitura_que_falha_lanca_sem_atributos(banco, monkeypatch):
    async def quebra(*_a):
        raise TimeoutError("429")

    monkeypatch.setattr(atributos, "_extrair", quebra)
    alvos, n = await atributos.congelar(WS, "gastei 45 no pix", [gasto()], [{}])
    assert alvos == [{}] and n == 0


@pytest.mark.asyncio
async def test_so_criacao_de_lancamento_chama_o_modelo(banco, monkeypatch):
    chamadas: list = []
    leitura(monkeypatch, chamadas=chamadas)
    transf = FinanceAction(type="create_transfer", amount_cents=500, account="a", counterparty_account="b")
    pagar = FinanceAction(type="pay_invoice", amount_cents=500, account="nubank")
    alvos, n = await atributos.congelar(WS, "paguei a fatura no pix", [transf, pagar], [{}, {}])
    assert n == 0 and chamadas == []
    _, n = await congela("gastei 45 no mercado no pix", gasto())
    assert n == 1 and len(chamadas) == 1


@pytest.mark.asyncio
async def test_um_lote_uma_chamada(banco, monkeypatch):
    chamadas: list = []
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"), AtributosItem(indice=1),
            chamadas=chamadas)
    alvos, n = await atributos.congelar(
        WS, "gastei 45 no mercado no pix e 30 de uber", [gasto(), gasto(description="uber", category="transporte")],
        [{"default_account": {"id": str(NUBANK["id"])}}] * 2)
    assert n == 1 and len(chamadas) == 1 and len(chamadas[0]) == 2
    assert alvos[0]["atributos"]["payment_method"] == "pix" and "atributos" not in alvos[1]


# --- gravação ----------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_leva_forma_classificacao_e_detalhe(monkeypatch):
    escritas = []

    async def fetch_one(sql, *args):
        if "insert into public.transactions" in sql:
            escritas.append((sql, args))
            return {"id": uuid4()}
        return None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    detalhe = str(uuid4())
    ctx = ExecContext(uuid4(), uuid4(), None, "America/Sao_Paulo", "gasto", "app:1")
    ctx.target = {"atributos": {"payment_method": "pix", "expense_pattern": "fixed", "expense_necessity": None,
                                "subcategory_id": detalhe, "subcategory_parent": "mercado"}}
    await finance.create_transaction(ctx, gasto(account="sem conta", occurred_at="2026-10-03"))
    sql, args = escritas[0]
    assert "payment_method" in sql and "expense_pattern_source" in sql
    assert "subcategory_id, subcategory_snapshot_set" in sql and args[-1] == detalhe
    assert "pix" in args and "explicit" in args


@pytest.mark.asyncio
async def test_compra_parcelada_com_atributos_vai_por_create_purchase(monkeypatch):
    chamadas = []

    class Tx:
        async def fetch_one(self, sql, *args):
            chamadas.append((sql, args))
            return {"id": uuid4()}

    @asynccontextmanager
    async def como_usuario(_uid):
        yield Tx()

    async def conta_citada(*_a, **_k):
        return str(CARTAO["id"])

    async def ensure_owned(*_a, **_k):
        return None

    async def sem_banco(*_a, **_k):
        return None

    monkeypatch.setattr(finance.db, "como_usuario", como_usuario)
    monkeypatch.setattr(finance, "conta_citada", conta_citada)
    monkeypatch.setattr(finance, "ensure_owned", ensure_owned)
    monkeypatch.setattr(finance.db, "fetch_one", sem_banco)
    ctx = ExecContext(uuid4(), uuid4(), None, "America/Sao_Paulo", "tv em 3x", "app:1")
    ctx.target = {"atributos": {"payment_method": "credit", "expense_pattern": None, "expense_necessity": None,
                                "subcategory_id": None, "subcategory_parent": None}}
    acao = FinanceAction(type="create_installment_purchase", amount_cents=300000, installments=3,
                         description="tv", category="eletrônicos", account="Nubank Cartão",
                         already_paid_count=0, occurred_at="2026-10-05")
    await finance.create_installment_purchase(ctx, acao)
    sql, args = chamadas[0]
    assert "create_purchase('parcelada'" in sql
    dados = json.loads(args[0])
    assert dados["p_payment_method"] == "credit" and dados["p_installments"] == 3


def test_negacao_nao_inverte_a_necessidade():
    assert dom.necessidade_proposta("essential", "gastei 70 em roupa, não essencial") is None
    assert dom.necessidade_proposta("discretionary", "gastei 70 em roupa, não essencial") == "discretionary"
    assert dom.necessidade_proposta("essential", "aluguel, gasto essencial") == "essential"


def test_cartao_sozinho_nao_sustenta_credito():
    assert dom.forma_proposta("credit", "gastei 30 no cartão") is None
    assert dom.forma_proposta("credit", "gastei 30 no cartão de crédito") == "credit"


@pytest.mark.asyncio
async def test_detalhe_que_repete_a_categoria_nao_pergunta(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="mercado"))
    alvo, _ = await congela("gastei 80 no mercado Extra", gasto())
    assert "correction_error" not in alvo and "atributos" not in alvo


# --- revisão independente: vetos mais estritos --------------------------------------------------


@pytest.mark.parametrize("texto", [
    "gastei 70 em roupa, não essencial", "gastei 70 em roupa, pouco essencial",
    "isso nem é essencial", "gastei 70, não é um gasto essencial",
])
def test_essencial_negado_nunca_vira_essential_e_vira_discretionary(texto):
    assert dom.necessidade_proposta("essential", texto) is None
    assert dom.necessidade_proposta("discretionary", texto) == "discretionary"


def test_discretionary_nao_se_sustenta_so_com_a_palavra_essencial():
    assert dom.necessidade_proposta("discretionary", "aluguel, gasto essencial") is None
    assert dom.necessidade_proposta("discretionary", "gastei 45 com roupa") is None
    assert dom.necessidade_proposta("discretionary", "isso foi supérfluo") == "discretionary"


@pytest.mark.parametrize("texto,valor,esperado", [
    ("não é gasto fixo", "fixed", None), ("isso não é fixo, é variável", "fixed", None),
    ("isso não é fixo, é variável", "variable", "variable"),
    ("é um gasto fixo", "fixed", "fixed"),
    ("não é variável", "variable", None),
])
def test_negacao_vale_para_fixo_e_variavel(texto, valor, esperado):
    assert dom.padrao_proposto(valor, texto) == esperado


@pytest.mark.parametrize("valor,texto,esperado", [
    ("bank_transfer", "comprei doces por 12", None),
    ("bank_transfer", "paguei os documentos", None),
    ("bank_transfer", "paguei 15 por DOC", "bank_transfer"),
    ("pix", "comprei um pixel art por 20", None),
    ("pix", "paguei 20 no pix", "pix"),
    ("credit", "paguei no cred do nubank", "credit"),
    ("debit", "paguei a Débora 50", None),
    ("debit", "paguei no deb", "debit"),
    ("debit", "paguei no débito", "debit"),
    ("bank_transfer", "fiz uma transferência para pagar", "bank_transfer"),
])
def test_pista_curta_so_casa_palavra_inteira(valor, texto, esperado):
    assert dom.forma_proposta(valor, texto) == esperado


@pytest.mark.asyncio
async def test_pix_no_credito_exige_cartao_e_cria_rascunho_de_cartao(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    alvo, _ = await congela("gastei 200 no mercado com pix no crédito", gasto())  # padrão = corrente
    assert "cartão" in alvo["correction_error"] and alvo["account_error"] == alvo["correction_error"]
    assert alvo["so_cartoes"] is True


@pytest.mark.asyncio
async def test_pix_no_credito_com_cartao_citado_passa(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    alvo, _ = await congela("gastei 200 com pix no crédito do nubank", gasto(account="Nubank Cartão"),
                            {"cited_account": {"name": "Nubank Cartão", "type": "credit_card"}})
    assert alvo["atributos"]["payment_method"] == "pix"


@pytest.mark.asyncio
async def test_credito_sem_cartao_tambem_vira_rascunho_so_de_cartoes(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="credit"))
    alvo, _ = await congela("gastei 45 no crédito", gasto())
    assert alvo["account_error"] and alvo["so_cartoes"] is True


def test_rascunho_de_cartao_so_oferece_cartoes():
    from app.conversation import _so_cartoes
    assert _so_cartoes({"type": "create_expense", "so_cartoes": True}) is True
    assert _so_cartoes({"type": "create_expense"}) is False


@pytest.mark.asyncio
async def test_detalhe_ambiguo_pede_o_nome_exato(banco, monkeypatch):
    banco["filhas"] = [FEIRA, FEIRINHA]
    leitura(monkeypatch, AtributosItem(indice=0, detalhe="fei"))
    alvo, _ = await congela("gastei 45 no mercado, detalhe fei", gasto())
    assert "nome exato do detalhe" in alvo["correction_error"]


# --- grafo: resolve -> gate -> executar ------------------------------------------------------------


def _estado(acao, **extra):
    return {"thread_id": "t", "phone": "5551999999999", "user_id": str(uuid4()), "workspace_id": WS,
            "timezone": "America/Sao_Paulo", "source_message_id": "wamid.1", "text": "teste", "media": None,
            "results": [], "domains": ["financas"], "finance_actions": [acao.model_dump(mode="json")],
            "finance_queries": [], "notes_actions": [], "confidence": 1.0, "approved": False,
            "halted": False, **extra}


@pytest.mark.asyncio
async def test_resolve_node_conta_a_chamada_mas_nao_no_rascunho_completado(banco, monkeypatch):
    from app.graph import nodes

    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    acao = gasto(account="sem conta")
    texto = "gastei 45 no mercado no pix"
    normal = await nodes.resolve_node(_estado(acao, text=texto))
    assert normal["llm_calls"] == 1
    preset = await nodes.resolve_node(_estado(acao, text=texto, preset=True))
    assert "llm_calls" not in preset  # o clique `ds:` não conta a 2ª mensagem do plano
    assert preset["targets"][0]["atributos"]["payment_method"] == "pix"  # mas a forma dita NÃO se perde


@pytest.mark.asyncio
async def test_ciclo_inteiro_resolve_frase_e_colunas_gravadas(banco, monkeypatch):
    """resolve -> frase do SIM -> execução: o que a pessoa leu é o que vai para o INSERT."""
    from app.graph import nodes

    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix", expense_pattern="fixed", detalhe="feira"))
    acao = gasto(account="sem conta", occurred_at="2026-10-03")
    texto = "gastei 45 no mercado no pix, gasto fixo, detalhe feira"
    saida = await nodes.resolve_node(_estado(acao, text=texto))
    alvo = saida["targets"][0]
    frase = policy.describe_for_confirmation(acao, alvo)
    assert frase.endswith("no Pix · fixo · detalhe feira")

    escritas = []

    async def fetch_one(sql, *args):
        if "insert into public.transactions" in sql:
            escritas.append((sql, args))
            return {"id": uuid4()}
        return None

    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    ctx = ExecContext(uuid4(), uuid4(), None, "America/Sao_Paulo", texto, "wamid.1")
    ctx.target = alvo
    await finance.create_transaction(ctx, acao)
    sql, args = escritas[0]
    assert "payment_method" in sql and "expense_pattern_source" in sql and args[-1] == str(FEIRA["id"])
    assert "pix" in args and "fixed" in args and "explicit" in args


@pytest.mark.asyncio
async def test_corpo_de__extrair_usa_o_papel_parse_e_o_envelope(monkeypatch):
    """`_extrair` real (o conftest a derruba por padrão) com `gemini.llm` falso: schema, envelope, tempo."""
    from app.services import gemini
    from app.tools import atributos as mod

    visto = {}

    class Falso:
        def with_structured_output(self, schema):
            visto["schema"] = schema
            return self

        def with_config(self, **_kw):
            return self

        async def ainvoke(self, mensagens):
            visto["mensagens"] = mensagens
            return AtributosLote(itens=[AtributosItem(indice=0, payment_method="pix")])

    def llm(papel, temperature=0.1):
        visto["papel"], visto["temperatura"] = papel, temperature
        return Falso()

    monkeypatch.setattr(gemini, "llm", llm)
    real = mod.__dict__["_extrair_real"]
    lote = await real("gastei 45 no pix", ["0: gasto | mercado | categoria mercado"])
    assert lote.itens[0].payment_method == "pix"
    assert visto["papel"] == "parse" and visto["temperatura"] == 0 and visto["schema"] is AtributosLote
    assert "<user_input>" in visto["mensagens"][1][1] and visto["mensagens"][0][0] == "system"
    assert mod.TIMEOUT_S == 8


def test_frase_mostra_a_classificacao_que_veio_do_padrao_da_categoria():
    frase = dom.frase_dos_atributos(None, None, None, None, None, ["essencial (padrão de mercado)"])
    assert frase == "essencial (padrão de mercado)"


@pytest.mark.asyncio
async def test_padrao_da_categoria_aparece_na_frase_do_sim(banco, monkeypatch):
    async def fetch_one(sql, *args):
        return {"default_expense_pattern": None, "default_expense_necessity": "essential"}

    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix"))
    alvo, _ = await congela("gastei 45 no mercado no pix", gasto())
    assert alvo["atributos"]["frase"] == "no Pix · essencial (padrão de mercado)"


def test_detalhe_que_caiu_pela_regra_diz_que_nao_foi_gravado():
    attrs = {"subcategory_id": "x", "subcategory_name": "feira", "subcategory_parent": "mercado"}
    assert atributos.aviso_do_detalhe(attrs, "mercado") == ""
    assert "feira" in atributos.aviso_do_detalhe(attrs, "saúde") and "não foi gravado" in atributos.aviso_do_detalhe(attrs, "saúde")


@pytest.mark.asyncio
async def test_detalhe_igual_a_categoria_vira_nota_e_nao_pergunta(banco, monkeypatch):
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix", detalhe="mercado"))
    alvo, _ = await congela("gastei 80 no mercado no pix, detalhe mercado", gasto())
    assert "correction_error" not in alvo and "ignorado" in alvo["atributos"]["frase"]


def test_o_rascunho_guarda_a_frase_original_para_reler_a_forma():
    from app.graph import nodes

    acao = gasto()
    r = nodes._rascunho(_estado(acao, text="gastei 45 no crédito"), [acao],
                        [{"account_error": "qual cartão?", "so_cartoes": True}])
    assert r["raw_text"] == "gastei 45 no crédito" and r["action"]["so_cartoes"] is True and r["slot"] == "account"


@pytest.mark.asyncio
async def test_grafo_real_pergunta_com_o_entendido_e_grava_o_que_foi_lido(banco, monkeypatch):
    """Grafo real (resolve -> gate -> executar) com `_extrair` e o banco dublados."""
    import importlib

    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    from app.config import get_settings
    from app.graph import build as build_mod
    from app.graph import nodes

    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    leitura(monkeypatch, AtributosItem(indice=0, payment_method="pix", detalhe="feira"))

    async def router(state):
        return {"domains": ["financas"]}

    async def nada(state):
        return {}

    gravados = []

    async def executar(state, indexadas):
        alvo = state["targets"][indexadas[0][0]]
        gravados.append(alvo["atributos"])
        return ["EXECUTOU"]

    monkeypatch.setattr(nodes, "route", router)
    monkeypatch.setattr(nodes, "finance_node", nada)
    monkeypatch.setattr(nodes, "notes_node", nada)
    monkeypatch.setattr(nodes, "_executar", executar)
    importlib.reload(build_mod)
    grafo = build_mod.build(InMemorySaver())
    config = {"configurable": {"thread_id": "lote-c"}}
    estado = await grafo.ainvoke(
        _estado(gasto(account="sem conta"), text="gastei 45 no mercado no pix, detalhe feira"), config=config)
    pausa = estado["__interrupt__"][0]
    pausa = getattr(pausa, "value", pausa)
    assert pausa["summary"].endswith("sem conta, no Pix · detalhe feira")
    retomado = await grafo.ainvoke(Command(resume=True), config=config)
    assert "EXECUTOU" in retomado["reply"]
    assert gravados[0]["payment_method"] == "pix" and gravados[0]["subcategory_id"] == str(FEIRA["id"])
    get_settings.cache_clear()


def _parcelada_com(monkeypatch, padrao_da_categoria):
    caminhos = []

    class Tx:
        async def fetch_one(self, sql, *args):
            caminhos.append(("create_purchase", args))
            return {"id": uuid4()}

    @asynccontextmanager
    async def como_usuario(_uid):
        yield Tx()

    async def fetch_one(sql, *args):
        if "public.categories" in sql:
            return padrao_da_categoria
        if "create_installment_plan_with_history" not in sql:
            return None  # a consulta da regra do usuário
        caminhos.append(("create_installment_plan_with_history", args))
        return {"id": uuid4()}

    async def conta_citada(*_a, **_k):
        return str(CARTAO["id"])

    async def nada(*_a, **_k):
        return None

    monkeypatch.setattr(finance.db, "como_usuario", como_usuario)
    monkeypatch.setattr(finance.db, "fetch_one", fetch_one)
    monkeypatch.setattr(atributos.db, "fetch_one", fetch_one)
    monkeypatch.setattr(finance, "conta_citada", conta_citada)
    monkeypatch.setattr(finance, "ensure_owned", nada)
    ctx = ExecContext(uuid4(), uuid4(), None, "America/Sao_Paulo", "tv em 3x", "app:1")
    acao = FinanceAction(type="create_installment_purchase", amount_cents=300000, installments=3,
                         description="tv", category="eletrônicos", account="Nubank Cartão",
                         already_paid_count=0, occurred_at="2026-10-05")
    return ctx, acao, caminhos


@pytest.mark.asyncio
async def test_parcelada_sem_atributo_e_sem_padrao_segue_o_caminho_antigo(monkeypatch):
    ctx, acao, caminhos = _parcelada_com(monkeypatch, None)
    await finance.create_installment_purchase(ctx, acao)
    assert [c[0] for c in caminhos] == ["create_installment_plan_with_history"]


@pytest.mark.asyncio
async def test_parcelada_sem_atributo_mas_com_padrao_da_categoria_vai_por_create_purchase(monkeypatch):
    ctx, acao, caminhos = _parcelada_com(
        monkeypatch, {"default_expense_pattern": "variable", "default_expense_necessity": None})
    await finance.create_installment_purchase(ctx, acao)
    assert [c[0] for c in caminhos] == ["create_purchase"]
    dados = json.loads(caminhos[0][1][0])
    assert dados["expense_pattern"] == "variable" and dados["expense_pattern_source"] == "category_default"
    assert "p_payment_method" not in dados


def test_detalhe_marcado_vale_mesmo_igual_ao_titulo():
    """Avaliação de 05/10/2026: o parse põe "feira" no título em "gastei 80 no mercado, detalhe feira",
    e a trava do detalhe igual ao título jogava fora o detalhe que a pessoa escreveu."""
    from app.domain.atributos import detalhe_marcado

    assert detalhe_marcado("feira", "gastei 80 no mercado, detalhe feira")
    assert detalhe_marcado("padaria", "gastei 55 de padaria, subcategoria padaria")
    assert not detalhe_marcado("padaria", "paguei a padaria, 22, em dinheiro")
    assert not detalhe_marcado("feira", "gastei 80 na feira")
