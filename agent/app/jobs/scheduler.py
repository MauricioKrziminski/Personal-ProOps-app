"""Manutenção financeira (cron de hora em hora).

Quatro coisas, nessa ordem:
  1. materializa recorrentes UM ANO à frente (é o que alimenta a projeção de
     fluxo de caixa — sem isso a previsão só enxerga o que já aconteceu)
  2. fecha faturas vencidas
  3. promove pendentes que já venceram
  4. tira a foto do patrimônio do dia

Só a (1) é código; o resto é RPC. Valor de imóvel/investimento/dívida não tem
histórico para reconstruir depois, então a série de patrimônio vive de SNAPSHOT —
reconstruir seria inventar número.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from psycopg.errors import UniqueViolation

from app import db
from app.domain.dates import local_iso_date, now_utc
from app.domain.recurrence import em_pausa, next_occurrence

log = logging.getLogger(__name__)

# Um ANO à frente, não 90 dias (10/09/2026).
#
# O padrão da indústria para recorrência é híbrido: a REGRA (RRULE) é a fonte da verdade, uma
# janela próxima é materializada em linhas de verdade — que dá para editar, conciliar e cobrar
# lembrete — e o que está além dela é expandido da regra. O Google Calendar pré-computa ~1 ano;
# o Asana, 30 dias.
#
# Este app tinha só a metade materializada, e com a janela em 90 dias abrir outubro de 2027
# mostrava um mês VAZIO de salário e conta fixa — a projeção não "acabava", ela mentia: a
# despesa parcelada continuava (ela é linha real) e a receita recorrente sumia. O resultado era
# um saldo despencando para −8.893,32 que nunca existiu.
#
# 365 dias resolve sem código novo: são ~12 linhas por série (15 séries = ~180 linhas), e o
# expansor continua num lugar só. Escrever um segundo expansor em SQL para "projetar além do
# horizonte" criaria a segunda cópia da regra — exatamente o que este projeto evita.
# Para ir além de 12 meses, o caminho é uma RPC de LEITURA marcando a linha como projetada,
# nunca duplicar a aritmética.
HORIZON_DAYS = 365
MAX_OCCURRENCES_PER_SERIES = 200
MAX_SERIES_PER_RUN = 200
# O cron de 1 minuto só pega série nunca materializada; o normal é zero ou uma.
MAX_NOVAS_POR_MINUTO = 20
DEFAULT_TIMEZONE = "America/Sao_Paulo"


async def _passo(nome: str, sql: str, erros: dict) -> int:
    """Um passo do cron, isolado dos outros.

    ⚠️ **Os quatro passos são INDEPENDENTES e não podiam cair juntos.** Eles rodavam em
    sequência crua: a primeira exceção matava os seguintes. O caso concreto que expôs isso foi
    a ordem de deploy — subir o agente antes de aplicar a migration faz
    `_roll_overdue_invoices` não existir, e o `undefined_function` levava junto a PROMOÇÃO de
    lançamentos vencidos (o que vira `cleared` na data) e o snapshot de patrimônio. Um erro de
    ordem numa feature nova apagaria dois comportamentos antigos, de hora em hora, calado.

    O erro não some: vai para o log e para a resposta do cron, que é o que o Cloud Logging
    guarda. Engolir seria trocar um estrago barulhento por um silencioso.
    """
    try:
        linha = await db.fetch_one(sql)
        return int((linha or {}).get("n", 0) or 0)
    except Exception as erro:  # noqa: BLE001 — um passo não derruba os outros
        log.exception("cron: passo %s falhou", nome)
        erros[nome] = str(erro)
        return 0


async def run() -> dict:
    agora = now_utc()
    erros: dict[str, str] = {}
    criadas = await materialize_horizon(agora)

    fechadas = await _passo("close_invoices", "select public._close_due_invoices() as n", erros)
    # Depois de FECHAR e antes de promover: a fatura vencida dos cartões com rotativo ligado vai
    # para a próxima. Ordem importa — adiar antes de fechar deixaria a fatura do ciclo corrente
    # fora do alcance da varredura.
    adiadas = await _passo("roll_overdue", "select public._roll_overdue_invoices() as n", erros)
    # A fatura paga em parte que venceu, e a adiada: as compras e parcelas dela ficam pagas
    # (`20260927130000`). O gatilho cobre as mudanças da fatura; o vencimento que passa com o
    # dia só esta rodada vê.
    liquidadas = await _passo("liquidar", "select public._liquidar_faturas_vencidas() as n", erros)
    try:
        gemeas = await reparar_gemeas()
    except Exception as erro:  # noqa: BLE001 — um passo não derruba os outros
        log.exception("cron: passo gemeas falhou")
        erros["gemeas"] = str(erro)
        gemeas = 0
    promovidas = await _passo("promote", "select public._promote_due_transactions() as n", erros)
    fotos = await _passo("snapshot", "select public._snapshot_net_worth() as n", erros)

    resultado = {
        "created": criadas,
        "invoices_closed": fechadas,
        "invoices_rolled": adiadas,
        "lines_settled": liquidadas,
        "twins_repaired": gemeas,
        "promoted": promovidas,
        "snapshots": fotos,
    }
    if erros:
        resultado["errors"] = erros
    return resultado


async def reparar_gemeas() -> int:
    """Desfaz a duplicata que nasceu ANTES de `_adotar_gemea` existir (27/09/2026).

    Série apagada deixa as ocorrências passadas soltas (`recurring_id` nulo, `source='recurring'`
    — só uma série apagada produz isso); recriada, o agendador gerava a mesma ocorrência ao lado.
    Aqui a GERADA sai e a antiga volta para a série. Só o par idêntico: mesmo espaço, tipo, valor,
    conta, dia, título (sem acento e caixa) e estado, com a solta criada ANTES. Aprovado pelo dono
    do produto para o Fundacred de 04/09 de produção, que tirava R$ 1.198,85 a mais da conta.
    """
    pares = await db.fetch(
        """
        select g.id as gerada, o.id as solta, g.recurring_id
        from public.transactions g
        join public.transactions o
          on o.workspace_id = g.workspace_id and o.recurring_id is null and o.source = 'recurring'
         and o.kind = g.kind and o.amount_cents = g.amount_cents and o.status = g.status
         and o.account_id is not distinct from g.account_id and o.occurred_at = g.occurred_at
         and o.counterparty_account_id is not distinct from g.counterparty_account_id
         and extensions.unaccent(lower(coalesce(o.description, '')))
             = extensions.unaccent(lower(coalesce(g.description, '')))
         and o.created_at < g.created_at
        where g.recurring_id is not null and g.source = 'recurring'
        limit 50
        """
    )
    reparados = 0
    vistas: set = set()
    for par in pares:
        if par["solta"] in vistas or par["gerada"] in vistas:
            continue
        vistas.update({par["solta"], par["gerada"]})
        # Primeiro sai a gerada: o unique `(recurring_id, occurred_at)` recusaria a adoção antes.
        # Um par recusado (ex.: fatura paga em parte) não impede o reparo dos seguintes.
        try:
            await db.execute(
                "delete from public.transactions where id = %s and recurring_id is not null", par["gerada"]
            )
            await db.execute(
                "update public.transactions set recurring_id = %s where id = %s and recurring_id is null",
                par["recurring_id"], par["solta"],
            )
        except Exception:  # noqa: BLE001
            log.exception("cron: par de gêmeas recusado, segue para o próximo")
            continue
        reparados += 1
    return reparados


async def _materialize_occurrence(rec, dia: str, ja_aconteceu: bool) -> dict:
    """Lock/CAS and dated tuple, adoption or insert share one database snapshot.

    The WHERE belongs to the base row being locked: PostgreSQL rechecks the
    captured revision after a concurrent writer releases it. An obsolete fetch
    produces no financial write. Genuine null version values stay null.
    """
    return await db.fetch_one(
        """
        with locked_series as materialized (
          select r.* from public.recurring_transactions r
          where r.id = %s and r.edit_revision = %s and r.rrule = %s
            and r.dtstart is not distinct from %s and r.active
          for share of r
        ), input as (
          select %s::date as day, %s::boolean as past
        ), dated as materialized (
          select r.*, i.day, i.past,
            case when v.recurring_id is not null then v.kind else r.kind end as occurrence_kind,
            case when v.recurring_id is not null then v.amount_cents else r.amount_cents end as occurrence_amount,
            case when v.recurring_id is not null then v.category else r.category end as occurrence_category,
            case when v.recurring_id is not null then v.description else r.description end as occurrence_description,
            case when v.recurring_id is not null then v.account_id else r.account_id end as occurrence_account,
            -- só a transferência tem destino; a versão sem a coluna preenchida cai na série
            case when (case when v.recurring_id is not null then v.kind else r.kind end) = 'transfer'
                 then coalesce(v.counterparty_account_id, r.counterparty_account_id) end as occurrence_counterparty,
            private.payment_method_at(r.id,i.day) as occurrence_method,
            private.recurring_subcategory_at(r.id,i.day) as occurrence_child
          from locked_series r cross join input i
          left join lateral (
            select h.* from private.recurring_history_versions h
            where h.recurring_id=r.id and h.workspace_id=r.workspace_id
              and h.valid_from<=i.day and (h.valid_through is null or h.valid_through>=i.day)
            order by h.valid_from desc limit 1
          ) v on true
        ), candidate as materialized (
          select t.id from public.transactions t join dated d on t.workspace_id=d.workspace_id
          where d.past and t.recurring_id is null and t.kind=d.occurrence_kind
            and t.amount_cents=d.occurrence_amount and t.account_id is not distinct from d.occurrence_account
            and t.counterparty_account_id is not distinct from d.occurrence_counterparty
            and t.occurred_at=d.day
            and extensions.unaccent(lower(coalesce(t.description,'')))
                =extensions.unaccent(lower(coalesce(d.occurrence_description,'')))
            and (t.subcategory_id is null or exists (
              select 1 from public.subcategories c where c.id=t.subcategory_id
                and c.workspace_id=t.workspace_id and c.parent_key=private.fold(t.category)))
            and not exists(select 1 from public.transactions own where own.recurring_id=d.id and own.occurred_at=d.day)
          order by t.created_at,t.id limit 1
        ), adopted as (
          update public.transactions t set recurring_id=d.id, subcategory_snapshot_set=true
          from dated d,candidate c where t.id=c.id and t.recurring_id is null
          returning t.id
        ), inserted as (
          insert into public.transactions
            (user_id,workspace_id,kind,amount_cents,currency,category,description,merchant,account_id,
             counterparty_account_id,occurred_at,due_at,source,status,recurring_id,auto_confirm,payment_method,subcategory_id,subcategory_snapshot_set)
          select d.user_id,d.workspace_id,d.occurrence_kind,d.occurrence_amount,d.currency,d.occurrence_category,
            d.occurrence_description,d.merchant,d.occurrence_account,d.occurrence_counterparty,d.day,d.day,'recurring',
            case when d.past and d.auto_confirm then 'cleared' else 'pending' end,
            d.id,d.auto_confirm,d.occurrence_method,d.occurrence_child,true
          from dated d where not exists(select 1 from adopted)
          on conflict (recurring_id,occurred_at) where recurring_id is not null do nothing
          returning id
        )
        select exists(select 1 from locked_series) as intent_current,
               exists(select 1 from inserted) as created
        """,
        rec["id"], rec["edit_revision"], rec["rrule"], rec["dtstart"], dia, ja_aconteceu,
    )


async def materialize_horizon(agora, so_novas: bool = False, workspace_id=None) -> int:
    """Cria as ocorrências que ainda faltam dentro do horizonte.

    ⚠️ **A query pega quem PRECISA de trabalho, e os mais atrasados primeiro.**

    Ela era `where r.active = true limit 200`, sem filtro e sem ordem, e isso tinha dois
    defeitos que só apareceriam com escala:

      • **Trabalho à toa.** Toda hora ela relia as 200 séries inteiras — inclusive as já
        materializadas até o fim do horizonte — para descobrir que não havia nada a criar.
        Com o horizonte em um ano, a esmagadora maioria das rodadas não tem NADA a fazer, e
        agora elas custam um index scan em vez de 200 expansões de RRULE.

      • **Inanição.** Sem `order by`, "as primeiras 200" é o que o Postgres achar primeiro — e
        isso é estável o bastante para as MESMAS 200 ganharem toda hora. Passando de 200 séries
        ativas no banco (uns 13 usuários como o atual), as de fora nunca seriam materializadas,
        e o usuário veria meses vazios sem erro nenhum em lugar nenhum.

    `materialized_until asc nulls first` inverte isso: quem está mais atrasado passa na frente,
    e o `limit` deixa de ser um recorte arbitrário para virar orçamento por rodada.

    O índice que sustenta isso é `recurring_pendentes_idx` (`20260910230000`), parcial em
    `active` — ele só indexa as séries que o cron pode querer.
    """
    horizonte = agora + timedelta(days=HORIZON_DAYS)
    # `so_novas`: o cron de 1 minuto passa aqui só pelas séries que NUNCA foram materializadas
    # (recém-criadas, ou com o calendário refeito por `update_recurring_series`, que zera a
    # coluna). Esperando a rodada de hora em hora, a série nova ficava até 60 min sem nenhuma
    # ocorrência: a projeção só mostrava o mês da regra e "Ver ocorrências" abria vazio
    # (27/09/2026, produção). As já materializadas continuam na rodada de hora em hora.
    # ponytail: série cuja primeira ocorrência cai além do horizonte segue nula e é relida a cada
    # minuto (um `limit` pequeno segura o custo); marcar "sem ocorrência" se isso aparecer.
    # `workspace_id`: o agente pede só o espaço da conversa antes de procurar o que dar baixa
    # (`nodes.alvos`) — "paguei o aluguel" de uma série que o cron ainda não gravou (28/09/2026).

    series = await db.fetch(
        """
        select r.id, r.user_id, r.workspace_id, r.kind, r.amount_cents, r.currency,
               r.category, r.description, r.merchant, r.account_id, r.rrule, r.next_run_at,
               r.dtstart, r.end_date, r.auto_confirm, r.materialized_until, r.edit_revision,
               r.paused_from, r.paused_until, p.timezone
        from public.recurring_transactions r
        left join public.profiles p on p.id = r.user_id
        where r.active = true
          and (r.materialized_until is null or r.materialized_until < %s)
          and (r.end_date is null or r.end_date >= %s)
          and (%s::uuid is null or r.workspace_id = %s::uuid)
          and (not %s or r.materialized_until is null)
          -- transferência antiga sem destino não gera nada: a tela pede o destino antes
          and not (r.kind = 'transfer' and r.counterparty_account_id is null)
        order by r.materialized_until asc nulls first
        limit %s
        """,
        horizonte,
        agora.date(),
        workspace_id,
        workspace_id,
        so_novas,
        MAX_NOVAS_POR_MINUTO if so_novas else MAX_SERIES_PER_RUN,
    )
    criadas = 0

    for rec in series:
        fuso = rec["timezone"] or DEFAULT_TIMEZONE
        # âncora imutável da série: sem ela a hora de parede derivaria a cada rodada
        dtstart = rec["dtstart"] or rec["next_run_at"]

        try:
            # O dia que a pessoa apagou (ou tirou do lugar com "Só esta") não volta: o app grava a
            # data em `recurring_moved_occurrences` (`20260928210000`), a mesma lista que a
            # leitura de previstas respeita. Sem isto, uma série com o calendário refeito
            # (`materialized_until` zerado) recriaria o dia apagado.
            suprimidas = {
                linha["original_date"].isoformat()
                for linha in await db.fetch(
                    "select original_date from private.recurring_moved_occurrences where recurring_id = %s",
                    rec["id"],
                )
            }
            # retoma de onde parou; na primeira vez, de um instante ANTES da
            # próxima ocorrência (para que ela mesma seja gerada)
            cursor = rec["materialized_until"] or (rec["next_run_at"] - timedelta(seconds=1))
            ultima = rec["materialized_until"]
            geradas = 0
            obsolete = False

            while geradas < MAX_OCCURRENCES_PER_SERIES:
                occ = next_occurrence(rec["rrule"], cursor, fuso, dtstart)
                if occ is None or occ > horizonte:
                    break
                dia = local_iso_date(fuso, occ)
                if rec["end_date"] and dia > rec["end_date"].isoformat():
                    break
                if dia in suprimidas or em_pausa(dia, rec.get("paused_from"), rec.get("paused_until")):
                    cursor = occ
                    ultima = occ
                    geradas += 1
                    continue

                ja_aconteceu = occ <= agora
                try:
                    outcome = await _materialize_occurrence(rec, dia, ja_aconteceu)
                    if not outcome["intent_current"]:
                        obsolete = True
                        break
                    criadas += int(outcome["created"])
                except UniqueViolation:
                    # A concurrent app adoption may own this date already. The statement
                    # rolled back atomically; the unique occurrence prevents a duplicate.
                    pass

                cursor = occ
                ultima = occ
                geradas += 1

            if obsolete:
                # A legitimate edit won the CAS. Do not publish this fetched cursor
                # or a last_error; the next cron reads the new intent. Adoption can
                # itself bump the parent revision, safely requiring that next pass.
                continue

            # next_run_at continua sendo a PRÓXIMA ocorrência FUTURA (é o que o
            # app mostra), independente de quanto já foi materializado à frente
            proxima = next_occurrence(rec["rrule"], agora, fuso, dtstart)
            encerrou = proxima is None or (
                rec["end_date"] is not None
                and local_iso_date(fuso, proxima) > rec["end_date"].isoformat()
            )
            await db.execute(
                """
                update public.recurring_transactions
                set dtstart = %s, materialized_until = coalesce(%s, materialized_until),
                    next_run_at = %s, active = %s, run_attempts = 0, last_error = null
                where id = %s and rrule = %s and dtstart is not distinct from %s and edit_revision = %s
                """,
                dtstart,
                ultima,
                (ultima or rec["next_run_at"]) if encerrou else proxima,
                not encerrou,
                rec["id"],
                # Só se a regra ainda é a que foi lida: reagendada no meio desta rodada
                # (`update_recurring_series`), gravar isto por cima desfaria o reset dela.
                rec["rrule"],
                rec["dtstart"],
                rec["edit_revision"],
            )
        except Exception as err:  # noqa: BLE001
            log.exception("série %s falhou", rec["id"])
            await db.execute(
                "update public.recurring_transactions set last_error = %s where id = %s and edit_revision = %s",
                repr(err)[:2000],
                rec["id"],
                rec["edit_revision"],
            )

    return criadas
