# Jornada final iOS (iPhone 17 Pro, dev@, staging) - 05/10/2026

Bundle atual provado: Finanças > Gerenciar lista "Favoritos" (01-gerenciar.png) após terminate + launch.
Somente leitura: nada salvo; formulários fechados pelo X (valor 1,00 e título "QA" digitados só no rascunho).

| Passo | Ponto | Resultado | Captura |
|---|---|---|---|
| 1 | F21 /finance/comecar: "Passo 4 de 4 / Suas contas" com as contas | PASSA | 02-comecar |
| 2 | Menu Lançar (Gasto ou receita, Recorrente, Financiamento, Por voz) | PASSA | 03-menu-lancar |
| 2 | F01 Forma de pagamento (Pix, Crédito, Débito, Dinheiro, Transferência, Boleto) | PASSA | 09, 10 |
| 2 | F02/F03 origem com saldo/limite + "Criar conta"/"Criar cartão" | PASSA | 11 |
| 2 | F06 Classificação (Previsibilidade Fixo/Variável, Necessidade) | PASSA | 07 |
| 2 | F09 "Detalhe" (subcategoria) aparece ao escolher categoria | PASSA | 08 |
| 2 | F04 "Ao salvar" com valor 1,00 (saldo 26.507,30 > 26.506,30, "Nada foi gravado") | PASSA | 12 |
| 2 | F22 fileira Favoritos no formulário | NÃO VISTO (a fileira some sem favoritos; staging dev@ tem 0 e criar grava) |  |
| 3 | F05 filtro Formas de pagamento (+ previsibilidade/necessidade) em Lançamentos | PASSA | 14 |
| 3 | F22 Duplicar / Virar favorito no menu do detalhe | PASSA (em lançamento comum; no Aluguel, parcela de dívida, não aparece, por podeDuplicar) | 16 |
| 3 | Faturas abre | PASSA | 17 |
| 3 | F22 tela Favoritos (vazia) | PASSA | 37 |
| 4 | F14 Planejar por percentual (menu de Orçamentos) | PASSA | 20 |
| 4 | F17 (i) Como é calculado em Orçamentos | PASSA | 19 |
| 4 | F15 Por que mudou? a partir de Finanças | PASSA | 21 |
| 5 | F10/F19 Metas: anel, previsão pela contribuição mensal; Editar com Prazo, Marcos, ícone e cor | PASSA | 22, 25 |
| 5 | F08 Simular juntas (plano de metas, "Menor disponibilidade") | PASSA (não há rótulo literal "Cabe no plano?") | 24 |
| 5 | F11 Guardar/Retirar + Já está na conta/Transferir + escolha de conta | PASSA | 23 |
| 5 | F07 Reserva de emergência no Patrimônio (cobertura, alvo, falta) | PASSA | 26 |
| 6 | F12/F13 Aplicar/Resgatar e reavaliação de investimento | NÃO VISTO: dev@ não tem conta de investimento (só "Cadastrar conta de investimento", abre Nova conta) | 29 |
| 7 | F20 Quanto vou acumular (Cenário 1/2, taxa, inflação) | PASSA | 30 |
| 7 | F17 (i) na Projeção | PASSA | 31 |
| 8 | F16 Por voz abre (Gravar), fechado sem gravar | PASSA | 04 |
| 8 | F18 Recorrentes: Encerrar (série ativa), Reabrir (Aluguel encerrada) | PASSA | 33, 35 |
| 8 | F18 transferência recorrente (Da conta / Para a conta / Repete) | PASSA | 36 |

## Defeitos
Nenhum bloqueante. Observações:
- Aplicar/Resgatar/reavaliação (F12/F13) e fileira Favoritos (F22) não puderam ser vistos sem gravar dados; precisam de conta investment e de um favorito.
- Total de gastos do ciclo em Finanças variou de R$ 11.246,56 para 11.246,69 entre leituras (provável escrita concorrente de outro QA; não investigado).
- Taps na lista após voltar de uma tela às vezes caem noutro item (rolagem), sem impacto no produto.
