# F22 — QA nativo iOS (iPhone 17 Pro, iOS 26.5, app com.proops.personal.dev, staging, dev@)

Prefixo dos dados: "QA F22 iOS". Originais em /private/tmp/proops-f22-native/ios/.

| # | Caso | Resultado | Evidência |
|---|------|-----------|-----------|
| 1 | Menu "…" do detalhe tem Duplicar e Virar favorito | PASSA | c1-menu.png |
| 2 | Duplicar avulso (03/10) abre "Novo lançamento" (Uma vez), preenchido, data 05/10/2026 (hoje); salvo como "QA F22 iOS dup"; segunda duplicação com o mesmo título = segundo lançamento; Salvar com dois toques seguidos | PASSA: 2 lançamentos "QA F22 iOS dup" em Lançamentos (contagem por árvore de acessibilidade, 2 antes e 2 depois). Obs.: os dois toques foram disparados quase juntos pelo idb, não é prova de duplo toque em milissegundos | c2-form-duplicado.png, c2-dois-dup-lista.png |
| 3 | Duplicar parcela (cartão, 1/3) | PASSA: topo "Cópia da parcela 1/3 — vira um lançamento à vista", Uma vez, valor 26,67, parcelas = 1; ✕ fecha sem aviso nem gravação | c3-copia-parcela.png |
| 4 | Duplicar ocorrência de recorrente e transferência | PASSA: recorrente abre preenchida (título, 05/10); transferência abre como Transferência com Nubank → Poupança. Fechadas sem salvar. Obs.: abrir a ocorrência pela lista (linha "recorrente") pode gravar a linha prevista (comportamento existente, não do F22) | c4a.png, c4b.png |
| 5 | Pagamento de fatura e de dívida sem "Duplicar" | PASSA: fatura = Mudar categoria, Apagar; dívida (Aluguel, parcela 4/48) = Mudar categoria, Apagar | c5-fatura-menu.png, c5-divida-menu.png |
| 6 | Toque longo na lista de Lançamentos mostra "Duplicar" | **FALHA no device** (ver defeito D1) | c6.png, c6-menu-sem-duplicar-antes-reload.png |
| 7 | Salvar como favorito (nome padrão = título), fileira Favoritos, tocar preenche e não grava | PASSA: nome padrão "QA F22 iOS Cafe"; fileira "Favoritos: QA F22 iOS Cafe · Todos" no novo lançamento; tocar preenche título, 15,00, casa, Poupança, data 05/10/2026; nenhum lançamento "QA F22 iOS Cafe" foi criado (conferido na lista) | c7-nome-favorito.png, c7-fileira-favoritos.png |
| 8 | Nome repetido recusado | PASSA: toast "Já existe um favorito com esse nome."; lista continua com um só | c8-nome-repetido.png |
| 9 | Gerenciar → Favoritos: renomear, arquivar, desarquivar, apagar | PASSA pelo toque longo no item (menu Usar/Editar/Renomear/Arquivar/Apagar): renomeado para "…Cafe2", arquivado ("Arquivados · 1", toast com Desfazer), desarquivado, apagado com confirmação ("Os lançamentos que você já fez com ele continuam como estão"). Lançamentos "QA F22 iOS dup" seguem (2). Entrada em Gerenciar NÃO verificada no device (D1) | c9-lista-favoritos.png, c9-menu-favorito.png, c9-arquivado.png |
| 10 | Virar favorito pelo detalhe, "QA F22 iOS Fav2" | PASSA: toast "virou favorito" e aparece na lista (R$ 0,03). **Deixado lá para limpeza por ID** | (sem captura própria; ver c11-lista-favoritos-escuro.png) |
| 11 | Escuro + accessibility-large + ocultar valores + Reduzir movimento | PASSA com ressalva: formulário com a fileira (chip e "Todos" quebram em duas linhas, sem corte) e lista sem corte; valores ocultos viram "••••••" na lista Favoritos. Reduzir movimento ligado (defaults + notifyutil + relançar), sem problema visível; efeito do crossfade não medido | c11-escuro-fonte-grande-form.png, c11-lista-favoritos-escuro.png, c11-lista-valores-ocultos.png |

## Defeitos

- **D1 (alta, a confirmar a causa): no device, Lançamentos e Gerenciar rodam código sem as mudanças do F22.** O código está no working tree (`transactions.tsx` ganhou "Duplicar" no `actions`, `manage.tsx` ganhou o item "Favoritos"), e o Metro serve a versão nova (conferi `podeDuplicar` no módulo servido de `src/app/finance/transactions`). Mesmo assim, no iPhone, após relançar o app, Reload pelo menu de dev e novo relançamento: `custom_actions` da linha = Ver detalhe, Editar, Apagar (sem Duplicar), e Gerenciar não lista "Favoritos". As telas `[txId]`, `lancar` e `favorites` (rota nunca aberta antes) já vêm com o F22. Hipótese: cache HTTP do dev client para os chunks das rotas já visitadas. Tentei limpar `Library/Caches/com.proops.personal.dev` do app e a limpeza foi bloqueada pela checagem de segurança; **não contornei**. Para fechar: limpar esse cache (ou reinstalar o dev client) e repetir os casos 6 e a entrada de Gerenciar. Se continuar sem Duplicar depois disso, é defeito de código real.
- **D2 (baixa):** o rótulo da seção de arquivados é "Arquivados · N"; o contrato diz "Arquivadas · N".
- **D3 (baixa, observação):** tocar num favorito na lista (que abre o formulário preenchido) já incrementa "usado Nx", mesmo sem salvar o lançamento.
- Observação: salvar o lançamento duplicado levou ~15 s no simulador (botão em "Salvando…"); sem erro, provavelmente latência do staging.

## Não verificado

- Caso 6 (toque longo → Duplicar → mesmo formulário) e a entrada "Favoritos" em Gerenciar, por D1.
- Editar favorito (campos do formulário) e favorito com conta/categoria arquivada ou apagada.
- Reduzir movimento: só ligado e navegado, sem medição do crossfade.
- Outro workspace não vê o favorito.

## Estado final

Restaurados: tema do app Claro, appearance light, content_size large, Reduzir movimento desligado, valores visíveis. App logado como dev@ na aba Hoje. Deixados no banco para limpeza por ID: 2 lançamentos "QA F22 iOS dup" (hoje) e o favorito "QA F22 iOS Fav2". "QA F22 iOS Cafe2" foi apagado pelo próprio teste. Nenhuma ação em itens "QA F22 Android"; só foi aberto o menu de um item Android (sem acionar nada).

## Reconferência do caso 6 e de Gerenciar (sessão principal, 05/10/2026)

D1 era bundle velho, não código: o app rodava `manage.tsx`, `transactions.tsx` e `icon.tsx` de
antes do F22 (o Metro não pegou os arquivos escritos pelo `git apply`; o aviso "star não está no
mapa" vinha do `icon.tsx` velho). Depois de `touch` nos arquivos e relançar o app:

- Gerenciar mostra "Favoritos, Modelos de lançamento", e o aviso do ícone `star` não volta.
- Toque longo num lançamento gravado ("QA F22 Android dup"): Ver detalhe, Editar, **Duplicar**,
  Apagar (`c6r-menu-com-duplicar.png`); Duplicar abre "Novo lançamento" preenchido
  (`c6r-form-duplicado.png`); ✕ volta à lista sem gravar (74 lançamentos antes e depois).
- O item tocado no QA era o "Aluguel" PREVISTO (linha da regra, ainda não gravada), que tem o
  menu próprio das previstas, sem Duplicar (`c6r-prevista-sem-duplicar.png`).
