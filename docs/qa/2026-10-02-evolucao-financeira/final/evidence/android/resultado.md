# Android final — jornada integrada (emulator-5574, dev@, staging, HEAD 4e78aeb6)

Bundle: o primeiro `/finance/manage` NÃO tinha Favoritos (bundle antigo). Após Reload do dev menu apareceu "Favoritos · Modelos de lançamento" com estrela (`00-manage-favoritos.png`). Tudo abaixo foi medido depois disso. Somente leitura: nada salvo; formulários fechados pelo ✕.

| Passo | Ponto | Resultado | Evidência |
|---|---|---|---|
| 0 | F22 Favoritos no Gerenciar (estrela) | PASSA | 00-manage-favoritos |
| 1 | F21 /finance/comecar "Suas contas" | PASSA (lista contas/cartões com saldo/dia) | 01-comecar |
| 2 | F01 Forma de pagamento (Pix, Crédito, Débito, Dinheiro, Transferência, Boleto) | PASSA | 02d-forma |
| 2 | F02/F03 origem com saldo/limite, "Criar conta/Criar cartão" | PASSA ("Saldo no ProOps", "Limite disponível", "Limite não cadastrado", "Limite precisa de conferência") | 02e-origem |
| 2 | F06 Classificação (Previsibilidade/Necessidade) | PASSA | 02f-classificacao |
| 2 | F09 Subcategoria ("Detalhe" aparece ao escolher categoria) | PASSA | 02j-categoria |
| 2 | F04 "Ao salvar" com valor 1,00 (Pagamento, Nubank saldo antes→depois) | PASSA | 02k-fim |
| 2 | F22 fileira Favoritos no lançar | NÃO VISTO (staging sem favoritos; `/finance/favorites` = "Nenhum favorito ainda"; criar é gravar) | 03a ausente |
| 2 | "Salvar como favorito" no formulário | PASSA (botão presente) | 02c |
| 3 | F05 filtro Formas de pagamento (+ Previsibilidade/Necessidade) | PASSA | 03c-filtros |
| 3 | F22 Duplicar / Virar favorito no detalhe | PASSA em lançamento avulso; o menu de parcela de dívida (Aluguel) só tem Mudar categoria/Apagar (esperado por `podeDuplicar`) | 03e-menu |
| 3 | F05 "Forma de pagamento" no detalhe | PASSA (Pix) | 03e-menu |
| 4 | F14 Planejar por percentual (renda-base, grupo, %) | PASSA (menu ⋯ → folha) | 04c-plano |
| 4 | F17 (i) em Orçamentos | PASSA (dump: "Como é calculado: Orçamentos"; ícone não capturado em PNG) | 04a-budgets |
| 4 | F15 /finance/why | PASSA via deep link com parâmetros (Categoria/Detalhe/Pagamento/Tipo). Sem parâmetros mostra "Escolha os períodos" (esperado) | 04d-why |
| 5 | F08/F10/F11/F19 Metas: ícone em anel, previsão/mês, Plano de metas, "Simular juntas"; Nova meta com Marcos (% / Cada um) e Ícone | PASSA (cor não conferida: abaixo da dobra) | 05a, 05c |
| 5 | Guardar: "Já está na conta / Transferir" | PASSA | (folha, sem PNG final) |
| 5 | F07 Reserva de emergência (+ (i)) em Patrimônio | PASSA | 05f-networth-baixo |
| 5 | F12 Investimentos no Patrimônio | PASSA (linha R$ 26.500,00) | 05e-networth |
| 5 | F13 detalhe de Investimentos | NÃO VISTO (a linha não é tocável; Acumulação usa 26.500 como inicial) | — |
| 6 | F20 /finance/acumulacao (cenários 1-3, aporte, taxa, inflação, valor no fim R$ 56.391,10) | PASSA | 06b |
| 6 | F17 (i) na Projeção | PASSA | 06c-forecast |
| 7 | F18 Encerrar no menu da recorrente | PASSA (Ver ocorrências, Editar, Pausar, Encerrar, Apagar) | 07b-rec-menu |
| 7 | F18 Reabrir | NÃO VISTO (nenhuma série encerrada na lista de staging) | — |

## Defeitos / observações
- Nenhum defeito funcional. Observações de desempenho de dev: telas com RPC (Orçamentos, Metas, Patrimônio, Projeção, Recorrentes) ficaram em skeleton por 20 a 60 s com o Metro e ícones (SF-symbol→vetor) demoram a aparecer; o shimmer impede `uiautomator dump` ("could not get idle state"). Não tratado como falha de produto.
- LogBox "Open debugger to view warnings" apareceu em dev após abrir Nova meta (aviso de dev, não investigado).
- Primeira abertura de `/finance/manage` estava com bundle antigo até o Reload.
- Toques com teclado aberto no lançar digitaram "To to" no Título (erro meu de navegação, nada salvo).
