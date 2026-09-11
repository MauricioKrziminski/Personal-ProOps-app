"""Informação incompleta: o agente PERGUNTA ou ele SUPÕE?

Regra do dono do produto (11/09/2026): *"ele tem que perguntar sempre que tiver
dúvida, nunca deduzir. Isso para qualquer situação do agente."* Esta sonda mede
isso — com o Gemini de verdade e lendo o STAGING de verdade, porque o defeito que
ela procura só existe quando o dado real não bate com o que a frase disse.

**Nenhuma escrita acontece.** `db.fetch_one`/`fetch`/`execute` passam por um
filtro: SQL de leitura vai para o banco, SQL de escrita (insert/update/delete e
`select public.<rpc>`) é REGISTRADO e devolve uma linha falsa. Um caso que
escreve aparece no relatório como ESCREVEU, que é justamente a reprovação.

    agent/.venv/bin/python agent/scripts/probe_pergunta_ou_supoe.py
    agent/.venv/bin/python agent/scripts/probe_pergunta_ou_supoe.py --secao conta
"""

import argparse
import asyncio
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db  # noqa: E402

# ---------------------------------------------------------------------------
# os casos
# ---------------------------------------------------------------------------
# `espera`: "pergunta" = tem que parar e perguntar; "confirma" = pode seguir,
# mas só atrás de uma confirmação que DIGA o que vai acontecer; "ok" = pode
# executar direto (a informação estava completa, ou o que faltou tem preferência
# gravada pelo usuário).
CASOS: list[tuple[str, str, str, str]] = [
    # seção,   frase,                                               espera,     por quê
    ("conta", "gastei 45 no bradesco", "pergunta",
     "não existe Bradesco cadastrado — antes isso caía na conta padrão"),
    ("conta", "gastei 120 no nubank", "pergunta",
     "há conta E cartão Nubank: o ramo exato pegava o primeiro do banco"),
    ("conta", "transferi 200 da poupança pro banco do brasil", "pergunta",
     "o destino não existe"),
    ("conta", "comprei uma tv em 10x de 300 no santander", "pergunta",
     "não há cartão Santander"),
    ("conta", "gastei 45 no mercado", "ok",
     "não citou conta: cai na conta padrão, que é preferência gravada"),

    ("valor", "gastei no mercado hoje", "pergunta", "sem valor"),
    ("valor", "comprei um celular parcelado no nubank", "pergunta",
     "sem valor e sem número de parcelas"),
    ("valor", "paguei o dentista", "pergunta", "sem valor"),

    ("fatura", "paguei a fatura do nubank", "confirma",
     "qual fatura (são várias em aberto) e de onde sai o dinheiro"),
    ("fatura", "quita a fatura", "pergunta", "não disse de qual cartão"),
    ("fatura", "paguei 800 da fatura", "pergunta", "não disse de qual cartão"),
    ("fatura", "adia a fatura", "pergunta", "não disse de qual cartão"),

    ("cadastro", "cadastra um cartão novo", "pergunta",
     "sem nome, fechamento e vencimento"),
    ("cadastro", "cadastra o cartão inter", "pergunta",
     "falta fechamento e vencimento"),
    ("cadastro", "cria uma meta", "pergunta", "sem nome e sem alvo"),
    ("cadastro", "cadastra uma dívida de 5000", "pergunta",
     "sem nome, tipo e modo de cálculo"),
    ("cadastro", "cria um orçamento de mercado", "pergunta", "sem limite"),
    ("cadastro", "cadastra um bem", "pergunta", "sem nome, classe e valor"),
    ("cadastro", "muda meu ciclo", "pergunta", "não disse o dia"),
    ("cadastro", "liga o rotativo", "pergunta", "não disse de qual cartão"),

    ("recorrente", "todo mês pago academia", "pergunta", "sem valor"),
    ("recorrente", "me lembra de pagar o aluguel", "pergunta",
     "sem quando — lembrete exige data/regra"),

    ("alvo", "apaga o gasto do mercado", "confirma",
     "há mais de um mercado: tem que perguntar qual, e apagar sempre confirma"),
    ("alvo", "muda a conta do gasto do mercado para o banco do brasil", "pergunta",
     "a conta de destino não existe"),

    ("data", "gastei 45 no mercado dia 45", "pergunta", "data impossível"),
    ("limite", "paguei 99999 da fatura do nubank", "pergunta",
     "passa do que está em aberto"),

    # --- a outra metade: informação COMPLETA não pode virar pergunta ---------
    # Uma sonda que só mede "perguntou?" é passada por um agente que pergunta
    # tudo — e um agente que pergunta tudo é inútil. Estes casos reprovam o
    # excesso de zelo.
    ("completo", "gastei 45 no mercado no nubank cartão", "ok",
     "conta citada existe e o resto está completo"),
    ("completo", "recebi 3000 de salário", "ok", "receita completa, sem conta citada"),
    ("completo", "comprei uma tv em 10x de 300 no nubank cartão", "confirma",
     "parcelado completo: confirma porque passa do teto do HITL"),
    ("completo", "quanto gastei esse mês?", "ok", "consulta não pergunta nada"),
    ("completo", "qual meu saldo?", "ok", "consulta"),
    ("completo", "meu mês fecha dia 10", "confirma", "cadastro completo"),
    ("completo", "anota que preciso ligar pro contador", "ok", "nota livre"),

    # --- ambiguidade de ALVO, com a informação toda presente -----------------
    ("empate", "apaga o último lançamento", "confirma",
     "apagar sempre confirma, mesmo com alvo único"),
]

ESCRITA = re.compile(
    r"^\s*(insert|update|delete)\b|select\s+public\.(pay_invoice|settle_invoice|goal_deposit"
    r"|create_installment_plan|roll_invoice|pay_debt_installment|update_asset_value|save_budget"
    r"|update_transaction_scoped|update_recurring_series|mark_)",
    re.I,
)


class Espiao:
    """Deixa ler, registra o que tentaria escrever."""

    def __init__(self) -> None:
        self.escritas: list[str] = []
        self._fetch_one = db.fetch_one
        self._fetch = db.fetch
        self._execute = getattr(db, "execute", None)

    def _e_escrita(self, sql: str) -> bool:
        # `insert into pending_actions/ai_events/executed_actions/messages` é
        # infraestrutura do próprio turno — não é dado do usuário e precisa
        # rodar, senão o HITL não tem onde gravar a pergunta.
        if re.search(r"(pending_actions|ai_events|executed_actions|messages_queue|"
                     r"user_sessions|app_chat|draft|langgraph)", sql, re.I):
            return False
        return bool(ESCRITA.search(sql))

    def instalar(self, monkey) -> None:
        espiao = self

        async def fetch_one(sql, *args):
            if espiao._e_escrita(sql):
                espiao.escritas.append(sql.strip().split("\n")[0][:90])
                return {"id": str(uuid.uuid4())}
            return await espiao._fetch_one(sql, *args)

        async def fetch(sql, *args):
            if espiao._e_escrita(sql):
                espiao.escritas.append(sql.strip().split("\n")[0][:90])
                return []
            return await espiao._fetch(sql, *args)

        monkey(db, "fetch_one", fetch_one)
        monkey(db, "fetch", fetch)
        if espiao._execute:
            async def execute(sql, *args):
                if espiao._e_escrita(sql):
                    espiao.escritas.append(sql.strip().split("\n")[0][:90])
                    return None
                return await espiao._execute(sql, *args)

            monkey(db, "execute", execute)


def _texto(resposta) -> str:
    if isinstance(resposta, dict):
        return " ".join(
            str(resposta.get(k, "")) for k in ("body", "text", "summary")
        )
    return str(resposta or "")


def _classifica(resposta, escritas: list[str]) -> str:
    """PERGUNTOU · CONFIRMOU · EXECUTOU — pela forma da resposta, não pelo texto."""
    if isinstance(resposta, dict) and (resposta.get("buttons") or resposta.get("rows")):
        corpo = _texto(resposta)
        # Botão "Confirmar/Cancelar" é confirmação; lista de candidatos é pergunta.
        if resposta.get("rows") or "qual" in corpo.lower():
            return "PERGUNTOU"
        return "CONFIRMOU"
    texto = _texto(resposta)
    if escritas:
        return "EXECUTOU"
    # Sem escrita nenhuma, o que resta é decidir se o agente PEDIU alguma coisa.
    # "?" cobre a maioria; "informe X. Ainda não salvei nada." é a frase padrão
    # do catálogo de cadastros e não tem interrogação.
    pediu = "?" in texto or re.search(
        r"ainda não salvei|informe |me (fala|diz|informa)|qual (é|e|o|a) |diga (o|um|qual)",
        texto, re.I
    )
    if any(s in texto for s in ("🤔", "❌", "🙋")) or pediu:
        return "PERGUNTOU"
    return "RESPONDEU"


ACEITA = {
    "pergunta": {"PERGUNTOU"},
    "confirma": {"PERGUNTOU", "CONFIRMOU"},
    "ok": {"EXECUTOU", "CONFIRMOU", "RESPONDEU"},
}


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--secao")
    args = ap.parse_args()

    casos = [c for c in CASOS if not args.secao or c[0] == args.secao]
    # O custo deste projeto está nas suítes, não no tráfego — então ele aparece
    # ANTES de gastar. Cada caso é um turno: router + domínio, os dois no
    # Flash-Lite (500/dia grátis). O gate (Flash, 20/dia) não entra aqui:
    # mensagem nova nunca passa pelo classificador de SIM/NÃO.
    print(f"{len(casos)} turnos · ~{len(casos) * 2} chamadas ao Gemini, "
          f"todas no Flash-Lite.\n")

    await db.open_pools()

    from app.graph import build as graph_build

    await graph_build.setup()

    linha = await db.fetch_one(
        "select id from auth.users where email = 'dev@proops.local'"
    )
    if not linha:
        print("✗ usuário de teste não existe no banco apontado pelo .env")
        return 1
    user_id = linha["id"]
    perfil = await db.chat_profile(user_id)

    import contextlib

    from app import conversation

    originais: list[tuple] = []

    def monkey(mod, nome, valor):
        originais.append((mod, nome, getattr(mod, nome)))
        setattr(mod, nome, valor)

    falhas = 0
    criadas: list = []
    secao_atual = ""
    for secao, frase, espera, motivo in casos:
        if secao != secao_atual:
            print(f"\n### {secao}")
            secao_atual = secao

        espiao = Espiao()
        espiao.instalar(monkey)

        # ⚠️ Sessão de VERDADE, uma por caso. `pending_actions.session_id` tem
        # FK: com um uuid inventado o turno estoura ao gravar a pergunta — e o
        # relatório culparia o agente por um defeito do arranjo.
        #
        # Thread nova por caso porque pergunta pendente de um caso não pode ser
        # lida como resposta do próximo (é o fast-path de confirmação).
        thread = f"probe-{uuid.uuid4()}"
        sessao_row, _ = await db.create_chat_session(
            user_id=user_id,
            workspace_id=perfil["workspace_id"],
            title=frase[:60],
            first_client_message_id=uuid.uuid4(),
            thread_id=thread,
            timezone_=perfil.get("timezone") or "America/Sao_Paulo",
        )
        sessao = {**sessao_row, "phone": None, "channel": "app",
                  "session_epoch": sessao_row.get("session_epoch") or 0,
                  "user_id": user_id, "workspace_id": perfil["workspace_id"],
                  "timezone": perfil.get("timezone") or "America/Sao_Paulo"}
        criadas.append(sessao_row["id"])

        explodiu = ""
        try:
            resposta = await conversation.run_turn(
                sessao,
                source_message_id=f"probe:{uuid.uuid4()}",
                conteudo={"text": frase},
            )
        except Exception as err:  # noqa: BLE001
            # Exceção NÃO é pergunta. Sem esta marca separada, um "❌" de crash
            # contava como o agente tendo perguntado — o relatório ficaria verde
            # justamente quando o turno morreu.
            resposta = None
            explodiu = f"{type(err).__name__}: {err}"
        finally:
            for mod, nome, valor in reversed(originais):
                setattr(mod, nome, valor)
            originais.clear()

        got = "EXPLODIU" if explodiu else _classifica(resposta, espiao.escritas)
        ok = got in ACEITA[espera] and not (espera != "ok" and espiao.escritas)
        if not ok:
            falhas += 1
        marca = "ok  " if ok else "FALHOU"
        print(f"{marca} {frase!r:56} {got:10} (esperado: {espera})")
        if not ok:
            print(f"       motivo: {motivo}")
            print(f"       resposta: {(explodiu or _texto(resposta))[:220]!r}")
            if espiao.escritas:
                print(f"       ESCREVEU: {espiao.escritas}")

    for sid in criadas:
        with contextlib.suppress(Exception):
            await db.execute("delete from public.user_sessions where id = %s", sid)

    print(f"\n{len(casos) - falhas}/{len(casos)}")
    with contextlib.suppress(Exception):
        await db.close_pools()
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
