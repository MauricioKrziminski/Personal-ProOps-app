"""`AGENT_PROMPT_V2`: desligado nada muda (byte a byte); ligado, módulos por sub-intenção e exemplos.

Os PINOS abaixo foram calculados ANTES de a flag existir. Mexeu num deles de propósito (prompt v1,
schema do router v1, turno humano)? Então a mudança vale também para quem está com a flag
desligada — que é o que a flag existe para impedir —, e o pino novo precisa de avaliação com o
Gemini real (`scripts/evaluate_answer_forms.py`).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re

import pytest

from app.config import get_settings
from app.graph import exemplos, nodes, prompts, prompts_v2
from app.graph.schemas import (
    FinancePlan,
    FinanceQueryPlan,
    RouterDecision,
    RouterDecisionV2,
)
from app.services import consumo, embeddings, gemini

# --- pinos do caminho v1 ------------------------------------------------------------------

PIN_ROUTER = "3f459db8"
PIN_FINANCE = "d16a6394"
PIN_FINANCE_QUERY = "5d4cc1d7"
PIN_NOTES = "ffd30b04"
PIN_SCHEMA_ROUTER = "290d403c0f22daf5"
PIN_TURNO_SIMPLES = "02e5e46b1513deff"
PIN_TURNO_COMPLETO = "c94233cd22603a10"


def _h(texto: str) -> str:
    return hashlib.sha256(texto.encode()).hexdigest()[:16]


def test_prompts_v1_continuam_byte_a_byte_iguais():
    assert gemini.versao_do_prompt(prompts.ROUTER) == PIN_ROUTER
    assert gemini.versao_do_prompt(prompts.FINANCE) == PIN_FINANCE
    assert gemini.versao_do_prompt(prompts.FINANCE_QUERY) == PIN_FINANCE_QUERY
    assert gemini.versao_do_prompt(prompts.NOTES) == PIN_NOTES


def test_schema_do_router_v1_continua_o_mesmo():
    schema = json.dumps(RouterDecision.model_json_schema(), sort_keys=True)
    assert _h(schema) == PIN_SCHEMA_ROUTER


def test_turno_humano_sem_exemplos_continua_o_mesmo():
    args = ("gastei 45 no mercado", "2026-10-06T10:00:00-03:00", "America/Sao_Paulo")
    assert _h(prompts.user_turn(*args)) == PIN_TURNO_SIMPLES
    completo = prompts.user_turn(
        *args, tem_anexo=True,
        history=[{"role": "user", "content": "oi"}, {"role": "assistant", "content": "olá"}],
        pastas=["a"], corrigindo="x",
        contas=[{"name": "Nubank", "type": "credit_card", "closing_day": 3, "apelidos": ["roxinho"]}],
        detalhes=[{"parent_key": "mercado", "name": "feira"}],
    )
    assert _h(completo) == PIN_TURNO_COMPLETO


def test_a_flag_nasce_desligada():
    assert get_settings().agent_prompt_v2 is False
    assert prompts_v2.ligado() is False


# --- nós: o que chega ao modelo ------------------------------------------------------------


class _Captura:
    """Dublê de `gemini.structured`: guarda schema, nó, versão e as mensagens que o modelo viu."""

    def __init__(self, respostas: dict):
        self.respostas, self.chamadas = respostas, []

    def __call__(self, schema, *_a, **kw):
        captura = self

        class _M:
            async def ainvoke(self, mensagens):
                captura.chamadas.append({"schema": schema, "no": kw.get("no"),
                                         "versao": kw.get("versao"), "mensagens": mensagens})
                return captura.respostas[schema]

        return _M()


ESTADO = {"text": "gastei 45 no mercado", "timezone": "America/Sao_Paulo", "messages": None,
          "agora_local": "2026-10-06T10:00:00-03:00"}


def _instalar(monkeypatch, v2: bool, router_sub=None):
    monkeypatch.setattr(get_settings(), "agent_prompt_v2", v2)
    cap = _Captura({
        RouterDecision: RouterDecision(domains=["financas"], confidence=0.9),
        RouterDecisionV2: RouterDecisionV2(domains=["financas"], confidence=0.9,
                                           finance_subintents=router_sub),
        FinancePlan: FinancePlan(actions=[]),
        FinanceQueryPlan: FinanceQueryPlan(actions=[]),
    })
    monkeypatch.setattr(nodes.gemini, "structured", cap)
    return cap


@pytest.mark.asyncio
async def test_desligado_os_tres_nos_mandam_exatamente_o_de_antes(monkeypatch):
    cap = _instalar(monkeypatch, v2=False)
    saida = await nodes.route(dict(ESTADO))
    await nodes.finance_node(dict(ESTADO))
    await nodes.finance_query_node(dict(ESTADO))

    router, finance, query = cap.chamadas
    assert router["schema"] is RouterDecision
    assert router["mensagens"][0] == ("system", prompts.ROUTER)
    assert router["versao"] == PIN_ROUTER
    assert finance["mensagens"][0] == ("system", prompts.FINANCE)
    assert finance["versao"] == PIN_FINANCE
    assert query["mensagens"][0] == ("system", prompts.FINANCE_QUERY)
    assert query["versao"] == PIN_FINANCE_QUERY
    for chamada in (router, finance, query):
        humano = chamada["mensagens"][1]
        texto = humano[1] if isinstance(humano, tuple) else humano.content
        assert "Exemplos parecidos" not in texto
    assert "subintents" not in saida  # nem o estado ganha chave com a flag desligada


@pytest.mark.asyncio
async def test_ligado_router_v2_e_modulos_so_das_subintencoes(monkeypatch):
    cap = _instalar(monkeypatch, v2=True, router_sub=["criar", "meta"])
    saida = await nodes.route(dict(ESTADO))
    assert saida["subintents"] == ["criar", "meta"]
    router = cap.chamadas[0]
    assert router["schema"] is RouterDecisionV2
    assert router["mensagens"][0] == ("system", prompts_v2.ROUTER_V2)

    await nodes.finance_node({**ESTADO, "subintents": saida["subintents"]})
    sistema = cap.chamadas[1]["mensagens"][0][1]
    assert sistema == prompts_v2.finance(["criar", "meta"])
    assert "Metas:" in sistema and "Fatura do cartão:" not in sistema

    await nodes.finance_query_node(dict(ESTADO))
    assert cap.chamadas[2]["mensagens"][0][1] == prompts_v2.finance_query(tem_historico=False)


@pytest.mark.asyncio
async def test_ligado_router_fora_do_vocabulario_monta_todos(monkeypatch):
    _instalar(monkeypatch, v2=True, router_sub=["criar", "divida"])
    assert (await nodes.route(dict(ESTADO)))["subintents"] == []
    cap = _instalar(monkeypatch, v2=True, router_sub=None)
    assert (await nodes.route(dict(ESTADO)))["subintents"] == []
    await nodes.finance_node({**ESTADO, "subintents": []})
    sistema = cap.chamadas[1]["mensagens"][0][1]
    assert all(t in sistema for t in ("Metas:", "Fatura do cartão:", "create_transfer: account = origem"))


@pytest.mark.asyncio
async def test_pedido_refeito_antes_do_sim_monta_todos_os_modulos(monkeypatch):
    """O router lê "na verdade…" como `alterar`, mas é um registro NOVO: faltaria o módulo parcelado."""
    cap = _instalar(monkeypatch, v2=True)
    await nodes.finance_node({**ESTADO, "text": "Na verdade eu comprei em 2x no cartão",
                              "subintents": ["alterar"], "corrigindo": "Registrar gasto de R$ 104,99"})
    sistema = cap.chamadas[0]["mensagens"][0][1]
    assert "create_installment_purchase (2 ou mais parcelas)" in sistema
    assert sistema == prompts_v2.finance([])


# --- montagem dos módulos ------------------------------------------------------------------


def test_normalizar_subintents():
    n = prompts_v2.normalizar_subintents
    assert n(None) == [] and n([]) == [] and n([" "]) == []
    assert n(["meta", "Criar"]) == ["criar", "meta"]  # ordem canônica, caixa ignorada
    assert n(["criar", "divida"]) == []  # qualquer termo desconhecido -> todos
    assert n(["criar", "criar"]) == ["criar"]


def test_base_sempre_presente_e_ordem_canonica():
    base = prompts_v2._FINANCE_BASE
    nomes = [nome for nome, _, _ in prompts_v2._MODULOS]
    for subs in (["criar"], ["meta", "alterar"], ["fatura", "baixa", "transferencia"], []):
        texto = prompts_v2.finance(subs)
        assert texto.startswith(base)
        posicoes = [texto.index(t) for n, liga, t in prompts_v2._MODULOS
                    if t in texto]
        assert posicoes == sorted(posicoes), "módulos fora da ordem canônica"
    assert nomes == ["atributos", "transferencia", "parcelado", "fatura", "baixa", "alterar", "meta"]


def test_regras_de_seguranca_estao_no_base_e_nao_dependem_do_router():
    base = prompts_v2._FINANCE_BASE
    for trecho in ("nunca crie lançamento novo", "new_amount_cents", "account não é correção",
                   "deixe VAZIOS", "Nunca invente termo de busca", "amount_cents VAZIO"):
        assert trecho in base, trecho
    for tipo in ("create_expense", "create_income", "create_transfer", "create_installment_purchase",
                 "pay_invoice", "mark_paid", "set_rule", "update_transaction", "delete_transaction",
                 "undo_last", "create_goal", "goal_deposit", "update_asset_value", "unknown"):
        assert tipo in base, f"tipo sem linha no base: {tipo}"
    # a anti-injeção fecha todo prompt montado
    assert prompts_v2.finance(["criar"]).endswith(prompts._ANTI_INJECTION)


def test_so_criar_e_bem_menor_que_todos_e_anexo_traz_o_documento():
    pequeno, todos = prompts_v2.finance(["criar"]), prompts_v2.finance([])
    assert len(pequeno) < len(todos) * 0.6
    assert "Documento anexo" not in todos
    assert "Documento anexo" in prompts_v2.finance(["criar"], tem_anexo=True)
    assert "Atributos opcionais" in prompts_v2.finance(["parcelado"])  # atributos servem a dois


def test_consulta_so_ganha_continuacao_com_historico():
    assert "continua_anterior" not in prompts_v2.finance_query(False)
    assert "continua_anterior" in prompts_v2.finance_query(True)
    assert "NUNCA use query_forecast" not in prompts_v2._QUERY_BASE  # a repetição saiu


def _frases_da_regra(texto: str) -> list[str]:
    padrao = re.compile(r'"([^"]+)"((?:\s*/\s*"[^"]+")*)\s*->')
    achadas = []
    for m in padrao.finditer(" ".join(texto.split())):
        achadas.append(m.group(1))
        achadas += re.findall(r'"([^"]+)"', m.group(2))
    return achadas


def test_nenhuma_frase_de_regra_do_v1_sumiu():
    """Cada frase `"x" ->` do FINANCE e do FINANCE_QUERY v1 está no v2 montado inteiro ou nos exemplos."""
    v2 = " ".join((prompts_v2.finance([], tem_anexo=True) + prompts_v2.finance_query(True)).split())
    nos_exemplos = " ".join(e["frase"] for e in exemplos.carregar())
    for v1, minimo in ((prompts.FINANCE, 40), (prompts.FINANCE_QUERY, 10)):
        frases = _frases_da_regra(v1)
        assert len(frases) > minimo
        sumiram = [f for f in frases if f not in v2 and f not in nos_exemplos]
        assert not sumiram, sumiram


# --- schema do router v2 -------------------------------------------------------------------


def test_router_v2_continua_minusculo_e_sem_segundo_enum():
    assert len(RouterDecisionV2.model_fields) <= 5
    enums = [d for d in RouterDecisionV2.model_json_schema().get("$defs", {}).values() if "enum" in d]
    assert len(enums) <= 1  # só Domain; o vocabulário vai na descrição, validado em código
    descricao = RouterDecisionV2.model_fields["finance_subintents"].description
    assert all(s in descricao for s in prompts_v2.SUBINTENCOES)


# --- exemplos dinâmicos --------------------------------------------------------------------


def test_banco_de_exemplos_e_valido_e_sintetico():
    todos = exemplos.carregar()
    assert 60 <= len(todos) <= 120
    assert {e["grupo"] for e in todos} == {"parse", "consulta"}
    assert len({(e["grupo"], e["frase"], e.get("antes")) for e in todos}) == len(todos)
    texto = json.dumps(todos, ensure_ascii=False)
    # nada de dado pessoal: telefone, e-mail, CPF/CNPJ, id de banco
    assert not re.search(r"@|\b\d{10,}\b|\d{3}\.\d{3}\.\d{3}|[0-9a-f]{8}-[0-9a-f]{4}", texto)


def test_formatar_e_o_turno_humano_com_exemplos():
    bloco = exemplos.formatar([
        {"grupo": "parse", "frase": "na verdade foi 50", "saida": "update_transaction new_amount_cents=5000",
         "antes": "gastei 45 no mercado"},
        {"grupo": "parse", "frase": "gastei 45", "saida": "create_expense amount_cents=4500"},
    ])
    assert 'depois de "gastei 45 no mercado"' in bloco and "Exemplos parecidos" in bloco
    assert exemplos.formatar([]) == ""
    turno = prompts.user_turn("oi", "2026-10-06T10:00:00-03:00", "America/Sao_Paulo", exemplos=bloco)
    # fora do envelope do usuário e ANTES dele (a fala da pessoa continua a última coisa)
    assert turno.index("Exemplos parecidos") < turno.index("<user_input>")
    assert "Exemplos parecidos" not in turno[turno.index("<user_input>"):]


class _EmbeddingsFake:
    """Vetores de 768 dimensões: uma dimensão por 'tema', para o cosseno ser previsível."""

    def __init__(self):
        self.documentos, self.consultas = 0, 0

    @staticmethod
    def _vetor(texto: str) -> list[float]:
        v = [0.0] * embeddings.DIMENSOES
        for i, tema in enumerate(("mercado", "fatura", "meta", "tv")):
            if tema in texto:
                v[i] = 1.0
        if not any(v):
            v[100] = 1.0
        return v

    async def aembed_documents(self, textos, **_k):
        self.documentos += 1
        await asyncio.sleep(0)
        return [self._vetor(t) for t in textos]

    async def aembed_query(self, texto, **_k):
        self.consultas += 1
        return self._vetor(texto)


@pytest.fixture
def indice_zerado(monkeypatch, tmp_path):
    # sem o arquivo de vetores: o índice vem do embedding de mentira (os testes de busca dependem dele)
    monkeypatch.setattr(exemplos, "ARQUIVO_VETORES", tmp_path / "nao_existe.json")
    monkeypatch.setattr(exemplos, "_indice", None)
    monkeypatch.setattr(exemplos, "_falhou_em", None)
    monkeypatch.setattr(exemplos, "_trava", None)
    monkeypatch.setattr(exemplos, "_vetores_do_turno", {})


@pytest.mark.asyncio
async def test_exemplos_do_grupo_certo_e_indice_montado_uma_vez(monkeypatch, indice_zerado):
    fake = _EmbeddingsFake()
    monkeypatch.setattr(embeddings, "_embeddings", lambda: fake)
    # dois nós no MESMO turno, em paralelo: um vetor da frase e um índice só
    parse, consulta = await asyncio.gather(
        exemplos.parecidos("comprei uma tv em 10x", "parse"),
        exemplos.parecidos("comprei uma tv em 10x", "consulta"),
    )
    assert "tv" in parse and "create_installment_purchase" in parse
    assert "simulate_scenario" not in parse
    assert "query_" in consulta or consulta == ""  # grupo de consulta, nunca o de escrita
    assert "create_" not in consulta
    assert fake.documentos == 1 and fake.consultas == 1
    assert parse.count("\n- ") == exemplos.K  # k exemplos, os mais parecidos primeiro
    assert (await exemplos.parecidos("outra frase com tv", "parse"))
    assert fake.documentos == 1


@pytest.mark.asyncio
async def test_a_chamada_de_embedding_entra_no_consumo_do_turno(monkeypatch, indice_zerado):
    monkeypatch.setattr(embeddings, "_embeddings", lambda: _EmbeddingsFake())
    uso = consumo.abrir()
    await exemplos.parecidos("gastei no mercado", "parse")
    registros = [c for c in uso.chamadas if c["papel"] == "embedding"]
    assert [c["no"] for c in registros] == ["exemplos"]


@pytest.mark.asyncio
async def test_falha_do_embedding_nunca_derruba_o_turno(monkeypatch, indice_zerado):
    # o conftest já faz o embedding falhar como um 429
    assert await exemplos.parecidos("gastei no mercado", "parse") == ""
    assert exemplos._indice is None and exemplos._falhou_em is not None

    # dentro da janela de espera não bate de novo; vencida, tenta (e agora funciona)
    fake = _EmbeddingsFake()
    monkeypatch.setattr(embeddings, "_embeddings", lambda: fake)
    assert await exemplos.parecidos("gastei no mercado", "parse") == ""
    assert fake.documentos == 0
    monkeypatch.setattr(exemplos, "_falhou_em", exemplos._falhou_em - exemplos.RETENTAR_APOS_S - 1)
    assert await exemplos.parecidos("gastei no mercado", "parse") != ""


@pytest.mark.asyncio
async def test_no_ligado_os_exemplos_entram_no_turno_humano_do_parse(monkeypatch, indice_zerado):
    monkeypatch.setattr(embeddings, "_embeddings", lambda: _EmbeddingsFake())
    cap = _instalar(monkeypatch, v2=True)
    await nodes.finance_node({**ESTADO, "text": "comprei uma tv em 10x"})
    humano = cap.chamadas[0]["mensagens"][1][1]
    assert "Exemplos parecidos" in humano
    assert humano.index("Exemplos parecidos") < humano.index("<user_input>")


def test_arquivo_de_vetores_em_dia_com_o_banco_e_o_modelo():
    """Mexeu em `exemplos.json` ou no modelo de embedding: rode `scripts/vetorizar_exemplos.py`."""
    gravados = exemplos.vetores_gravados()  # vazio se o modelo do arquivo não é o em uso
    faltam = [e["frase"] for e in exemplos.carregar() if e["frase"] not in gravados]
    assert not faltam, f"exemplos_vetores.json defasado: {faltam[:3]}"
    assert all(len(v) == embeddings.DIMENSOES for v in gravados.values())


@pytest.mark.asyncio
async def test_com_o_arquivo_o_indice_nao_chama_o_embedding(monkeypatch):
    monkeypatch.setattr(exemplos, "_indice", None)
    monkeypatch.setattr(exemplos, "_falhou_em", None)
    monkeypatch.setattr(exemplos, "_trava", None)
    fake = _EmbeddingsFake()
    monkeypatch.setattr(embeddings, "_embeddings", lambda: fake)
    indice = await exemplos._montar_indice()
    assert len(indice) == len(exemplos.carregar()) and fake.documentos == 0
