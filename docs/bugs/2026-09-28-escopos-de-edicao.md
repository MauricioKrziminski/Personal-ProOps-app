# Edição de itens com várias ocorrências — reabertura e validação

Data: 28/09/2026. Este registro atualiza os critérios de alcance em [2026-09-27-recorrencia-e-audio.md](2026-09-27-recorrencia-e-audio.md). O código foi testado no Android AVD com a conta da **staging** `utkqoiigimqzeenxkxdl`. A produção `kwriuifcwyvdrxtspjiz` e os dados da Fundacred real não foram alterados. As capturas em `evidence/` ficam ignoradas pelo Git por conterem dados financeiros.

## Problema reproduzido

- **Carro em Lançamentos:** Mês → buscar Carro → Parcela Carro → Editar → Salvar fechava o editor sem perguntar o alcance, mesmo com 36 pagamentos no contrato. A mesma ausência ocorreu em Dívidas → Carro → Editar → Salvar. [Antes](evidence/2026-09-27/carro-salvou-sem-perguntar.png).
- **Portas de edição divergentes:** a ocorrência recorrente, a ficha da recorrência, a compra parcelada e o lembrete recorrente tinham seletores, momentos de escolha ou caminhos de gravação distintos. Uma operação de contrato podia avançar sem uma escolha explícita ao salvar.
- **Visual em Recorrentes:** o cabeçalho do cartão usava `space-between` entre ícone/título e valor; a largura variável do título deslocava o valor. Na captura do usuário, R$ 55,90 e R$ 129,90 terminavam em posições horizontais diferentes.

## Contrato de produto aplicado

Todo editor de um item com várias ocorrências oferece **ao tocar em Salvar**: **Só este**, **Este e os próximos**, **Todos, inclusive passados**. Os rótulos citam pagamento/parcela/ocorrência quando necessário. Cancelar não escreve. A escolha é feita depois de editar os campos, tanto pela lista de Lançamentos quanto pela seção específica. A opção “todos” pode mudar o histórico, conforme a confirmação expressa do usuário; no Carro, ela também recalcula parcelas antigas apenas estimadas.

A regra de dia fixo continua separada da ação “Último dia de todo mês”: tocar em 30 ou 31 no calendário guarda o número; em fevereiro ou outro mês curto, o vencimento cai no último dia disponível daquele mês sem transformar a regra em fim de mês. O calendário, a projeção e o agendador já foram exercitados na rodada anterior; esta rodada concentrou a regressão de alcance.

## Implementação

- `edit-scope-model.ts` e `edit-scope.ts` definem os três alcances e o mesmo comando de escolha no Salvar. A apresentação de três ações foi corrigida no fallback de `item-actions.ts`; antes, a terceira opção podia ficar inacessível. Os editores conservam os campos próprios de cada domínio, mas usam a mesma decisão de alcance e a mesma semântica para todos os caminhos de entrada.
- Recorrência: RPCs transacionais para uma ocorrência, esta e futuras, ou toda a série e suas ocorrências materializadas. Revisão otimista e `request_id` tornam a repetição segura e recusam escrita obsoleta. O editor da ficha aplica “só esta” à próxima ocorrência pendente e informa isso antes da escolha.
- Dívidas: edição do contrato e dos pagamentos usa escopos atômicos; “todos” cobre pagamentos registrados e estimativas antigas declaradas. Compras parceladas aplicam cada alcance ao cronograma e aos lançamentos associados. Uma revisão posterior detectou que o valor de parcela bancária já paga ainda era bloqueado por uma proteção genérica; a migração `20260927230040` permite sua correção expressa em “todas” ou em um sufixo escolhido, preservando a baixa. Faturas de cartão já pagas, adiadas ou parcialmente pagas mantêm a trava do fechamento. Lembretes conservam histórico de ocorrências entregues e aplicam os três alcances, sem reenviar uma ocorrência já entregue.
- Recorrentes: título ocupa a largura flexível, valor tem alinhamento à direita e ícone de pausa mantém sua coluna; títulos longos podem quebrar linha e continuar legíveis.
- O editor de compras preserva a unidade que a pessoa digitou: “Cada parcela” envia o valor para cada linha do alcance; “Total da compra” distribui o total pelo alcance. A validação anterior recusava qualquer total abaixo do montante antigo já pago antes mesmo de permitir escolher “todas”. Agora aceita um total com pelo menos um centavo por parcela; a revisão estrutural do contrato continua exigindo a conservação dos pagamentos quando muda quantidade, data ou conta.

## Validação no emulador e no banco

| Entrada | Resultado observado |
| --- | --- |
| Dívidas → Carro → Editar → Salvar | Três escolhas visíveis; edição cancelada, sem mudar o Carro. [Captura](evidence/2026-09-27/carro-editor-tres-alcances.png). |
| Lançamentos → Parcela Carro → Editar → Salvar | Três escolhas visíveis; edição cancelada. [Captura](evidence/2026-09-27/lancamento-carro-tres-alcances.png). |
| Lançamentos → Assinatura de streaming → Editar → Salvar | Uma, futuras e todas visíveis; edição cancelada. [Captura](evidence/2026-09-27/lancamento-recorrente-tres-alcances.png). |
| Recorrentes → Assinatura de streaming → Editar → Salvar | Três escolhas visíveis; o formulário não pergunta o alcance antes da edição. |
| Parceladas → macbook → Editar compra → Salvar | Três escolhas visíveis. |
| Lembrete recorrente temporário → Editar → Salvar | Três escolhas visíveis no editor da regra e da ocorrência. Escolher uma alterou só a ocorrência; a regra original permaneceu. As linhas temporárias foram excluídas e a exclusão conferida. |
| Série financeira temporária com uma ocorrência paga e duas futuras | “Só esta” mudou apenas outubro; “esta e próximas” mudou outubro/novembro e a regra, conservando setembro; “todos” mudou regra e as três ocorrências, conservando a baixa de setembro. Revisões 1, 2 e 3 verificadas. A série e suas três transações foram excluídas e a exclusão conferida. |
| Compra bancária temporária com parcela 1 paga e parcela 2 pendente | Pelo editor de Parceladas, mudei o total de R$ 200,00 para R$ 240,00, toquei Salvar → “Todas, inclusive parcelas passadas”. O AVD mostrou a parcela aberta em R$ 120,00; o banco mostrou total R$ 240,00, ambas as parcelas em R$ 120,00 e a primeira ainda `cleared`. As três linhas de QA foram excluídas e o banco confirmou zero remanescentes. |
| Recorrentes, temas claro e escuro | R$ 55,90 e R$ 129,90 têm borda direita alinhada; ícones de pausa também. [Claro](evidence/2026-09-28/recorrentes-valores-alinhados.png) · [escuro](evidence/2026-09-28/recorrentes-valores-alinhados-escuro.png). O tema do AVD foi restaurado. |
| Recorrentes no simulador iOS | A primeira captura ainda mostrava o layout antigo, com os valores em colunas diferentes. Reiniciei `com.proops.personal.dev` com Metro ativo e reabri Recorrentes; os dois valores passaram a terminar na mesma coluna. [Antes de recarregar](evidence/2026-09-28/recorrentes-ios-antes-recarregar.png) · [depois](evidence/2026-09-28/recorrentes-ios-depois-recarregar.png). O simulador permanece aberto nessa tela para validação da pessoa usuária. |

Os testes SQL de recorrência individual/futura/toda, contrato de dívida, parcela e lembrete passaram no PostgreSQL local com rollback; os seis testes SQL originais também passaram em transações revertidas na staging. A regressão revisada da parcela bancária paga e das faturas protegidas passou nos dois bancos, inclusive reduzindo o total para menos do que o pagamento antigo, com redistribuição explícita em “todas”. Os testes incluem repetição do mesmo `request_id`, revisão obsoleta, limites de histórico e rollback de erro. A execução do agente em staging está na revisão `agente-staging-00196-g2w`, 100% do tráfego, com `/health` saudável. As sete migrações desta rodada, de `20260927230000` a `20260927230040`, foram aplicadas e registradas **somente** na staging.

Gates finais: `npm test` **996/996**; `agent/.venv/bin/python -m pytest -q` **1202/1202**; `npx tsc --noEmit`, `npm run lint`, `ruff check agent/app/jobs/reminders.py` e `git diff --check` sem erro. As duas advertências do pytest vêm de dependências externas (Google GenAI e Starlette).

## Limite de distribuição

O AVD e o simulador iOS executam `com.proops.personal.dev` com o código local e o banco de staging. O iPhone físico conectado executa `com.proops.personal`, uma versão de produção anterior; esta correção ainda não está nesse aplicativo. Foi tentada uma compilação local Release de `com.proops.personal.staging`, que parou na assinatura por ausência de conta/perfis no Xcode naquele momento; nada foi instalado no aparelho. A pessoa usuária pediu para validar primeiro nos emuladores, então a instalação física está suspensa. A conta do Xcode foi ativada depois dessa tentativa, mas a compilação não foi retomada.
