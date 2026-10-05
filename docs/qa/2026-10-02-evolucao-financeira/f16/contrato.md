# F16 — voz contextual no Financeiro

Estado: contrato do incremento, antes do código. Staging `utkqoiigimqzeenxkxdl`. Não declara
implementação nem testes.

## Comportamento

Os atalhos de lançar (Hoje e Finanças, `ATALHOS_DE_LANCAMENTO`) ganham **Por voz**. Ele abre uma
folha curta: **gravar** (onda que responde ao áudio real; com Reduzir movimento, nível parado) →
**transcrevendo** → **transcrição editável** (campo de texto com o que foi entendido; a pessoa
corrige) → **Montar lançamento** → abre `/finance/lancar` PRÉ-PREENCHIDO no tipo certo → a pessoa
revisa e toca **Salvar** (o caminho normal, com a chave de requisição normal). Cancelar em
qualquer ponto não grava nada.

O que a fala não disse, ou disse de modo ambíguo, **fica vazio** no formulário e uma linha no topo
diz o que conferir ("Não sei qual conta: escolha", "Parcelas: é o total ou cada uma?"). Nunca
escolhe um id por adivinhação: conta/cartão só vem preenchido quando o nome casa com UM
registro do espaço.

## Servidor (agente)

- Transcrição: a rota existente `POST /internal/chat/transcriptions` (Groq), sem mudança.
- **Nova rota `POST /internal/finance/draft`** (JWT do app, usuário pelo `sub`): recebe
  `{ text, today, timezone }` e roda **só a interpretação** — o mesmo classificador/schema que o
  agente já usa (`FinanceAction`, sem campo novo: o teto medido de 252 não muda e não há probe a
  rodar) — e devolve um rascunho **sem executar ferramenta, sem `pending_actions`, sem
  `executed_actions`, sem mensagem no chat**:

```ts
type FinanceDraft = {
  tipo: 'uma' | 'recorrente' | 'financiamento';
  params: Record<string, string>;   // os MESMOS nomes que /finance/lancar lê (paramsDoAplicar/hrefDoLancar)
  perguntas: string[];              // o que conferir, em pt-BR, curto
  entendido: string;                // eco do que foi entendido, uma linha
};
```

- Contas e cartões: resolvidos contra as contas do workspace pelo mesmo resolvedor do agente;
  0 ou >1 candidato → campo vazio + pergunta. Método de pagamento citado ("no Pix", "no crédito",
  "Pix no crédito") segue a semântica do F01.
- Valor/total de parcelas ambíguo → `perguntas` (não decide). Datas relativas ("ontem", "dia 5")
  resolvidas no `today`/`timezone` mandados pelo app.
- Mais de uma ação na fala → só a primeira vira rascunho; `perguntas` diz que as outras ficaram
  de fora.
- Erros: texto vazio 422; modelo fora do ar 502 com frase; a folha mostra e deixa tentar de novo
  sem perder a transcrição.

## Cliente

`src/lib/voice-draft.ts` (+ teste): transformar `FinanceDraft` em `hrefDoLancar(tipo, params)`;
componente da folha em `src/components/finance/` reaproveitando a captura de `conversation-screen`
(extrair a gravação/medição para um hook compartilhado em vez de copiar); permissão de microfone
negada → frase + "Abrir ajustes"; interrupção (app em segundo plano) para a gravação e mantém o
que já foi transcrito; teclado e gravação não competem (gravar fecha o teclado). O formulário
`/finance/lancar` mostra `perguntas` numa `Note` no topo quando veio da voz.

## Aceite (matriz)

Permissão negada; áudio vazio/ruído; app em segundo plano durante a gravação; rede falha na
transcrição e no rascunho (retry sem perder texto); duas contas com o mesmo nome (pergunta, sem
escolher); "parcelei em 3x de 100" × "300 em 3x" (pergunta ou total certo); "Pix no crédito";
"ontem"/"dia 5"; cancelar em cada etapa (nada gravado: conferido no banco); salvar pelo formulário
(um lançamento só). pytest + ruff do agente; **teste real de interpretação** com Gemini no staging
(5–8 frases, modelo barato) além dos dublês; HMAC sem-envio não se aplica (rota interna do app,
não webhook). Nativo nos dois sistemas, claro/escuro, fonte grande, Reduzir movimento.
