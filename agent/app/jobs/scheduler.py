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
from app.domain.recurrence import next_occurrence

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
        await db.execute(
            "delete from public.transactions where id = %s and recurring_id is not null", par["gerada"]
        )
        await db.execute(
            "update public.transactions set recurring_id = %s where id = %s and recurring_id is null",
            par["recurring_id"], par["solta"],
        )
        reparados += 1
    return reparados


async def _adotar_gemea(rec, dia: str) -> bool:
    """A ocorrência PASSADA que já existe como lançamento solto é adotada, não criada de novo.

    27/09/2026, produção: a pessoa apagou a série do Fundacred (o setembro PAGO ficou — é histórico,
    `recurring_drop_future` só leva as futuras em aberto) e a recriou começando em 04/09 com "entra
    como pago". O agendador lançou outro 04/09 pago ao lado, e a conta corrente caiu R$ 1.198,85 a
    mais. O mesmo vale para quem lança a conta à mão e depois cria a série. Gêmea = mesmo espaço,
    tipo, valor, conta, dia e título (sem acento e caixa), e nenhuma série dona.
    """
    gemea = await db.fetch_one(
        """
        select id from public.transactions
        where workspace_id = %s and recurring_id is null and kind = %s and amount_cents = %s
          and account_id is not distinct from %s and occurred_at = %s
          and extensions.unaccent(lower(coalesce(description, ''))) = extensions.unaccent(lower(coalesce(%s, '')))
        order by created_at
        limit 1
        """,
        rec["workspace_id"], rec["kind"], rec["amount_cents"], rec["account_id"], dia, rec["description"],
    )
    if not gemea:
        return False
    await db.execute(
        "update public.transactions set recurring_id = %s where id = %s and recurring_id is null",
        rec["id"], gemea["id"],
    )
    return True


async def materialize_horizon(agora, so_novas: bool = False) -> int:
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

    series = await db.fetch(
        """
        select r.id, r.user_id, r.workspace_id, r.kind, r.amount_cents, r.currency,
               r.category, r.description, r.merchant, r.account_id, r.rrule, r.next_run_at,
               r.dtstart, r.end_date, r.auto_confirm, r.materialized_until,
               p.timezone
        from public.recurring_transactions r
        left join public.profiles p on p.id = r.user_id
        where r.active = true
          and (r.materialized_until is null or r.materialized_until < %s)
          and (r.end_date is null or r.end_date >= %s)
          and (not %s or r.materialized_until is null)
        order by r.materialized_until asc nulls first
        limit %s
        """,
        horizonte,
        agora.date(),
        so_novas,
        MAX_NOVAS_POR_MINUTO if so_novas else MAX_SERIES_PER_RUN,
    )
    criadas = 0

    for rec in series:
        fuso = rec["timezone"] or DEFAULT_TIMEZONE
        # âncora imutável da série: sem ela a hora de parede derivaria a cada rodada
        dtstart = rec["dtstart"] or rec["next_run_at"]

        try:
            # retoma de onde parou; na primeira vez, de um instante ANTES da
            # próxima ocorrência (para que ela mesma seja gerada)
            cursor = rec["materialized_until"] or (rec["next_run_at"] - timedelta(seconds=1))
            ultima = rec["materialized_until"]
            geradas = 0

            while geradas < MAX_OCCURRENCES_PER_SERIES:
                occ = next_occurrence(rec["rrule"], cursor, fuso, dtstart)
                if occ is None or occ > horizonte:
                    break
                dia = local_iso_date(fuso, occ)
                if rec["end_date"] and dia > rec["end_date"].isoformat():
                    break

                ja_aconteceu = occ <= agora
                if ja_aconteceu and await _adotar_gemea(rec, dia):
                    cursor = occ
                    ultima = occ
                    geradas += 1
                    continue
                try:
                    await db.execute(
                        """
                        insert into public.transactions
                          (user_id, workspace_id, kind, amount_cents, currency, category,
                           description, merchant, account_id, occurred_at, due_at, source, status,
                           recurring_id, auto_confirm)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'recurring', %s, %s, %s)
                        """,
                        rec["user_id"], rec["workspace_id"], rec["kind"], rec["amount_cents"],
                        rec["currency"], rec["category"], rec["description"],
                        # o estabelecimento da série (`20260926120000`) vai para cada ocorrência
                        rec.get("merchant"), rec["account_id"],
                        dia, dia,
                        "cleared" if (ja_aconteceu and rec["auto_confirm"]) else "pending",
                        rec["id"],
                        # A ocorrencia HERDA o interruptor da serie. Sem isto ela nasceria com o
                        # `default false` da coluna e `_promote_due_transactions` (que agora olha a
                        # LINHA, nao a serie) nunca daria baixa nem no salario.
                        rec["auto_confirm"],
                    )
                    criadas += 1
                except UniqueViolation:
                    # ocorrência já materializada numa rodada anterior: segue
                    pass

                cursor = occ
                ultima = occ
                geradas += 1

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
                where id = %s and rrule = %s and dtstart is not distinct from %s
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
            )
        except Exception as err:  # noqa: BLE001
            log.exception("série %s falhou", rec["id"])
            await db.execute(
                "update public.recurring_transactions set last_error = %s where id = %s",
                repr(err)[:2000],
                rec["id"],
            )

    return criadas
