# F21 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. Sem migration. [Contrato](contrato.md).

"Começar as finanças" (`/finance/comecar`), em quatro passos puláveis: conta principal com o saldo
de hoje, cartão (a conta que paga já vem com a do passo 1), primeiro lançamento (abre o
formulário único com a conta escolhida) e o resumo do que foi criado. Os campos e a escrita são
os de Contas (`AccountFormFields`, `useCreateAccount` com recibo por tentativa): o saldo vai em
`initial_balance_cents`, sem lançamento de abertura. Entra pelo passo "Cadastrar conta ou cartão"
dos Primeiros passos da Hoje e pelo estado vazio de Finanças sem contas. Quem já tem contas e
abre por link vê "Suas contas" (20 por vez, "Ver mais").

O progresso fica no aparelho por usuário e espaço (`comecar:<workspace>`), só com os ids criados;
o passo é recalculado do dado real (`passoEfetivo`, com teste): id apagado ou arquivado sai, e
nada é recriado.

## Código

Correção do QA: ao salvar a conta ou o cartão, as contas recarregavam com a nova antes de o
progresso gravar, e o passo calculado passava pelo resumo (iPhone, ~0,2 s) ou pelo passo 1 de
novo, ainda tocável (Android, ~1 s). A tela segura o passo do Salvar até o `onCriada`
(`onSalvando`). Conferido em vídeo quadro a quadro nos dois: passo 1 → 2 e 2 → 3 direto. O
resumo de quem já tinha contas deixou de se chamar "Criado". `npx tsc --noEmit`, `npx expo lint`
e `npm test` (2339) com exit 0.

## Nativo

Dois usuários de QA criados no staging só para isto (`qa-f21@proops.local` e
`qa-f21-android@proops.local`), um por aparelho.

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 11/11: as duas entradas, "Agora não" sem criar nada, conta com saldo −150,00, fechar o app no passo 2 e voltar nele sem duplicar, outra conta, cartão com a conta que paga já escolhida, "Lançar agora" com a conta e ✕ sem salvar, resumo, conta arquivada some do resumo, dev@ (com contas) abre no resumo sem criar nada, escuro + fonte grande no resumo. Reconferência da correção em vídeo. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 7 + 1 parcial: estado vazio, "Agora não", conta 0,00, force-stop no passo 2 sem duplicar, cartão sem conta que paga ("Escolher na hora de pagar"), resumo/Lançar/Abrir Finanças, conta arquivada, escuro + 1,3 + 384dp no resumo, dev@. Reconferência: o passo fica parado do Salvar ao passo 2, e o toque duplo no Salvar do cartão criou um cartão só (conferido no banco). [Resultado e capturas](evidence/android/) |

Oráculo: cada usuário de QA terminou com exatamente as contas e o cartão criados nos testes,
saldo inicial gravado na conta (−15000 centavos) e **nenhuma transação**. Limpeza por ID: as
contas, depois os dois usuários pela API de admin (perfil e espaço foram em cascata; nenhum espaço
órfão).

## Limites

- Com a única conta (não cartão) arquivada, o link volta ao passo 1 e o cartão existente não
  aparece no resumo até haver conta.
- "Adicionar outra conta" mostra "Passo 1 de 4"; o resumo não oferece outra conta (só no passo 2).
- O saldo negativo é o campo + "No vermelho": o campo mostra o valor sem o sinal.
- "Ver mais" do resumo não foi exercitado no aparelho: o dev@ tem exatamente 20 contas.
- Não vistos: a entrada pela Hoje no Android, os passos 1 a 3 com escuro e fonte grande (só o
  resumo), a transição com Reduzir movimento, a rede caindo depois do salvar (coberta pelo recibo
  do `useCreateAccount`), troca de espaço e aparelho pequeno.
- No staging o salvar levou de 6 a 25 s no Android; o botão fica carregando nesse tempo.
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag.
