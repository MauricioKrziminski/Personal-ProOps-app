"""Completar o rascunho de cadastro não perde o que ele já tinha (Claude Haiku, 09/10/2026)."""

from app.graph import nodes
from app.graph.schemas import ResourceAction, ResourceActionType, ResourceField

RASCUNHO = [{"type": "resource_create", "resource": "debts", "name": "carro",
             "fields": [{"name": "installments", "value": "48"}, {"name": "due_day", "value": "10"}]}]


def _acao(resource="debts", name="carro", **campos):
    return ResourceAction(type=ResourceActionType.CREATE, resource=resource, name=name,
                          fields=[ResourceField(name=k, value=v) for k, v in campos.items()])


def _campos(acao):
    return {f.name: f.value for f in acao.fields}


def test_herda_o_que_o_modelo_omitiu():
    (acao,) = nodes._com_campos_do_rascunho([_acao(installments_paid="0")], RASCUNHO)
    assert _campos(acao) == {"installments_paid": "0", "installments": "48", "due_day": "10"}


def test_o_que_o_modelo_disse_vence():
    (acao,) = nodes._com_campos_do_rascunho([_acao(due_day="15")], RASCUNHO)
    assert _campos(acao)["due_day"] == "15"


def test_outro_assunto_nao_herda():
    (acao,) = nodes._com_campos_do_rascunho([_acao(resource="goals", name="viagem")], RASCUNHO)
    assert _campos(acao) == {}
    (outra,) = nodes._com_campos_do_rascunho([_acao(name="moto")], RASCUNHO)
    assert _campos(outra) == {}


def test_sem_nome_herda_o_nome_do_rascunho():
    (acao,) = nodes._com_campos_do_rascunho([_acao(name=None, installments_paid="8")], RASCUNHO)
    assert acao.name == "carro" and _campos(acao)["due_day"] == "10"
