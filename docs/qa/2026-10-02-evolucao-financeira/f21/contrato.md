# F21 — primeiro cadastro financeiro guiado

Estado: contrato do incremento, antes do código. Sem migration. Não declara implementação nem
testes. Base: `onboarding.tsx` (não muda), `setup-steps.ts`/`SetupChecklist`, `accounts.tsx`,
`AccountFormFields`, `useCreateAccount` (recibo idempotente por tentativa).

## Comportamento

Tela modal `/finance/comecar` ("Começar as finanças"), em passos, todos puláveis:

1. **Sua conta principal**: nome, tipo e **saldo de hoje** — os MESMOS `AccountFormFields`/
   `useCreateAccount` da tela de contas (nenhum segundo formulário). Pode adicionar outra conta.
2. **Cartão** (opcional): os mesmos campos de cartão (fechamento, vencimento, limite, conta que
   paga — já oferecendo a conta do passo 1).
3. **Primeiro lançamento** (opcional): botão que abre `/finance/lancar` com a conta do passo 1;
   voltar dele retorna ao passo seguinte.
4. **Pronto**: resumo do que foi criado (nomes, saldo, cartão) e **Abrir Finanças**.

Entradas: o passo "contas" do `SetupChecklist` da Hoje (hoje leva à lista de contas) e o estado
vazio de Finanças (sem nenhuma conta). Quem já tem contas não vê a entrada; abrindo por link,
começa pelo resumo do que já existe com "Adicionar cartão" e "Lançar".

## Domínio

- Saldo de hoje vai em `initial_balance_cents` pelo `create_account` (como já é): **nenhuma
  receita artificial** de abertura. Saldo zero e negativo (só conta corrente) aceitos pelas
  regras de `accountFormErrors`.
- **Progresso** no aparelho, por usuário E workspace (`usePreferencia`, chave
  `comecar:<workspace_id>`): `{passo, contaIds[], cartaoId?}`. Ao reabrir, o passo efetivo é
  RECALCULADO do dado real: id gravado que não existe mais (apagado) sai da lista; se a conta
  existe, o passo 1 está feito. Nada é recriado na retomada.
- Rede cai depois de salvar: o recibo do `useCreateAccount` (mesma tentativa) devolve a conta já
  criada — a retomada não cria outra. Duplo toque = uma conta.
- Troca de workspace: o progresso é do workspace atual; o outro não herda.
- Concluir ou "Agora não" marca o passo do checklist como resolvido pelas regras que já existem
  (dado real: contas > 0).

## UI

Moldura e movimento do onboarding existente (transição curta entre passos; Reduzir movimento =
sem deslize), indicador de passo, teclado/área segura do `Screen`, fonte grande e aparelho
pequeno sem corte. Texto curto (sem parágrafo explicativo).

## Aceite (matriz)

Pular todos; saldo zero e negativo; fechar o app no meio e reabrir (mesmo passo, sem nova
conta); rede caindo depois do salvar (uma conta só, conferido no banco); usuário com contas
pré-existentes; troca de workspace; cartão sem conta pagadora; apagar a conta criada e reabrir;
fonte grande; aparelho pequeno. Oráculo: ao terminar, exatamente as contas/cartão criados e
nenhuma transação de abertura. Teste unitário do cálculo do passo efetivo. Nativo nos dois
sistemas, claro/escuro, Reduzir movimento.
