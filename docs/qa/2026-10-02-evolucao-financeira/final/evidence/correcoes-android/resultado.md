# Correcoes no Android (emulator-5574, staging, dev@proops.local)

Bundle novo (force-stop + relancar). font_scale devolvido a 1.0; trava do app desligada no fim.

## 1. Valor da linha - PASSA
Altura do texto do valor medida no uiautomator, em Mes e Ciclo, com e sem busca:
57 px sem busca e com busca (fonte 1.0); 68 px sem busca e com busca (fonte 1.3). Limpar e buscar de novo manteve o tamanho.
Evidencia: 01, 03, 04, 05-fonte13-busca-mes, 06-fonte13-busca-ciclo.
Obs.: no Ciclo a linha mostra 2 linhas de legenda; o valor continua do mesmo tamanho. A troca de font_scale recria o app (volta a Mes).

## 2. Trava acima de formulario e folha - PASSA, com 1 ressalva
- Trava "Sim" + "Na hora" (10, 11). Formulario Editar lancamento aberto, HOME, volta: "App bloqueado" opaco por cima (21, 22); formulario nao aparece. Voltar na trava nao destrava (23). Desbloqueio pelo disco + PIN: formulario intacto (Aluguel, 550,00) (24).
- Folha Guardar (Metas): trava opaca por cima (31, 34). Desbloqueio sem Voltar: folha intacta (33).
- Abertura a frio com a trava ligada: fundo escuro de marca, depois disco + "App bloqueado", sem conteudo (40, 41); desbloqueio leva a Hoje (42). Voltar na trava na Hoje: continua bloqueado (43).
- RESSALVA: com a folha Guardar aberta, Voltar pressionado com a trava na tela FECHA a folha por baixo (a trava continua e nao destrava; apos o PIN o usuario cai em Metas sem a folha - 35). No formulario de tela cheia o Voltar e engolido e nada muda. Reproduzido 2x.
- Obs.: o dump de acessibilidade lista os nos da Hoje junto com a trava; barra de status (hora) fica escura sobre o fundo escuro da trava.
- Obs.: com a trava ligada, cada deep link reabre o prompt de PIN do sistema (esperado com "Na hora").

## 3. Favorito com conta arquivada - PASSA
Conta criada: "QA FIX Android conta" (arquivada). Favorito criado: "QA FIX Android fav" (titulo QAFIXteste, valor 0, conta = QA FIX Android conta). Nenhum lancamento salvo.
Apos arquivar, novo lancamento -> toque no favorito: Conta vazia ("Sem conta") com "A conta original nao esta mais ativa: escolha outra." e Salvar habilitado com valor 1,00 (74; 59-62).
Obs.: o primeiro toque no chip do favorito, com o teclado do Titulo aberto, as vezes so tira o teclado/foco e e preciso tocar de novo.

## Criados no staging (apagar por ID)
- conta "QA FIX Android conta" (arquivada)
- favorito "QA FIX Android fav"

---
# Rodada 2 (bundle novo provado: `travaNaTela` em sheet.tsx e `register_counted_debt_payments` em use-finance.ts no bundle servido pelo Metro)

## 4. Voltar com a trava na tela - PASSA
Trava Sim + "Na hora". Folha Guardar (81), menu de acoes por toque longo (86) e formulario Editar (89): HOME, volta, "App bloqueado", Voltar 2x, disco + PIN. Nos tres a folha/menu/formulario continuou aberto apos o PIN (83, 88, 90). A trava nao destravou com o Voltar. Trava desligada no fim.
Obs.: um ANR do System UI no meio do teste (emulador) deixou o app em "Confirmando..." e exigiu reabrir; o teste foi refeito limpo.

## 5. Financiamento A (ciclo 11/09-10/10, hoje 05/10) - PASSA
"QA FIN Android A", parcela fixa R$ 100,00, 48x, 8 pagas, conta Nubank corrente, proxima 23/10/2026.
- O formulario perguntou "A 8a (23/09) ja saiu da conta Nubank?" Sim/Nao (96, 97). Sim + salvar.
- Banco: 1 transacao `Parcela QA FIN Android A`, 23/09, cleared, R$ 100, conta Nubank, ligada a divida; divida com 8 pagas e restante R$ 4.000,00.
- Ciclo (Detalhe do ciclo): saida "Parcela QA FIN Android A - 23/09 - Nubank - R$ 100,00" (103).
- Ficha: "8a parcela, paga em 23/09/2026"; 1a a 7a "paga - por volta de" (sem lancamento) (104).
- Saldo do Nubank 29.300,00 -> 29.200,00 (105).
- Editar e salvar de novo: continua 1 transacao, 8 pagas (sem duplicar).
- Obs.: o bloco "Ao salvar" do formulario mostrou Nubank "sem alteracao" no saldo atual, mas o saldo caiu R$ 100 ao salvar.

## 6. Financiamento B atrasada - PASSA
"QA FIN Android B", sem conta, 8 pagas, proxima 05/11/2026; editada para proxima = 23/09/2026.
- O campo manteve 23/09/2026 e mostrou "Venceu em 23/09 e ainda nao foi paga. ..." (123). Escolha de alcance "Das proximas parcelas em diante"; salvo (first_due_date 2026-01-23).
- Ficha: "Atrasada - 23/09/2026" no topo, 9a "atrasada - venceu 23/09/2026", 10a 23/10, 11a 23/11, 12a 23/12... (125).
- Ciclo atual: "Parcela QA FIN Android B, atrasada - 05/10 - Financiamento" (126).
- "Paguei esta parcela" -> "Registrar pagamento": divida passou a 9 pagas, restante R$ 3.900,00, 1 lancamento cleared em 05/10 (127, 128).
- Obs.: o emulador estava lento (toques/digitacao perdidos); a data foi escolhida no calendario.

## Limpeza (por ID, staging)
- divida QA FIN Android A 68120349-ac34-4e79-81d6-e8b090a16844 e B 90e942d0-6f71-49a2-b51a-80d04cf27538: `public.delete_debt` (leva os pagamentos); os pagamentos (incl. os R$ 100 do Nubank) foram removidos; saldo nao reconferido na tela.
- conta "QA FIX Android conta" f93b9220-c55b-4046-94c4-4873695c3778 e favorito "QA FIX Android fav" 6d2d88e5-c9a1-487d-971a-32fc37a0a785 apagados.
- Conferido: nada com "QA FIN"/"QA FIX" em debts, transactions, accounts e transaction_templates. font_scale 1.0; trava desligada; app em dev@.
