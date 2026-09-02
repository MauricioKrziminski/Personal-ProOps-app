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

Quando for `answer` e houver um NÚMERO, diga em `amount_type` o que ele significa
(o número em si não é seu — não repita nem calcule nada):

- "700 cada", "700 por mês", "700 a parcela"  -> per_installment
- "8400 no total", "saiu 8400", "ao todo"     -> total
- "700" (número solto, cabem as duas leituras) -> ambiguous

Quando o usuário disser quantas parcelas já pagou ("já paguei 2 parcelas", "já foram 2", "paguei duas"), preencha `already_paid_count` com essa quantidade inteira (ex: 2). Se ele não citou parcelas já pagas, deixe vazio.

Na dúvida entre total e per_installment, responda ambiguous: perguntar custa uma
mensagem, e registrar 12x errado custa o mês inteiro do usuário.

Na dúvida entre answer/discard/unrelated, responda unrelated: mexer no rascunho
errado é pior que não mexer."""


async def _classificar(texto: str, pergunta: str):
    """A `DraftDecision` inteira, numa chamada só.

    Classificar, extrair a entidade e qualificar o número juntos não é economia
    de linha, é de cota: cada campo separado dobraria a latência de toda resposta
    de slot e comeria mais uma das 500 requisições diárias do Flash-Lite para
    chegar no mesmo resultado.

    Devolve o objeto, e não uma tupla, porque o schema já cresceu duas vezes —
    tupla obriga toda chamadora e todo dublê a mudar de forma junto.
    """
    from app.graph.schemas import DraftDecision
    from app.security import wrap_untrusted
    from app.services.gemini import structured

    modelo = structured(DraftDecision)
    return await modelo.ainvoke(
        [
            ("system", _PROMPT.format(pergunta=pergunta or "o valor")),
            ("human", wrap_untrusted("user_input", texto)),
        ]
    )


async def interpretar(texto: str, rascunho: dict, uso: dict | None = None) -> dict | None:
    """O que fazer com o rascunho, ou None para deixá-lo intacto.

    `{"acao": "completar", ...}` · `{"acao": "descartar"}` ·
    `{"acao": "perguntar_tipo", ...}` · None.

    `uso` é o contador de chamadas de modelo do turno: este fast-path roda FORA
    do grafo, então ninguém somaria por ele — e é a contagem de `ai_events` que
    o paywall mensal usa.
    """
    if not texto or not texto.strip():
        return None
    try:
        decisao = await _classificar(texto, rascunho.get("missing", ""))
    except Exception:  # noqa: BLE001
        # falha fechada: sem classificação, o rascunho fica onde está
        log.warning("classificador de rascunho falhou — mantendo o rascunho", exc_info=True)
        return None
    if uso is not None:
        uso["llm_calls"] = uso.get("llm_calls", 0) + 1

    if decisao.decision == "discard":
        return {"acao": "descartar"}
    if decisao.decision != "answer":
        return None

    current_inst = (
        (decisao.already_paid_count or 0) + 1
        if decisao.already_paid_count is not None
        else None
    )

    slot = rascunho.get("slot") or "amount"
    if slot == "account":
        # A entidade extraída pelo modelo, não a frase inteira: era isso que
        # fazia "acabei de criar um pelo app, chama nubank cartao" virar o nome
        # do cartão. O texto cru fica só como rede quando o modelo não extraiu.
        # Quem casa contra o banco é o worker, que tem o workspace.
        nome = (decisao.extracted_value or "").strip() or texto.strip()
        if not nome:
            return None
        res = {"acao": "completar", "slot": "account", "account": nome}
        if current_inst is not None:
            res["current_installment"] = current_inst
        return res

    if slot in ("description", "identification"):
        item = (decisao.extracted_value or "").strip() or texto.strip()
        if not item:
            return None
        res = {"acao": "completar", "slot": "description", "description": item}
        if current_inst is not None:
            res["current_installment"] = current_inst
        return res

    # O NÚMERO continua sendo determinístico, sempre. O modelo diz o que ele
    # SIGNIFICA, nunca quanto ele é — medido em 31/08/2026, `parse` acerta
    # inclusive "12x de 700", então dar o número ao modelo só somaria um jeito
    # novo de gravar valor errado.
    valor = parse_valor_em_centavos(texto)
    if valor is None:
        # O modelo achou que é resposta, mas não há número extraível ("foi caro").
        # Completar assim recriaria o "registrar None em 12x" por outra porta.
        return None

    parcelas = _parcelas(rascunho.get("action") or {})
    if parcelas >= 2:
        if decisao.amount_type == "per_installment":
            res = {
                "acao": "completar",
                "slot": "amount",
                "amount_cents": valor,
                "por_parcela": True,
            }
            if current_inst is not None:
                res["current_installment"] = current_inst
            return res
        if decisao.amount_type == "ambiguous":
            # "700" numa compra de 12x são duas contas MUITO diferentes
            # (R$ 700 ou R$ 8.400). Perguntar custa uma mensagem; errar custa o
            # mês inteiro do usuário.
            res = {"acao": "perguntar_tipo", "amount_cents": valor, "installments": parcelas}
            if current_inst is not None:
                res["current_installment"] = current_inst
            return res
    res = {"acao": "completar", "slot": "amount", "amount_cents": valor}
    if current_inst is not None:
        res["current_installment"] = current_inst
    return res


def _parcelas(acao: dict) -> int:
    try:
        return int(acao.get("installments") or 0)
    except (TypeError, ValueError):
        return 0


def com_total(decidido: dict | None, acao: dict) -> dict | None:
    """Valor POR PARCELA vira TOTAL. Ponto único, e é por isso que ele existe.

    `create_installment_plan` recebe o total e divide (o resto vai na última
    parcela). Quem responde "700 cada" numa compra de 12x está dizendo
    R$ 8.400 — e era isso que o agente gravava como R$ 700, virando parcelas de
    R$ 58,33.

    A multiplicação não mora em `interpretar` nem no `parse_slot_click` porque
    os DOIS caminhos (digitar e clicar) precisam dela: em dois lugares, um dia
    um deles deixa de multiplicar.
    """
    if not decidido or not decidido.get("por_parcela"):
        return decidido
    parcelas = _parcelas(acao)
    if parcelas < 2:
        # sem parcelamento, "cada" não quer dizer nada — o valor é o valor
        return {k: v for k, v in decidido.items() if k != "por_parcela"}
    return {
        **{k: v for k, v in decidido.items() if k != "por_parcela"},
        "amount_cents": decidido["amount_cents"] * parcelas,
    }


def mesclar(acao_guardada: dict, decidido: dict) -> dict:
    """Preenche o slot respondido, sem sobrescrever o que já estava lá."""
    juntado = dict(acao_guardada)
    if decidido.get("slot") == "account":
        if not juntado.get("account"):
            juntado["account"] = decidido["account"]
    elif decidido.get("slot") == "description":
        if not juntado.get("description"):
            juntado["description"] = decidido["description"]
    elif not juntado.get("amount_cents"):
        juntado["amount_cents"] = decidido["amount_cents"]
    if decidido.get("current_installment") is not None:
        juntado["current_installment"] = decidido["current_installment"]
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
# O valor viaja DENTRO do payload (`t:70000`), em vez de virar estado no banco:
# `draft_actions.slot` só admite 'amount' e 'account' (check da 0045), e guardar
# um qualificador dentro de `action` sujaria o dict que depois passa por
# `FinanceAction.model_validate`. Sem estado novo, não há estado para expirar.
_TOTAL = "t:"
_POR_PARCELA = "p:"
_CRIAR_CARTAO = "create_card:"
_OUTRO_CARTAO = "retry_card"

# `accounts.name` não tem limite no banco, mas o id do botão da Meta tem 256
# caracteres e o nome viaja DENTRO dele. Cortar aqui é melhor que o envio
# falhar em silêncio e a pergunta não chegar.
MAX_NOME_CARTAO = 40


def nome_de_cartao(bruto: str | None) -> str:
    """O nome que pode virar cartão, ou "" se não der.

    Vem da extração do modelo, então passa por corte e limpeza antes de virar
    linha no banco E antes de entrar no payload de um botão.
    """
    limpo = " ".join((bruto or "").split())[:MAX_NOME_CARTAO].strip()
    return limpo

# Teto de sanidade do que volta de um clique. O payload é escrito por nós, mas
# quem devolve é o cliente do usuário — número fora da faixa é payload adulterado
# ou bug nosso, e nos dois casos não pode virar dinheiro.
_MAX_CENTS = 10**11


def _cents_do_clique(bruto: str) -> int | None:
    if not bruto.isdigit():
        return None
    valor = int(bruto)
    return valor if 0 < valor <= _MAX_CENTS else None


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
    if sufixo == _OUTRO_CARTAO:
        return {"acao": "escolher_cartao"}
    if sufixo.startswith(_CRIAR_CARTAO):
        nome = nome_de_cartao(sufixo[len(_CRIAR_CARTAO):])
        return {"acao": "criar_cartao", "name": nome} if nome else None
    for marca, por_parcela in ((_TOTAL, False), (_POR_PARCELA, True)):
        if sufixo.startswith(marca):
            valor = _cents_do_clique(sufixo[len(marca):])
            if valor is None:
                return None
            decidido = {"acao": "completar", "slot": "amount", "amount_cents": valor}
            # `com_total` faz a multiplicação, aqui e no caminho digitado
            return {**decidido, "por_parcela": True} if por_parcela else decidido
    return None


def lembrete(rascunho: dict) -> str:
    """A frase discreta que lembra do rascunho. Template puro, zero modelo."""
    trecho = (rascunho.get("raw_text") or "").strip()
    if len(trecho) > 60:
        trecho = trecho[:59] + "…"
    slot = rascunho.get("slot")
    if slot == "account":
        oque = "o cartão"
    elif slot in ("description", "identification"):
        oque = "o que foi comprado"
    elif slot == "category":
        oque = "a categoria"
    else:
        oque = "o valor"
    return f"(Ainda tenho seu rascunho — *{trecho}*. É só me mandar {oque} quando quiser.)"

