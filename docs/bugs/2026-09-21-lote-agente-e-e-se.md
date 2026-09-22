# Lote de 21/09/2026 — conversa na aba Agente, "E se…" adiantando parcelas, agente preso na confirmação

Quatro pedidos do dono do produto. Cada um tem a reprodução ANTES da correção, a causa e o
que muda. Reprodução feita com o motor real (Gemini + banco de staging, conta `dev@`) por um
driver que chama `app_chat` como o app faz — o mesmo `run_turn` do WhatsApp.

> ⚠️ Nesta data a cota grátis diária do `gemini-3.1-flash-lite` (500) da chave do staging
> estourou no meio da reprodução. As rodadas seguintes usaram `GEMINI_MODEL_BATCH/ROUTER/PARSE=
> gemini-3.5-flash-lite` SÓ no processo local — serve para o fluxo, não para aprovar prompt
> (ele errou valor 1 em 15, `ai-gemini.md`). Achado de passagem: `GEMINI_MODEL_ROUTER`
> sozinho NÃO troca o router, porque `_PAPEL_POR_NOME` mapeia o nome repetido
> (`gemini-3.1-flash-lite`) para o ÚLTIMO papel da tabela (`batch`).

---

## 3. Agente preso em "Ainda não alterei nada e mantive a proposta"

**Reprodução (antes):**

    VOCÊ:   Comprei Wardogs por 104,99
    AGENTE: ⚠️ Confirma registrar gasto de R$ 104,99 em Wardogs, na conta Poupança?
    VOCÊ:   Comprei em 2x no cartão
    AGENTE: Ainda não alterei nada e mantive a proposta. Confirme, cancele ou diga exatamente o que deseja mudar.
    VOCÊ:   Eu não comprei a vista na conta corrente, comprei no cartão em 2x
    AGENTE: Ainda não alterei nada e mantive a proposta. Confirme, cancele ou diga exatamente o que deseja mudar.

Idêntico ao print. Só "cancelar" sai do laço.

**Causa (`agent/app/domain/confirm.py`, `decide`):** desde "toda escrita pede SIM", todo
registro novo abre uma pendência `kind=confirmation`. A resposta digitada vai para
`_classificar_aviso`, cujo prompt só conhece *confirmar / recusar / trocar de cartão / rever o
intervalo de parcelas pagas / mudar o nº de parcelas*, e cujo contexto diz "as opções são
confirmar a compra ou trocar de cartão" mesmo quando a proposta é um gasto comum. **Não existe
saída para "a proposta está errada, é assim"**: `change_card` só vale em `soft_warning`,
`revise_purchase` só em `create_installment_purchase`, e o resto cai em
`{"keep_pending": True}` com a frase genérica — que pede "diga o que deseja mudar" e descarta
exatamente isso. A pessoa corrige, a correção é jogada fora, a mesma frase volta.

**Correção:** corrigir uma proposta que ainda NÃO foi gravada é refazer o pedido com a
correção. O classificador ganha `revise_proposal`; nesse caso a pendência expira (nada foi
escrito) e o turno roda o grafo de novo com o texto ORIGINAL (lido do checkpoint da pergunta)
+ a correção. Quem interpreta é o modelo, como todo o resto; a nova proposta passa pelo mesmo
`gate` e pede SIM de novo. `revise_purchase` ("sim, mas em 24x") vira o mesmo caminho em vez
da frase "cancele e informe de novo". `unclear` continua preservando a proposta, com frase que
diz o que dá para fazer.

## 4. "foi à vista no nubank" numa compra parcelada → "muda em Editar a compra no app"

**Reprodução (antes):**

    VOCÊ:   comprei wardogs por 104,99 em 2x no nubank cartão   → (aviso de limite) → Confirmar
    AGENTE: 🧾 Parcelado: R$ 104,99 em 2x de R$ 52,49
    VOCÊ:   editar lançamento wardogs, foi a vista no nubank
    AGENTE: A conta de uma compra parcelada muda em Editar a compra no app. Ainda não mudei nada.
    VOCÊ:   Pode mudar
    AGENTE: 🤔 Não entendi essa parte. Tenta algo como: …

**Causa:** o modelo devolve `update_transaction(installments=1, new_account="nubank")`. Qualquer
`new_account` sobre uma compra parcelada é recusado em quatro lugares (`resolve.py` ×3,
`policy.erro_de_correcao`, e a tool) com `CONTA_DO_PLANO` — **mesmo quando a conta dita é a
que a compra já tem** (aqui, "nubank" é o Nubank Cartão onde ela está: a pessoa estava
DESCREVENDO a compra, não pedindo troca). E a recusa era de princípio: data, conta e número
de parcelas da compra inteira "só no app", embora a RPC do app (`update_installment_plan`)
aceite as três quando nenhuma parcela está travada. "Pode mudar" não tem pendência para
aprovar — a recusa saiu em texto — e vira mensagem nova sem sentido.

**Correção:** a compra inteira passa a ser corrigida pelo agente pela MESMA RPC, com as
MESMAS travas do banco (parcela paga ou fatura fechada trava conta, data e nº de parcelas —
recusado antes do SIM, com a frase da trava):

- conta citada que já é a da compra = descrição, não troca (não entra na frase nem na RPC);
- conta nova → conta do plano (ou da linha única, no desparcelar);
- data nova → data da 1ª parcela;
- nº de parcelas N → M (2..72) → reparcela; 1 → à vista (desparcelar, que já existia).

O sentido inverso (à vista → parcelado, "foi em 2x no nubank") já era D1 (`conversoes`) e
entra no roteiro de verificação.

## 1. Últimas conversas na tela inicial do Agente

A aba abre uma conversa nova (`AgentChatStart`: título, compositor, atalhos). O histórico
só existe atrás do ícone do header. Pedido: mostrar as mais recentes ali mesmo, poucas, com
"Ver todas" levando ao histórico completo.

**Desenho:** bloco "Recentes" no fim do `AgentChatStart`, lendo `useAgentConversations`
(o MESMO cache da tela de histórico), 3 conversas com `ConversationRow`, e "Ver todas" →
`/agent/history`. Sem conversa o bloco não existe; carregando, esqueleto na forma das linhas;
erro, uma linha com "Tentar de novo" que não bloqueia o compositor. Em tablet a lateral já
lista tudo — o bloco não se repete.

## 2. "E se…": adiantar parcelas

O "E se…" só sabia supor lançamento NOVO (entra/sai, uma vez, parcelado, todo mês). Adiantar
é MOVER dinheiro que já existe: as parcelas escolhidas deixam de sair no dia delas e saem
juntas numa data escolhida.

**Desenho (spec em `docs/superpowers/specs/2026-09-21-e-se-adiantar-parcelas-design.md`):**
o banco lista o que dá para adiantar — compra parcelada, financiamento, recorrente — com o
DIA EM QUE CADA PARCELA SAI DO CAIXA pela mesma régua da projeção (parcela de cartão sai no
vencimento da fatura dela). A hipótese vira drafts do motor que já existe: uma saída na data
escolhida e o cancelamento de cada parcela no dia em que ela sairia. Financiamento com juros
sugere o valor presente (CDC art. 52 §2º: quitação antecipada com redução proporcional dos
juros); cartão e recorrente, o nominal. O valor é editável — quem sabe o valor exato é o
banco.
