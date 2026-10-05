"""Lote D, F22: lançar um favorito e duplicar um lançamento.

`tests/fixtures/copias_paridade.json` foi gerado RODANDO `decodeModelo`, `paramsDaCopia` e `podeDuplicar`
(src/lib/favoritos.ts e duplicar.ts) sobre os mesmos insumos; o espelho Python tem que dar o mesmo.
O resto prova o encaixe com dublês: o que a frase do SIM diz, o que vira pergunta e que o INSERT de prova
roda numa transação que volta."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.domain import matching
from app.graph.schemas import ResourceAction, ResourceField
from app.tools import copias, resolve, resources
from app.tools.base import ExecContext
from app.tools.guards import Level1Error
from tests.test_lote_b_movimentos import USER, WS, Banco, Recusado

FIX = json.loads((Path(__file__).parent / "fixtures" / "copias_paridade.json").read_text())
SRC = Path(__file__).resolve().parents[2] / "src" / "lib"

NUBANK = {"id": "584ef2de-431f-4a57-88cf-e1a38c8c1e56", "name": "Nubank", "type": "checking"}
POUPANCA = {"id": "e3e58c53-af27-4f09-a96d-bdea94e48463", "name": "Poupança", "type": "savings"}
CARTAO = {"id": "13083ab0-c759-4026-b2ea-6fca0a7e76ca", "name": "Nubank Cartão", "type": "credit_card"}
MODELO = {"id": "11111111-1111-4111-8111-111111111111", "name": "Almoço", "use_count": 2,
          "fields": {"kind": "expense", "description": "Almoço", "merchant": "Zé", "amount_cents": 4200,
                     "category": "alimentação", "account_id": NUBANK["id"], "payment_method": "pix",
                     "expense_pattern": "variable", "expense_pattern_source": "explicit"}}


def ctx(**extra):
    return ExecContext(USER, WS, None, "America/Sao_Paulo", "", "app:msg-1", action_index=0, **extra)


def acao(tipo, resource, name=None, **campos):
    return ResourceAction(type=tipo, resource=resource, name=name,
                          fields=[ResourceField(name=k, value=None if v is None else str(v)) for k, v in campos.items()])


# ------------------------------------------------------------------ paridade com o TypeScript


@pytest.mark.parametrize("i", range(len(FIX["modelos"])))
def test_decode_modelo_bate_com_o_typescript(i):
    assert copias.decode_modelo(FIX["modelos"][i]) == FIX["decodificados"][i]


@pytest.mark.parametrize("i", range(len(FIX["txs"])))
def test_campos_da_copia_bate_com_o_params_da_copia(i):
    tx, ts = FIX["txs"][i], FIX["copias"][i]
    campos, nota = copias.campos_da_copia(tx)
    p = ts["params"]
    assert (campos["kind"], campos["description"] or "", str(campos["amount_cents"] or 0)) == (
        p["kind"], p["description"], p["amount"])
    assert (campos["category"] or "", campos["merchant"] or "", campos["payment_method"] or "") == (
        p["category"], p["merchant"], p["paymentMethod"])
    assert (campos["account_id"] or "", campos["counterparty_account_id"] or "") == (
        p.get("conta", ""), p.get("counterparty", ""))
    classe = json.loads(p["classificacao"])
    assert {k: campos[k] for k in classe} == classe
    assert (nota is None) == (ts["nota"] is None) and copias.pode_duplicar(tx) is ts["pode"]


def test_colunas_copiadas_sao_as_do_app():
    ts = (SRC / "duplicar.ts").read_text()
    lista = re.search(r"COLUNAS_COPIADAS = \[(.*?)\] as const", ts, re.S).group(1)
    assert tuple(re.findall(r"'([^']+)'", lista)) == copias.COLUNAS_COPIADAS


def test_nunca_copia_vinculo_nem_estado():
    ignoradas = re.search(r"COLUNAS_IGNORADAS = \[(.*?)\] as const", (SRC / "duplicar.ts").read_text(), re.S).group(1)
    for coluna in re.findall(r"'([^']+)'", ignoradas):
        assert coluna not in copias.COLUNAS_COPIADAS
    sql, _ = copias._insert(WS, USER, copias.decode_modelo(MODELO["fields"]) | {"amount_cents": 1}, "2026-10-05")
    for proibida in ("invoice_id", "installment", "recurring_id", "debt_id", "pays_invoice_id", "status", "paid_at",
                     "auto_confirm", "due_at", "attachment", "rollover", "pix_fee", "request"):
        assert proibida not in sql.split(") select")[0]
    assert "'whatsapp'" not in sql and "source" in sql  # a origem é a do agente, nunca a do original


# ------------------------------------------------------------------ favoritos


class Fakes(Banco):
    def __init__(self, modelos=(MODELO,), contas=(NUBANK, POUPANCA, CARTAO), sub_ok=True, **ro):
        super().__init__(**{"insert into public.transactions": {"id": "22222222-2222-4222-8222-222222222222"},
                            "set constraints": {}, **ro})
        self.modelos, self.contas, self.sub_ok = list(modelos), list(contas), sub_ok
        self.escritas = []

    async def execute(self, sql, *args):  # o `_Tx.execute` do banco real
        await self.fetch_one(sql, *args)
        return 0


@pytest.fixture
def mundo(monkeypatch):
    def instala(f: Fakes):
        monkeypatch.setattr(copias.db, "como_usuario", f)

        async def fetch(sql, *a):
            if "from public.transaction_templates" in sql:
                if " like " in sql:  # a busca pelo nome é no SQL: igual primeiro, depois "contém"
                    dito = matching.normalize(a[1].strip("%"))
                    return [m for m in f.modelos if dito in matching.normalize(m["name"])]
                return f.modelos
            if "from public.subcategories" in sql:
                return [{"id": a[0], "name": "feira"}] if f.sub_ok else []
            raise AssertionError(sql)

        async def accounts(ws, *, only_cards=False):
            return f.contas

        async def fetch_one(sql, *a):
            f.escritas.append((sql, a))
            return {"id": "22222222-2222-4222-8222-222222222222"}

        async def execute(sql, *a):
            f.escritas.append((sql, a))

        monkeypatch.setattr(copias.db, "fetch", fetch)
        monkeypatch.setattr(copias.db, "accounts", accounts)
        monkeypatch.setattr(copias.db, "fetch_one", fetch_one)
        monkeypatch.setattr(copias.db, "execute", execute)
        return f
    return instala


async def prepara_favorito(f, mundo_, **campos):
    mundo_(f)
    return await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true", **campos))


@pytest.mark.asyncio
async def test_lancar_favorito_diz_tudo_na_frase_com_a_data_de_hoje(mundo):
    f = Fakes()
    p = await prepara_favorito(f, mundo)
    assert p["summary"].startswith("lançar, hoje (")
    assert "a partir do favorito *Almoço*" in p["summary"] and "gasto de R$ 42,00 — *Almoço*" in p["summary"]
    assert "(estabelecimento Zé)" in p["summary"] and "categoria alimentação" in p["summary"]
    assert "na conta Nubank, no Pix · variável" in p["summary"]
    assert f.saidas == [True]  # o INSERT de prova voltou
    assert f.chamadas[-1][0].strip().startswith("set constraints") and "payment_method_compatibility" in f.chamadas[-1][0]
    insert = [c for c in f.chamadas if c[0].startswith("insert into public.transactions")][0]
    assert "source" in insert[0] and "whatsapp" in insert[1] and "BRL" in insert[1]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", p["copia"]["hoje"])
    dia = p["copia"]["hoje"]
    assert f"hoje ({dia[8:]}/{dia[5:7]}/{dia[:4]})" in p["summary"]


@pytest.mark.asyncio
async def test_executar_grava_uma_vez_e_conta_o_uso_do_favorito(mundo):
    f = Fakes()
    p = await prepara_favorito(f, mundo)
    r = await resources.execute(ctx(target={"prepared": p}), acao("resource_update", "favoritos", "almoco", lancar="true"))
    assert r.message.startswith("💸 Lancei gasto de *R$ 42,00* (Almoço)") and str(r.result_id).startswith("22222222")
    assert len(f.escritas) == 1  # o lançamento e a contagem do uso são UM statement
    sql, args = f.escritas[0]
    assert "insert into public.transactions" in sql and "exists (select 1 from public.accounts" in sql  # conta viva
    assert "use_count = use_count + 1" in sql and args[-2:] == (MODELO["id"], WS)


@pytest.mark.asyncio
async def test_conta_arquivada_do_favorito_vira_pergunta_e_a_resposta_resolve(mundo, monkeypatch):
    velho = {**MODELO, "fields": {**MODELO["fields"], "account_id": "00000000-0000-4000-8000-000000000000"}}
    f = Fakes(modelos=[velho])
    mundo(f)
    with pytest.raises(resources.JaExiste, match="A conta do favorito \\*Almoço\\* não existe mais ou foi arquivada.*Nubank"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    assert f.escritas == []
    # a pessoa diz a conta: o pedido segue
    from app.tools import finance

    async def conta_citada(ws, nome, *, only_cards=False, papel="a conta"):
        from uuid import UUID
        return UUID(POUPANCA["id"])

    monkeypatch.setattr(finance, "conta_citada", conta_citada)
    p = await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true", conta="poupança"))
    assert "na conta Poupança" in p["summary"]


@pytest.mark.asyncio
async def test_favorito_sem_valor_pergunta_e_o_valor_dito_entra(mundo):
    sem = {**MODELO, "fields": {k: v for k, v in MODELO["fields"].items() if k != "amount_cents"}}
    f = Fakes(modelos=[sem])
    mundo(f)
    with pytest.raises(resources.JaExiste, match="não guarda o valor. Quanto foi"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    p = await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true", amount_cents=5000))
    assert "R$ 50,00" in p["summary"] and p["copia"]["campos"]["amount_cents"] == 5000


@pytest.mark.asyncio
async def test_categoria_dita_troca_e_derruba_o_detalhe(mundo):
    com_detalhe = {**MODELO, "fields": {**MODELO["fields"], "subcategory_id": "33333333-3333-4333-8333-333333333333"}}
    f = Fakes(modelos=[com_detalhe])
    p = await prepara_favorito(f, mundo, categoria="lazer")
    assert "categoria lazer" in p["summary"] and p["copia"]["campos"]["subcategory_id"] is None


@pytest.mark.asyncio
async def test_detalhe_que_nao_existe_mais_sai_e_a_frase_conta(mundo):
    com_detalhe = {**MODELO, "fields": {**MODELO["fields"], "subcategory_id": "33333333-3333-4333-8333-333333333333"}}
    p = await prepara_favorito(Fakes(modelos=[com_detalhe], sub_ok=False), mundo)
    assert p["copia"]["campos"]["subcategory_id"] is None and "o do original não existe mais" in p["summary"]
    p = await prepara_favorito(Fakes(modelos=[com_detalhe], sub_ok=True), mundo)
    assert p["copia"]["campos"]["subcategory_id"] == "33333333-3333-4333-8333-333333333333"


@pytest.mark.asyncio
async def test_forma_incompativel_chega_recusada_antes_do_sim(mundo):
    f = Fakes(**{"set constraints": [Recusado("P0001", "Escolha uma carteira para pagar em dinheiro.")]})
    cash = {**MODELO, "fields": {**MODELO["fields"], "payment_method": "cash"}}
    f.modelos = [cash]
    mundo(f)
    with pytest.raises(resources.JaExiste, match="Escolha uma carteira para pagar em dinheiro.*Nada foi alterado"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    assert f.saidas == [True] and not any("use_count" in e[0] for e in f.escritas)


@pytest.mark.asyncio
async def test_favorito_inexistente_ambiguo_e_pedido_sem_lancar(mundo):
    f = Fakes(modelos=[MODELO, {**MODELO, "id": "x2", "name": "Almoço de domingo"}])
    mundo(f)
    with pytest.raises(resources.JaExiste, match="Não achei o favorito \\*Jantar\\*.*Tenho: Almoço, Almoço de domingo"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "Jantar", lancar="true"))
    with pytest.raises(resources.JaExiste, match="casa com mais de um favorito"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almo", lancar="true"))
    with pytest.raises(resources.JaExiste, match="salvar, renomear e apagar favorito é no app"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "Almoço"))
    with pytest.raises(resources.JaExiste, match="Apagar favorito é no app"):
        await resources.prepare(ctx(), acao("resource_delete", "favoritos", "Almoço"))
    assert f.escritas == []


@pytest.mark.asyncio
async def test_listar_favoritos(mundo):
    f = Fakes()
    mundo(f)
    p = await resources.prepare(ctx(), acao("resource_list", "favoritos"))
    r = await resources.execute(ctx(target={"prepared": p}), acao("resource_list", "favoritos"))
    assert r.read_only and "• Almoço — R$ 42,00" in r.message


@pytest.mark.asyncio
async def test_transferencia_precisa_das_duas_contas(mundo):
    t = {**MODELO, "fields": {"kind": "transfer", "amount_cents": 10000, "account_id": NUBANK["id"]}}
    f = Fakes(modelos=[t])
    mundo(f)
    with pytest.raises(resources.JaExiste, match="duas contas"):
        await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    t["fields"]["counterparty_account_id"] = POUPANCA["id"]
    p = await resources.prepare(ctx(), acao("resource_update", "favoritos", "almoco", lancar="true"))
    assert "transferência de R$ 100,00, da conta Nubank para a conta Poupança" in p["summary"]
    # classificação some fora de gasto, e o destino some fora de transferência
    c = p["copia"]["campos"]
    assert c["expense_pattern"] is None


# ------------------------------------------------------------------ duplicar


def tx(**ov):
    base = {"id": "t1", "kind": "expense", "description": "Mercado", "merchant": None, "amount_cents": 15000,
            "category": "mercado", "subcategory_id": None, "account_id": NUBANK["id"], "counterparty_account_id": None,
            "payment_method": None, "occurred_at": "2026-10-04", "installment_plan_id": None, "installment_no": None,
            "debt_id": None, "pays_invoice_id": None, "pix_fee_for_transaction_id": None,
            "invoice_id": "fat-1", "status": "cleared", "paid_at": "2026-10-04", "recurring_id": "rec-1",
            "expense_pattern": None, "expense_pattern_source": None, "expense_necessity": None,
            "expense_necessity_source": None}
    return {**base, **ov}


@pytest.fixture
def duplicar(mundo, monkeypatch):
    def instala(linha, status="found", cands=None):
        f = Fakes()
        mundo(f)
        buscas = []

        async def por_transacao(ws, busca, quer_recente):
            buscas.append((busca.description, busca.occurred_at, quer_recente))
            return status, cands if cands is not None else [{"id": linha["id"], "label": "x", "when": "04/10/2026"}]

        async def fetch_one(sql, *a):
            if "select * from public.transactions" in sql:
                return linha
            f.escritas.append((sql, a))
            return {"id": "22222222-2222-4222-8222-222222222222"}

        monkeypatch.setattr(resolve, "por_transacao", por_transacao)
        monkeypatch.setattr(copias.db, "fetch_one", fetch_one)
        f.buscas = buscas
        return f
    return instala


@pytest.mark.asyncio
async def test_duplicar_copia_so_os_dados_e_usa_a_data_de_hoje(duplicar):
    f = duplicar(tx())
    p = await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado", data_do_original="2026-10-04"))
    assert f.buscas == [("mercado", "2026-10-04", False)]
    assert "a partir do lançamento de 04/10/2026: gasto de R$ 150,00 — *Mercado*, categoria mercado, na conta Nubank" in p["summary"]
    c = p["copia"]["campos"]
    assert set(c) == set(copias.COLUNAS_COPIADAS)  # nada de fatura, série, status, paid_at
    await resources.execute(ctx(target={"prepared": p}), acao("resource_create", "duplicar", "mercado"))
    sql, args = [e for e in f.escritas if e[0].startswith("insert into public.transactions")][0]
    assert "fat-1" not in args and "rec-1" not in args and "2026-10-04" not in args


@pytest.mark.asyncio
async def test_duplicar_sem_nome_e_sem_data_e_o_ultimo(duplicar):
    f = duplicar(tx())
    await resources.prepare(ctx(), acao("resource_create", "duplicar", None))
    assert f.buscas == [(None, None, True)]


@pytest.mark.asyncio
async def test_parcela_vira_a_vista_no_valor_dela_sem_o_sufixo(duplicar):
    duplicar(tx(description="tv (2/10)", amount_cents=30000, installment_plan_id="p1", installment_no=2,
                account_id=CARTAO["id"], invoice_id="fat-2"))
    p = await resources.prepare(ctx(), acao("resource_create", "duplicar", "tv"))
    assert "R$ 300,00 — *tv*" in p["summary"] and "(2/10)" not in p["summary"]
    assert "[Cópia da parcela 2 — vira um lançamento à vista]" in p["summary"]
    assert not any(k.startswith("installment") for k in p["copia"]["campos"])


@pytest.mark.asyncio
@pytest.mark.parametrize("ov, o_que", [
    ({"debt_id": "d1"}, "o pagamento de uma dívida"),
    ({"pays_invoice_id": "f1", "kind": "transfer"}, "o pagamento de uma fatura"),
    ({"pix_fee_for_transaction_id": "t9"}, "o juro do Pix de uma compra"),
])
async def test_pagamento_de_divida_fatura_e_juro_do_pix_nao_duplicam(duplicar, ov, o_que):
    f = duplicar(tx(**ov))
    with pytest.raises(resources.JaExiste, match=f"Não repito {o_que}"):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "x"))
    assert f.escritas == []


@pytest.mark.asyncio
async def test_empate_e_nao_achei_perguntam_com_a_data(duplicar):
    duplicar(tx(), status="ambiguous", cands=[{"id": "a", "label": "gasto de R$ 10,00 (Mercado)", "when": "03/10/2026"},
                                              {"id": "b", "label": "gasto de R$ 20,00 (Mercado)", "when": "04/10/2026"}])
    with pytest.raises(resources.JaExiste, match="mais de um lançamento com \\*mercado\\*.*em 03/10/2026.*em 04/10/2026.*Qual repito"):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado"))
    duplicar(tx(), status="none", cands=[])
    with pytest.raises(resources.JaExiste, match="Não achei nenhum lançamento com \\*mercado\\* em 04/10/2026"):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado", data_do_original="2026-10-04"))


@pytest.mark.asyncio
async def test_duplicar_so_cria_e_conta_arquivada_pergunta(duplicar):
    duplicar(tx(account_id="00000000-0000-4000-8000-000000000000"))
    with pytest.raises(resources.JaExiste, match="A conta do lançamento de 04/10/2026 não existe mais ou foi arquivada"):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado"))
    with pytest.raises(resources.JaExiste, match="cria um lançamento novo"):
        await resources.prepare(ctx(), acao("resource_delete", "duplicar", "mercado"))
    with pytest.raises(Level1Error):
        await resources.prepare(ctx(), acao("resource_create", "duplicar", "mercado", data_do_original="ontem"))
