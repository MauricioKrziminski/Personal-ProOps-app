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
