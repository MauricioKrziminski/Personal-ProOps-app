"""Rascunho de lançamento: o que fazer com uma extração incompleta.

O usuário diz "comprei um mac em 12x". A intenção é inequívoca e o valor não
está lá. Havia duas saídas ruins:

- **descartar** — ele repete a frase inteira, e o agente parece surdo;
- **travar** a conversa na pergunta — ele não pode mudar de assunto, e um "anota
  aí que preciso de café" no meio vira confusão ou perda.

O rascunho é a terceira: fica inerte no banco, a vida segue, e ele volta quando
o dado chegar.

Divisão de trabalho, igual à da confirmação: **SE a mensagem responde ao
rascunho é semântico** (o modelo decide, porque "foi 5 mil", "5000", "custou
cinco mil" e "esquece isso" não cabem numa lista de padrões); **QUAL é o número
é parse determinístico** (`parse_valor_em_centavos`, que só aceita UM valor
plausível).
"""

from __future__ import annotations

import logging

from app.domain.money import parse_valor_em_centavos

log = logging.getLogger(__name__)

_PROMPT = """O usuário tem um lançamento pela metade. Faltou este dado: {pergunta}

Classifique a mensagem dele em `decision`:
- answer     — está respondendo o dado que faltava ("foi 5000", "5 mil", "no nubank")
- discard    — está desistindo daquele lançamento ("esquece", "deixa pra lá", "cancela aquilo")
- unrelated  — é outro assunto ("anota comprar café", "quanto gastei esse mês?")

Quando for `answer` e a pergunta for sobre CONTA ou CARTÃO, preencha também
`extracted_value` com o nome próprio da conta, limpo, sem o resto da conversa:

- "usei o meu nubank que criei ontem"                  -> "nubank"
- "acabei de criar um pelo app, chama nubank cartao"   -> "nubank cartao"
- "foi no itaú mesmo"                                  -> "itaú"

Não invente nome: se ele não citou nenhum, deixe `extracted_value` vazio.

Na dúvida, responda unrelated: mexer no rascunho errado é pior que não mexer."""


async def _classificar(texto: str, pergunta: str) -> tuple[str, str]:
    """`(decisão, entidade extraída)` numa chamada só.

    Classificar e extrair juntos não é economia de linha, é de cota: separar
    dobraria a latência de toda resposta de slot e comeria duas das 500
    requisições diárias do Flash-Lite para chegar no mesmo resultado.
    """
    from app.graph.schemas import DraftDecision
    from app.security import wrap_untrusted
    from app.services.gemini import structured

    modelo = structured(DraftDecision)
    resposta = await modelo.ainvoke(
        [
            ("system", _PROMPT.format(pergunta=pergunta or "o valor")),
            ("human", wrap_untrusted("user_input", texto)),
        ]
    )
    return resposta.decision, (resposta.extracted_value or "").strip()


async def interpretar(texto: str, rascunho: dict, uso: dict | None = None) -> dict | None:
    """O que fazer com o rascunho, ou None para deixá-lo intacto.

    `{"acao": "completar", "amount_cents": N}` · `{"acao": "descartar"}` · None.

    `uso` é o contador de chamadas de modelo do turno: este fast-path roda FORA
    do grafo, então ninguém somaria por ele — e é a contagem de `ai_events` que
    o paywall mensal usa.
    """
    if not texto or not texto.strip():
        return None
    try:
        decisao, entidade = await _classificar(texto, rascunho.get("missing", ""))
    except Exception:  # noqa: BLE001
        # falha fechada: sem classificação, o rascunho fica onde está
        log.warning("classificador de rascunho falhou — mantendo o rascunho", exc_info=True)
        return None
    if uso is not None:
        uso["llm_calls"] = uso.get("llm_calls", 0) + 1

    if decisao == "discard":
        return {"acao": "descartar"}
    if decisao != "answer":
        return None

    slot = rascunho.get("slot") or "amount"
    if slot == "account":
        # A entidade extraída pelo modelo, não a frase inteira: era isso que
        # fazia "acabei de criar um pelo app, chama nubank cartao" virar o nome
        # do cartão. O texto cru fica só como rede quando o modelo não extraiu.
        # Quem casa contra o banco é o worker, que tem o workspace.
        nome = entidade or texto.strip()
        return {"acao": "completar", "slot": "account", "account": nome} if nome else None

    # O NÚMERO continua sendo determinístico, sempre. Deixar o modelo escolher o
    # valor reabriria a porta que o `parse` fechou: ele só aceita UM número
    # plausível, e chutar entre dois é como o valor errado entra no banco.
    valor = parse_valor_em_centavos(texto)
    if valor is None:
        # O modelo achou que é resposta, mas não há número extraível ("foi caro").
        # Completar assim recriaria o "registrar None em 12x" por outra porta.
        return None
    return {"acao": "completar", "slot": "amount", "amount_cents": valor}


def mesclar(acao_guardada: dict, decidido: dict) -> dict:
    """Preenche o slot respondido, sem sobrescrever o que já estava lá."""
    juntado = dict(acao_guardada)
    if decidido.get("slot") == "account":
        if not juntado.get("account"):
            juntado["account"] = decidido["account"]
    elif not juntado.get("amount_cents"):
        juntado["amount_cents"] = decidido["amount_cents"]
    return juntado


def sem_cartoes(nome: str = "") -> str:
    """Não há o que listar: o usuário não tem cartão nenhum cadastrado.

    Único caminho que continua sendo texto puro — Lista Interativa vazia não
    existe. Mantém o rascunho vivo de propósito: jogar no fallback genérico
    apagaria de vista uma compra que está a UM dado de ficar pronta.

    ⚠️ Esta mensagem NÃO oferece mais "criar" nem "sem cartão". As duas eram
    promessas sem handler: quem respondia isso era classificado `answer`, virava
    nome de cartão, falhava a validação e recebia a mesma mensagem em loop.
    """
    alvo = f" *{nome}*" if nome else ""
    return (
        f"❌ Não achei o cartão{alvo} — você ainda não tem nenhum cartão cadastrado.\n"
        "Cadastra ele no app e me fala o nome, ou responde *cancelar* para desistir."
    )


# ---------------------------------------------------------------------------
# clique na lista de cartões
# ---------------------------------------------------------------------------
# `ds:<uuid do rascunho>:<sufixo>`. Prefixo PRÓPRIO, e não `pa:` reusando
# `pending_actions`: a 0043 explica que um rascunho ali ocuparia o índice
# `pending_actions_one_open_per_thread` e bloquearia toda confirmação real da
# conversa — que é o oposto da troca livre de contexto que o rascunho existe
# para permitir.
#
# O uuid vai DENTRO do id pelo mesmo motivo de `parse_click`: botão do WhatsApp
# continua clicável para sempre, e um toque numa lista de ontem escolheria o
# cartão de uma compra que não é mais essa.

CLICK_PREFIX = "ds:"
_CANCELAR = "no"
_ESCOLHA = "c:"


def parse_slot_click(clicked_id: str, draft_id: str) -> dict | None:
    """Decisão do clique, ou None se o id não se refere a ESTE rascunho.

    Igualdade exata, campo a campo — o payload foi escrito por nós, não há o que
    interpretar. O `account_id` que volta é do USUÁRIO: quem chama tem que
    procurá-lo na lista de cartões do workspace antes de usar.
    """
    if not clicked_id or not clicked_id.startswith(CLICK_PREFIX):
        return None
    partes = clicked_id[len(CLICK_PREFIX):].split(":", 1)
    if len(partes) != 2:
        return None
    uuid_do_clique, sufixo = partes
    if uuid_do_clique.lower() != str(draft_id).lower():
        return None

    if sufixo == _CANCELAR:
        return {"acao": "descartar"}
    if sufixo.startswith(_ESCOLHA):
        escolhido = sufixo[len(_ESCOLHA):]
        return {"acao": "completar", "slot": "account", "account_id": escolhido} if escolhido else None
    return None


def lembrete(rascunho: dict) -> str:
    """A frase discreta que lembra do rascunho. Template puro, zero modelo."""
    trecho = (rascunho.get("raw_text") or "").strip()
    if len(trecho) > 60:
        trecho = trecho[:59] + "…"
    return f"(Ainda tenho seu rascunho — *{trecho}*. É só me mandar o valor quando quiser.)"
