"""Account correction is resolved before consent and revalidated at the write."""
from uuid import UUID

import pytest
from app.graph.policy import describe_for_confirmation
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = UUID('11111111-1111-1111-1111-111111111111')
ACCOUNT = UUID('22222222-2222-2222-2222-222222222222')
TX = UUID('33333333-3333-3333-3333-333333333333')


def action(**kwargs):
    return FinanceAction(type=FinanceActionType.UPDATE_TRANSACTION, **kwargs)


def target():
    return {'table': 'transactions', 'status': 'found',
            'candidates': [{'id': str(TX), 'label': 'gasto de R$ 45 no mercado'}],
            'new_account': {'id': str(ACCOUNT), 'name': 'Nubank'}}


def ctx(resolved):
    return ExecContext(user_id=WS, workspace_id=WS, phone=None, timezone='America/Sao_Paulo',
                       texto='', source_message_id='fixture', target=resolved)


def test_correction_field_is_distinct_and_confirmation_shows_value_and_account():
    correction = action(new_account='Nubank', new_amount_cents=5400)
    assert correction.new_account == 'Nubank'
    assert correction.account is None
    summary = describe_for_confirmation(correction, target())
    assert '54' in summary and 'Nubank' in summary and '45' in summary


@pytest.mark.asyncio
async def test_resolver_freezes_unique_account_and_never_chooses_ambiguity(monkeypatch):
    rows = [{'id': ACCOUNT, 'name': 'Nubank', 'type': 'checking'}]

    async def accounts(*a, **kw):
        return rows

    async def transaction(*a):
        return 'found', target()['candidates']

    async def plans(ws, candidates):
        return candidates

    monkeypatch.setattr(resolve.db, 'accounts', accounts)
    monkeypatch.setattr(resolve, 'por_transacao', transaction)
    monkeypatch.setattr(resolve, '_com_plano', plans)
    result = (await resolve.for_actions(WS, [action(new_account='Nubank')], 'muda o último'))[0]
    assert result['new_account'] == {'id': str(ACCOUNT), 'name': 'Nubank'}
    rows.append({'id': TX, 'name': 'Nubank', 'type': 'credit_card'})
    result = (await resolve.for_actions(WS, [action(new_account='Nubank')], 'muda o último'))[0]
    assert result.get('correction_error') and 'new_account' not in result


@pytest.mark.asyncio
async def test_executor_uses_frozen_id_and_atomic_active_workspace_guard(monkeypatch):
    queries = []

    async def fetch_one(query, *args):
        queries.append((query, args))
        if query.lstrip().startswith('select'):
            return {'id': TX, 'kind': 'expense', 'amount_cents': 4500, 'category': 'mercado',
                    'description': 'mercado', 'occurred_at': '2026-09-08'}
        return {'id': TX}

    monkeypatch.setattr(finance.db, 'fetch_one', fetch_one)
    result = await finance.update_transaction(ctx(target()), action(new_account='Nubank', new_amount_cents=5400))
    query, args = queries[-1]
    assert 'returning id' in query.lower()
    assert 'not a.archived' in query and 'a.workspace_id' in query
    assert str(ACCOUNT) in [str(a) for a in args]
    assert 'Nubank' in result.message and '54' in result.message


@pytest.mark.asyncio
async def test_missing_frozen_account_never_falls_back_to_lookup(monkeypatch):
    async def unexpected(*args, **kwargs):
        raise AssertionError('no database access without frozen correction')

    monkeypatch.setattr(finance.db, 'fetch_one', unexpected)
    with pytest.raises(Level1Error):
        await finance.update_transaction(ctx({'candidates': target()['candidates']}), action(new_account='Nubank'))


@pytest.mark.asyncio
async def test_destination_archived_or_deleted_returns_no_success(monkeypatch):
    async def fetch_one(query, *args):
        if query.lstrip().startswith('select'):
            return {'id': TX, 'amount_cents': 4500}
        return None

    monkeypatch.setattr(finance.db, 'fetch_one', fetch_one)
    result = await finance.update_transaction(ctx(target()), action(new_account='Nubank'))
    assert result.read_only and 'Corrigido' not in result.message


@pytest.mark.asyncio
async def test_real_graph_freezes_destination_before_yes(monkeypatch):
    from app.graph import build as graph_module
    from app.graph import nodes
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    account_rows = [{'id': ACCOUNT, 'name': 'Nubank', 'type': 'checking'}]
    lookups = []
    writes = []

    async def noop(state):
        return {}

    async def accounts(*a, **kw):
        lookups.append(1)
        return account_rows

    async def transaction(*a):
        return 'found', target()['candidates']

    async def plans(ws, candidates):
        return candidates

    async def execute(state, actions):
        writes.append(state['targets'][0]['new_account'])
        return ['WROTE'], None, None

    monkeypatch.setattr(graph_module, 'route', noop)
    monkeypatch.setattr(graph_module, 'finance_node', noop)
    monkeypatch.setattr(resolve.db, 'accounts', accounts)
    monkeypatch.setattr(resolve, 'por_transacao', transaction)
    monkeypatch.setattr(resolve, '_com_plano', plans)
    monkeypatch.setattr(nodes, '_executar', execute)
    graph = graph_module.build(InMemorySaver())
    config = {'configurable': {'thread_id': 'account-correction-fixture'}}
    initial = {'preset': True, 'domains': ['financas'], 'workspace_id': str(WS),
               'user_id': str(WS), 'phone': None, 'timezone': 'America/Sao_Paulo',
               'text': 'muda o último para54 na Nubank', 'results': [],
               'source_message_id': 'fixture', 'confidence': 1.0,
               'finance_actions': [action(new_account='Nubank', new_amount_cents=5400).model_dump(mode='json')]}
    first = await graph.ainvoke(initial, config)
    summary = first['__interrupt__'][0].value['summary']
    assert '54' in summary and 'Nubank' in summary
    assert not writes
    account_rows[:] = [{'id': TX, 'name': 'Nubank', 'type': 'checking'}]
    await graph.ainvoke(Command(resume=True), config)
    assert len(lookups) == 1
    assert writes == [{'id': str(ACCOUNT), 'name': 'Nubank'}]


@pytest.mark.asyncio
async def test_gate_halts_ambiguous_account_without_consent_or_write():
    from app.graph.nodes import gate

    result = await gate({'finance_actions': [action(new_account='Nubank').model_dump(mode='json')],
                         'targets': [{**target(), 'correction_error': 'Encontrei duas contas. Diga qual.'}],
                         'results': []})
    assert result['halted'] and not result['approved']
    assert 'duas contas' in result['results'][0]


@pytest.mark.asyncio
async def test_whole_installment_plan_does_not_promise_account_correction(monkeypatch):
    async def transaction(*a):
        return 'found', target()['candidates']

    async def plans(ws, candidates):
        return [{'id': str(TX), 'label': 'TV em 12x', 'table': 'installment_plans'}]

    monkeypatch.setattr(resolve, 'por_transacao', transaction)
    monkeypatch.setattr(resolve, '_com_plano', plans)
    resolved = (await resolve.for_actions(WS, [action(new_account='Nubank')], 'muda a TV'))[0]
    assert 'parcela individual' in resolved['correction_error']
    assert 'new_account' not in resolved


def test_ambiguous_transaction_confirmation_keeps_all_corrections():
    resolved = {**target(), 'status': 'ambiguous'}
    summary = describe_for_confirmation(action(new_account='Nu', new_amount_cents=5400,
                                               new_category='casa', new_occurred_at='2026-09-08'), resolved)
    assert 'Nubank' in summary and '54' in summary and 'casa' in summary and '08/09/2026' in summary


@pytest.mark.asyncio
async def test_rename_is_a_correction_and_never_touches_the_search_field(monkeypatch):
    """Trocar o NOME de um lançamento (09/09/2026).

    `description` continua sendo BUSCA e `new_description` é o nome novo. Confundir os dois faz o
    modelo procurar pelo nome que o usuário AINDA NÃO deu, e a correção não acha nada.
    """
    escrito: dict = {}

    async def fetch_one(sql, *args):
        if sql.strip().startswith('select id, kind'):
            return {'id': TX, 'kind': 'expense', 'amount_cents': 4500,
                    'category': 'mercado', 'description': 'Mercado',
                    'occurred_at': __import__('datetime').date(2026, 9, 1)}
        escrito['sql'], escrito['args'] = sql, args
        return {'id': TX}

    monkeypatch.setattr(finance.db, 'fetch_one', fetch_one)
    alvo = {'table': 'transactions', 'status': 'found',
            'candidates': [{'id': str(TX), 'label': 'Mercado'}]}
    r = await finance.update_transaction(
        ctx(alvo), action(description='mercado', new_description='Mercado do Zé'))

    assert 'description = %s' in escrito['sql']
    assert escrito['args'][0] == 'Mercado do Zé'
    assert 'Mercado do Zé' in r.message
    # o campo de busca não pode virar patch: senão renomear e procurar viram a mesma coisa
    assert escrito['sql'].count('description = %s') == 1


@pytest.mark.asyncio
async def test_rename_alone_is_enough_to_be_a_correction(monkeypatch):
    """Sem valor, sem categoria e sem data, só o nome novo já é uma correção válida."""
    async def fetch_one(sql, *args):
        if sql.strip().startswith('select id, kind'):
            return {'id': TX, 'kind': 'expense', 'amount_cents': 4500, 'category': None,
                    'description': 'Padaria', 'occurred_at': __import__('datetime').date(2026, 9, 1)}
        return {'id': TX}

    monkeypatch.setattr(finance.db, 'fetch_one', fetch_one)
    alvo = {'table': 'transactions', 'status': 'found',
            'candidates': [{'id': str(TX), 'label': 'Padaria'}]}
    r = await finance.update_transaction(ctx(alvo), action(new_description='Padaria do Léo'))
    assert 'Padaria do Léo' in r.message


def test_rename_needs_the_same_yes_as_any_other_change():
    """`needs_confirmation` deriva de "tem alvo resolvido", então cobre o campo novo sozinha."""
    from app.graph.policy import needs_confirmation
    assert needs_confirmation(action(new_description='Mercado do Zé'), 0.99, target()) is not None
