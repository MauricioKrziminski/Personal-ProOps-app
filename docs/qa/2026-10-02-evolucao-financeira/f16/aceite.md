# F16 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`, agente de staging com a rota nova. [Contrato](contrato.md).

Os menus "Lançar" da Hoje e das Finanças têm **Por voz**: gravar (nível do som real; com Reduzir
movimento, parado) → transcrever → corrigir o texto → **Montar lançamento** → o formulário único
abre pré-preenchido no tipo certo (Uma vez ou Recorrente), com o que conferir numa nota no topo.
Salvar é o caminho normal. Cancelar em qualquer etapa não grava nada.

## Agente

- `POST /internal/finance/draft` (JWT, usuário pelo `sub`): roda só a interpretação
  (`finance_node`, mesmo schema `FinanceAction`, sem campo novo) e devolve
  `{tipo, params, perguntas, entendido}`. Não executa ferramenta, não cria `pending_actions` nem
  `executed_actions`, não manda mensagem — o pytest troca todo caminho de escrita por dublê que
  explode.
- Conta: pelo nome que o modelo devolveu (`resolve_account`) ou, quando ele não devolve, pelo nome
  CADASTRADO citado na fala (`_contas_no_texto`, casamento contra as contas do espaço); uma só →
  preenche, mais de uma → pergunta, nenhuma → pergunta quando o tipo precisa de cartão.
- **Correção na integração:** a rota chamava o Gemini sem passar pela cota nem gravar
  `ai_events`, e a voz virava um jeito de usar a IA sem contar no plano. Agora passa por
  `conversation.check_limits` (429 rajada, 402 plano) antes do modelo e grava UMA linha em
  `ai_events`, como uma mensagem do chat. Testes novos.
- Frase "Você disse 2 coisas: … A outra ficou de fora." (saía "As outras 1 ficaram de fora").
- ruff e pytest (1253) verdes. Agente de staging redeployado (`agente-staging-00205` para o QA; a
  frase corrigida foi no deploy seguinte). Nenhum prompt ou schema mudou: sem
  `evaluate_answer_forms.py`; a interpretação real foi conferida com o Gemini do staging em seis
  frases e nos dois aparelhos.

## Código

Hook de gravação compartilhado com a conversa (`use-gravador-de-voz.ts`), folha
`lancar-por-voz.tsx`, `voice-draft.ts` (rascunho → `hrefDoLancar`), nota das perguntas em
`/finance/lancar`. `npx tsc --noEmit`, `npx expo lint` e `npm test` com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 9/9. Voz de verdade (`say` captado pelo microfone do Mac, transcrito pelo Groq): "gastei 45 no mercado ontem" → R$ 45,00, mercado, 04/10. Microfone negado com "Abrir ajustes", compra 3x no Nubank Cartão (única que casa), Recorrente, duas ações, salvar um, cancelar em cada etapa, segundo plano, escuro + fonte grande + Reduzir movimento. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 8/8 com o texto digitado (o microfone do emulador é mudo e cai no "não captou som", que abre o campo). [Resultado e capturas](evidence/android/) |

Oráculo: os dois lançamentos de QA ("QA F16 iOS cafe", "QA F16 Android cafe") apagados por ID;
lançamentos e caixa iguais à linha de base.

## Limites

- Pela voz, "300 em 3x" virou "300E3X" no Groq: o formulário abre sem valor e pergunta (degrada
  certo, mas quem fala "3x" pode cair nisso).
- O caso "duas contas casam com o nome" foi provado no pytest, não no aparelho (o staging tem uma
  só "Nubank").
- "Montar lançamento" levou 14–30 s no staging (Lite do Gemini lento) com só o indicador de
  carregando.
- Ao chegar no formulário, o foco vai para o Título e o teclado cobre Valor e Categoria
  (comportamento do formulário único).
- O Android não exercitou a transcrição real. `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem
  produção, push ou tag; o agente foi deployado SÓ no staging.
