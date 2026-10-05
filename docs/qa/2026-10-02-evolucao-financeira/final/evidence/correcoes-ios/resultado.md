# Correções iOS (iPhone 17 Pro, staging, dev@, Metro 8081, 05/10/2026)

Bundle confirmado com `JanelaDaTrava` (curl no Metro). App reiniciado (terminate + launch) antes de tudo.

## 1. Valor minúsculo: PASSA
Busca "Parcela" e "macbook" em Lançamentos; limpar e buscar de novo; Mês <-> Ciclo (01/10-31/10 e 11/09-10/10);
content_size `large` e `accessibility-large` (restaurado para `large`). O valor da linha sempre com o mesmo corpo
dos demais valores; em accessibility-large vai para linha própria, grande, nunca encolhido.
Obs.: o Fundacred não existe no staging, usei "Parcela Carro" e "macbook (2/12)".
Capturas: a1, a2, a3, a3b, a4, a5.

## 2. Trava acima do formulário (FullWindowOverlay): PASSA (reteste 05/10/2026)
Bundle do Metro confere `FullWindowOverlay` (16 ocorrências); app reiniciado. Bloqueio Sim + "Na hora", Face ID enrolled.
- (a) Aluguel -> Editar (formulário aberto) -> Ajustes -> volta: "App bloqueado" cobre o formulário; a árvore de acessibilidade
  expõe só "Tentar de novo / App bloqueado / mensagem", nenhum campo do formulário (f2a-2). Face ID falho + Cancelar: segue coberto.
  Face ID ok: formulário de volta como estava (título "Aluguel", valor 550,00) (f2a-3).
- (b) Campo Título focado e editado ("AluguelX"): ao voltar, trava por cima (f2b-2); após desbloquear o texto "AluguelX" continua.
  Limitação: o simulador não mostra o teclado virtual (teclado de hardware), então "teclado fechado" não foi visto; só o foco/ texto preservado.
  Fechei sem salvar (nenhum "AluguelX" no banco).
- (c) Folha Metas -> Troca do notebook -> Guardar: trava cobre a folha (f2c); depois de desbloquear a folha continua aberta.
- (d) Tela comum (Lançamentos): trava aparece (f2d-1). Abertura fria: marca (f2d-2) e depois trava/prompt Face ID, sem tela branca
  e sem duas trancas (f2d-3).
Trava desligada ao fim; Face ID devolvido a não enrolled.
(O resultado anterior, com `Modal`, era FALHA: trava não cobria formulário nem folha.)

## 3. Favorito com conta arquivada: PASSA
- Conta "QA FIX iOS conta" (Corrente) criada; lançamento novo com ela, "Salvar como favorito" nome "QA FIX iOS fav"
  (lançamento NÃO salvo); conta arquivada.
- Novo lançamento -> toque no favorito: Conta vem "Sem conta" com "A conta original não está mais ativa: escolha outra.";
  "Salvar" e "Salvar como favorito" habilitados (enabled=True na árvore), nada gravado (e1).
- Gerenciar -> Favoritos -> (toque longo) Editar: mesma mensagem e "Salvar" habilitado (e2). Não salvei.

## Criados no staging (APAGADOS por ID em 05/10/2026)
- Conta "QA FIX iOS conta": ce78ab43-a91c-4b26-bb5e-1b0b18a5361a (sem lançamentos) - apagada.
- Favorito "QA FIX iOS fav": c4bfda02-e18d-41a8-af21-e93fb1c7ddff - apagado.
- Nenhum lançamento gravado; conferido que não restaram registros com esses nomes.

## Financiamento (iPhone, staging, 05/10/2026; ciclo do dev@ 11/09-10/10)
Bundle com `register_counted_debt_payments` e `travaNaTela` confirmado; app reiniciado.

### A. Criar com 8 pagas e a 8ª dentro do ciclo: PASSA
"QA FIN iOS A", parcela fixa R$ 100,00, 48 parcelas, 8 pagas, conta Nubank (corrente), próxima 23/10/2026.
- Ao mudar a data, o formulário pergunta "A 8ª (23/09) já saiu da conta Nubank?" Sim/Não (g-A1). Sim e salvar.
- Banco: 1 lançamento da 8ª, 23/09/2026, R$ 100,00, cleared, conta Nubank, ligado à dívida.
- Ficha (g-A2): 8 de 48, falta R$ 4.000,00, próxima 23/10; "8ª parcela, paga em 23/09/2026" (com lançamento), 1ª a 7ª "paga · por volta de" (só contadas).
- Ciclo (Ver o que fecha o ciclo): "Parcela QA FIN iOS A, 23/09 · Nubank, R$ 100,00" (g-A3). Saldo do Nubank 29.300 -> 29.200.
- Editar e salvar sem mudar: não pergunta de novo, continua 1 só lançamento (mesmo id).
- Obs.: o rótulo do campo na criação é "Primeira parcela" até informar as pagas; com pagas vira "Próxima parcela (a 9ª)".

### B. Próxima parcela com data já passada: PASSA (com 1 observação)
"QA FIN iOS B", sem conta, 8 pagas, próxima 05/11/2026. Editar -> calendário -> 23/09/2026:
- O campo MANTÉM 23/09/2026; aviso "Venceu em 23/09 e ainda não foi paga. Para marcar como paga, registre..." (g-B1).
- Salvar pergunta o alcance (Das próximas em diante / Todas); escolhi "Das próximas".
- Ficha (g-B2): 9ª a próxima, vence 23/09/2026; 10ª 23/10, 11ª 23/11, 12ª 23/12, 13ª 23/01/2027... nos meses certos.
- Ciclo (g-B3): "Parcela QA FIN iOS B, atrasada · 05/10 · Financiamento, R$ 100,00" em "Parcelas de financiamento".
- "Paguei esta parcela" -> Registrar pagamento: dívida vai a 9 pagas, 1 lançamento de R$ 100,00 em 05/10.
- Observações: (1) na criação SEM conta o formulário também exige responder "A 8ª (05/10) já saiu da conta sua conta?"
  (texto estranho "da conta sua conta", e o Salvar fica travado até responder, "Diga se a parcela já saiu da conta.").
  (2) a ficha não rotula a 9ª como "atrasada" (só mostra a data 23/09); o ciclo rotula.

### C. Fonte grande: PASSA
accessibility-large (restaurado para `large`): ficha (g-C1) e formulário de edição (g-C2 topo, g-C3 meio, g-C4 parcelas)
sem corte nem sobreposição; os blocos quebram em linhas.

### Limpeza
Dívidas apagadas por `delete_debt`: 4e1366ad-c463-4c7a-97a9-27d55a517c5b (A) e 9d7e3a31-2730-47f5-87d1-a1dc6dd5f5cc (B),
com os pagamentos (836163d1-6ea7-4f12-ad73-f691f8236758 e a7edb5ed-6717-498a-986d-37888ab9ea28). Conferido: nada "QA FIN iOS"
nem "QA FIX iOS" sobrou no staging.
