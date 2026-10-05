# QA: congelamento das abas (cf9208e1) e financiamento com juros (48914a72) - 05/10/2026

Staging `utkqoiigimqzeenxkxdl`, dev@, app `com.proops.personal.dev`, Metro 8081.
Android: `emulator-5574` (1344x2992). iOS: iPhone 17 Pro (`F0BDF23C...`). O `emulator-5576` e o iPad não foram usados (no iPad só toquei "Cancel" no diálogo "Open in ProOps?").

## Bundle novo provado antes de testar

`touch` em `congela-fora-de-foco.tsx` e `formulario-da-divida.tsx`. O `index.bundle` do Metro não traz as rotas (rotas assíncronas), então a prova é o pedaço da rota, nos dois sistemas:

| pedaço pedido ao Metro | marcador | Android | iOS |
|---|---|---|---|
| `src/app/(tabs)/today/_layout.bundle` | `CongelaForaDeFoco` | 7 | 7 |
| `src/app/finance/lancar.bundle` | `perguntasDaConta` | 3 | 3 |

Os dois apps foram encerrados e abertos de novo depois disso. Prova comportamental (só existe com o `Freeze`): a folha "Seu nome" do Perfil volta com o rascunho (item A2, extra), nos dois.

## Resumo

| Item | Android | iOS |
|---|---|---|
| A1 Realtime com a aba congelada | PASSA | PASSA |
| A2 Plano de metas na troca de aba | rascunho PERDE (igual a antes do commit) | idem |
| A2 extra: folha de aba congelada (Perfil) | MUDOU: a folha volta com o rascunho | MUDOU (igual) |
| A3 Ocultar/mostrar valores | PASSA | PASSA |
| A4 Trava "Na hora" e volta do segundo plano | PASSA | PASSA |
| B Financiamento com juros, 2 pagas, 2ª no ciclo | PASSA | pergunta conferida (sem salvar) |
| Observação | travada de JS não reproduzida (ver B) | - |

## A. Congelamento das abas

### A1. Lançamento por fora enquanto a aba está congelada: PASSA
Inserção por `psycopg` no staging (conferido `utkqoiigimqzeenxkxdl`), dev@, "QA FREEZE ...", R$ 1,23, conta padrão do espaço (Poupança), data 05/10/2026, `cleared`.

- Android: Hoje e Notas montadas, foco em Notas, inseri `QA FREEZE android`. Ao voltar à Hoje: "Hoje · saiu" foi de R$ 0,00 para R$ 1,23 e o dia 5 da semana ficou "saiu R$ 1,23" (`a1-01`..`a1-03`). A Finanças só tinha sido aberta depois do insert, então não provava nada sobre congelamento. Por isso fiz um SEGUNDO insert (`QA FREEZE android (2)`) com a Finanças já montada e o foco em Notas: ao voltar, "Últimos lançamentos" trouxe as duas linhas e a Hoje foi a R$ 2,46 (`a1-05`..`a1-07`). Desvio do pedido: 2 inserts no Android.
- iOS: Finanças, Hoje e Notas montadas, foco em Notas, inseri `QA FREEZE ios`. Hoje: R$ 3,69 (2,46 dos do Android + 1,23). Finanças: "Vou fechar" foi para R$ 31.674,00 e a lista traz `QA FREEZE ios` (`i1-04`..`i1-07`).
- Latência: a troca de aba no emulador leva 2 a 4 s (o ambiente estava carregado: 2 emuladores, 2 simuladores e o Metro; o `gfxinfo` marcava 99% de quadros lentos acumulados). Sem baseline do commit anterior, não atribuo ao congelamento.

### A2. Plano de metas aberto com aporte digitado, troca de aba e volta
Aporte inicial 12,34 digitado em "Plano de metas" (Metas, "Simular juntas"). Nada foi salvo.

- A dock fica coberta pela folha (e some nas telas de detalhe), então a troca de aba foi por deep link (`/notes`), nos dois sistemas.
- Resultado: a folha fecha, a tela Metas sai da pilha, e ao reabrir Metas, "Simular juntas", o aporte inicial está em 0,00. O rascunho SE PERDE (`a2-04`, `a2-05`, `a2-08`, `i2-02`..`i2-04`).
- Mudou em relação ao commit? NÃO. `git diff cf9208e1^ cf9208e1 -- src/components/ui/sheet.tsx` é vazio; a regra `if (!focused && visible) onClose();` (sheet.tsx:182) já existia na versão anterior, e a tela `/finance/goals` fica na pilha da raiz, fora do `CongelaForaDeFoco` (que só envolve as 5 pilhas de aba). Comparação feita lendo o código; não construí o build anterior.

### A2 extra: folha dentro de uma aba congelada MUDOU de comportamento
Folha "Seu nome" (Perfil, `profile/index.tsx:563`), que mora direto na raiz de uma aba: digitei "XYZ" no campo, deep link para `/notes` (a folha NÃO fica por cima da Notas) e voltei ao Perfil. A folha REAPARECE com o rascunho "Gabriel AlmeidaXYZ" (`a2b-02`..`a2b-04`, `i2b-02`..`i2b-04`). Fechei no X, sem salvar; o nome ficou "Gabriel Almeida".

- Antes do commit: o `useIsFocused` ia a false, o efeito chamava `onClose()` e o estado era limpo ("limpamos o estado para que não reapareça ao voltar", comentário do próprio sheet.tsx).
- Agora: o re-render com `focused = false` fica suspenso pelo `Freeze`, o efeito nunca roda, e ao descongelar `focused` já é true de novo, então a folha continua `visible`.
- Efeito: pequeno (o rascunho volta em vez de se perder), mas contradiz a intenção escrita no `Sheet`. Vale para qualquer `Sheet` cujo `useIsFocused` fica dentro de uma raiz de aba: confirmado no Perfil, nos dois sistemas; pelo `grep` em `src/app/(tabs)`, também o `NovaPastaSheet` das Notas (não testado). Não verifiquei os `Sheet` que as raízes Hoje e Finanças importam de componentes. Decisão sua: aceitar (rascunho preservado) ou fazer o `Sheet` fechar no `blur` por evento em vez de por render.

### A3. Ocultar/mostrar valores: PASSA
Ocultei no olho da Finanças. Hoje mascarada ("saiu valor oculto"), Patrimônio mascarado ("Valor oculto" no iOS; pontos no Android). Mostrei de novo: Hoje volta a R$ 2,46 (Android) / R$ 3,69 (iOS) e o Patrimônio líquido volta (R$ 481.944,42 / R$ 481.943,19). `a3-*`, `i3-*`.

### A4. Trava "Na hora" e volta do segundo plano: PASSA
Perfil, Bloqueio: "Pedir para desbloquear ao abrir" Não para Sim, espera "Na hora" (já era a padrão).

- Android: na Finanças, HOME e retorno: "Desbloquear o app" com o PIN do sistema; PIN 1234 e voltou na MESMA aba, com conteúdo. Troca para Hoje e Notas OK; travei de novo a partir da Notas, destravei e fui à Hoje (`a4-04`..`a4-08`). Depois de destravar na Notas, a troca para a Hoje demorou mais de 4 s no emulador (toquei de novo e a Hoje apareceu; não sei dizer se foi o 1º ou o 2º toque que valeu). Sem baseline.
- iOS: o simulador pedia a senha do aparelho (desconhecida), então cadastrei Face ID por `notifyutil` (`enrollmentChanged`) e confirmei com `pearl.match`. Mesmo comportamento: tela "Aplicativo bloqueado" + Face ID, destravou na mesma aba, trocas de aba normais (`i4-03b`..`i4-08`).
- Devolvido: trava em Não nos dois, Face ID descadastrado.

## B. Financiamento com juros (48914a72)

Android: Finanças, Lançar, Financiamento. "QA JUROS android", Conta que paga = Nubank (corrente), Cobrança = Com juros ao mês, Quanto você deve hoje R$ 5.000,00, Juros 1% a.m., Parcelas que faltam 10, Parcelas já pagas 2, próxima parcela (a 3ª) = 20/10/2026, logo a 2ª = 20/09/2026 (ciclo do dev@ 11/09 a 10/10, hoje 05/10).

| Esperado | Resultado |
|---|---|
| Pergunta "A 2ª (DD/MM) já saiu da conta X?" | PASSA: "A 2ª (20/09) já saiu da conta Nubank?" com Sim/Não (`b2-03`). A 1ª (20/08) cai fora do ciclo e não pergunta. Com a data padrão 05/10 a pergunta era sobre a 1ª (05/10). |
| "Ao salvar" mostra o débito | PASSA: Nubank "Saldo atual R$ 29.300,00 para R$ 28.772,08" (débito R$ 527,92); "Parcela 1 de 12 R$ 444,25, Histórico informado, 20/08/2026, estimativa"; "Compromisso em 12 parcelas R$ 6.251,32"; previsto em 03/01/2027 R$ 27.188,32 (`b2-04`). |
| Sim + salvar: lançamento pago naquela data, na conta | PASSA: `transactions` 3f15e0b0..., despesa R$ 527,92, Nubank, `occurred_at` 2026-09-20, `cleared`, `paid_at` 2026-09-20, `debt_payment_no` 2. |
| Detalhe "Amortização + juros" | PASSA: "Amortização de R$ 473,18 + R$ 54,74 de juros", "Parcela 2 de 12" (`b2-08`). No banco: principal 47318 + juros 5474 = 52792. |
| Aparece no ciclo | PASSA: Lançamentos em Ciclo (11/09 a 10/10) mostra "dom., 20 de setembro: Parcela QA JUROS android -R$ 527,92, Nubank, Corrente" (pago); a 3/12 (20/10) aparece "previsto" na visão Mês de outubro (`b2-09`, `b2-09a`). |
| Ficha: 2 pagas, saldo do contrato inalterado | PASSA: "2 de 12 parcelas pagas", "Falta pagar R$ 5.000,00", "Próxima 20/10/2026 R$ 527,92"; Já pagas: 2ª "paga em 20/09/2026" (lançamento) e 1ª "paga, por volta de 20/08/2026" (só contada). No banco `remaining_cents` = `principal_cents` = 500000, `installments_paid` = 2, `first_due_date` 2026-08-20. |
| Editar e salvar de novo não duplica | PASSA: mudei o nome (+ " ed"), escopo "Das próximas parcelas em diante": continua 1 pagamento, `edit_revision` 3 para 4, saldo igual (`b2-11`..`b2-13`). |

iOS (só a pergunta, sem salvar): mesmo formulário, "A 2ª (20/09) já saiu da conta Nubank?" com Sim marcado, "Ao salvar" visível. Fechei no X; nada foi criado (`ib-06`).

### Observação: travada do JS no Android (NÃO reproduzida)
Na primeira tentativa, depois de "Um a mais" duas vezes seguidas (2 s entre os toques) e de tocar no campo da data, o formulário ficou com camadas sobrepostas e sem resposta: o X mostrava o estado de pressionado e não fechava; a thread `mqt_v_js` ficou em 60 a 90% de CPU por mais de 5 min, com o RSS subindo de 1,4 para 1,7 GB, sem erro no logcat. O CDP não conectava (a thread não respondia) e só `force-stop` recuperou (`b-10`, `b-11`). Repeti a MESMA sequência, com mais calma (3 s entre os passos): a thread tem picos de 50 a 90% por 1 a 3 s depois de cada toque e volta a 0%, sem travar. Aconteceu com o bloco de perguntas ("A 1ª (05/10) já saiu da conta...?") renderizado no modo com juros com 2 pagas, que é o caminho que o commit acrescentou; na repetição do mesmo caminho não reproduziu. Não consegui isolar a causa nem provar ligação com o commit. O emulador estava com 4 GB, ~200 MB livres e swap em uso. Se aparecer num aparelho real, o próximo passo é um perfil do Hermes durante a travada.

## Desvios do pedido
- Conta padrão do espaço é a Poupança (a corrente é a Nubank); os lançamentos "QA FREEZE" usam a padrão, o financiamento usa a Nubank.
- 2 inserts no Android (motivo no A1); 1 no iOS.
- Troca de aba com folha aberta por deep link, não pela dock.
- iOS: foi preciso cadastrar Face ID no simulador para a trava (desfeito).

## Limpeza (por ID anotado) e estado devolvido
- Apaguei por ID: `53f23714-8ba2-48e2-8320-c151954fef13` (QA FREEZE android), `265b3e1e-a2c3-4a9d-9538-08860cd27d51` (QA FREEZE android (2)), `30a29344-5ad5-4556-892b-93eb174ee442` (QA FREEZE ios) e a dívida `a3a18712-5089-4c23-a9a7-0f6f595697d7` (QA JUROS android ed) por `public.delete_debt` com o claim do dev@ na mesma transação (leva junto o pagamento `3f15e0b0-756b-49c7-b21d-5af920d75d67`).
- Ensaio com rollback antes do commit; depois, 0 linhas com "QA FREEZE"/"QA JUROS" em `transactions`, `debts`, `installment_plans` e `recurring_transactions`; as demais transações do espaço seguem 55 (antes e depois).
- Devolvido: valores visíveis (Android e iOS), trava Não (Android e iOS), Face ID descadastrado, régua da tela Lançamentos de volta em "Mês", nome do Perfil intacto. Nenhum arquivo de código foi editado.
