# F08 — QA nativo em iPad (iPad Pro 11" M5, iOS 26.5 simulador) — 05/10/2026, rodada 2

Substitui a rodada incompleta de 05/10 manhã. Staging `utkqoiigimqzeenxkxdl`, sessão dev@ já aberta no aparelho, somente leitura:
nenhum plano salvo (o botão "Salvar" nunca foi tocado; a Metas ainda mostra "Há sugestões iniciais… salve seu plano").
Capturas reduzidas por `sips -Z 1400`, todas nesta pasta.

## Prova de que o bundle é o atual

- Metro 8081 (já de pé): o manifesto aponta `index.bundle?platform=ios&dev=true…` (19.812.838 bytes) e o corpo contém
  `Menor disponibilidade no período` e `Conferir e encerrar tentativa` (textos de `goal-planning.tsx` / F08).
  `git status` sem alteração em `src/` (HEAD `5c7d5136`).
- Marcador no aparelho, depois de `terminate` + `launch`: Metas mostra "Plano de metas" / "Menor disponibilidade" /
  "Simular juntas" e a folha mostra "Plano de metas · Ajuste intenções futuras de um mesmo espaço" (F08) junto de "Guardar" (F11).
- Máquina com load 7–28 durante a rodada (outros simuladores/emuladores em uso). A RPC do plano respondeu em < 6 s em
  todas as aberturas (o estouro de 15 s da rodada anterior não se repetiu).

## Resultado por caso (somente RETRATO; ver "Rotação")

| Caso | Resultado | Capturas |
|---|---|---|
| Retrato · claro · fonte large | PASSA | `p-light-large-metas`, `p-light-large-sim1`..`sim5` |
| Retrato · escuro · fonte large | PASSA (ressalva O3) | `p-dark-large-metas`, `p-dark-large-sim1`..`sim4` |
| Retrato · claro · accessibility-large | PASSA (obs. O4) | `p-light-xl-metas`, `p-light-xl-sim1`..`sim8` |
| Retrato · escuro · accessibility-large | PASSA (ressalva O3) | `p-dark-xl-sim1`, `p-dark-xl-sim3`, `p-dark-xl-sim8` |
| Ocultar valores | PASSA | `p-conceal-metas`, `p-conceal-sim1`..`sim3`, `p-conceal-draft` |
| Reduzir Movimento — folha e "Ver períodos" (conteúdo aparece, nada preso) | PASSA; ausência de animação NÃO provada (ver nota) | `p-rm-frames-expandir-recolher`, controle `p-rmoff-frames-expandir-recolher` |
| Reduzir Movimento — tela Metas | **FALHA (D1)** | `p-rm-metas-overlap`, `p-rm-toque-simular-abre-guardar` (vs. `p-rmoff-metas-fresh`) |
| Paisagem (todas as combinações) | NÃO EXECUTADO | ver "Rotação" |
| Girar com a folha aberta + rascunho | NÃO EXECUTADO | ver "Rotação" |
| Rascunho preservado em re-render (substituto, NÃO é rotação) | PASSA | `p-conceal-draft-xl`, `p-draft-typed`, `p-draft-ciclo` |

Critério de "PASSA" nas combinações de fonte/tema: nada cortado, nada sobreposto, "Salvar" e "Fechar" sempre no
cabeçalho da folha (alcançáveis com a rolagem no fim), e o fim do conteúdo ("Salvar guarda o plano…") alcançável
por rolagem. A folha é diálogo central no tablet (cabeçalho e conteúdo dentro da área segura).

### Ocultar valores (tema claro, large)
- Prévia: "Menor disponibilidade no período" → "Valor oculto"; aviso "Disponibilidade negativa a partir de…" → `••••••`;
  "•••••• guardados em metas sem origem identificada…"; "O efeito do plano" com as quatro linhas ocultas.
- Distribuição: linhas de "Caixa e disponível" com valor e subtítulo `Caixa •••••• · aportes ••••••`; o rótulo de
  acessibilidade também mascarado (árvore: `Caixa •••••• · aportes ••••••`).
- Comparação: o gráfico caixa × disponível não é desenhado nem tem rótulo (ausente da árvore); cada meta mostra
  "Previsão oculta" + `••••••`.
- Renda digitada: o "Aporte inicial" digitado (`50,00`) continua legível (`p-conceal-draft`).
- Metas atrás da folha também mascarada ("Guardado", cartões, "Menor disponibilidade").

### Reduzir Movimento (`defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` + `notifyutil`, app relançado)
- Folha abre e "Ver períodos" expande/recolhe com o conteúdo completo e sem estado preso: gravação de vídeo (contact sheet
  de todos os quadros) mostra a lista fechada → aberta e aberta → fechada sem quadro de conteúdo parcial/invisível.
- Nota: isso NÃO prova "sem animação". A gravação do simulador captura só ~6 quadros/s (e apenas quando a tela muda) e a
  `Presenca imediata` dura 120–200 ms; o controle com Reduzir Movimento DESLIGADO também salta em um quadro
  (`p-rmoff-frames-expandir-recolher`). Para provar a ausência de animação é preciso gravação de tela em taxa fixa
  ou conferência no aparelho a olho; não executado.

## Defeitos

### D1 — Reduzir Movimento: cartões de meta sobrepõem o "Simular juntas" (Metas, carga a frio)
Passos para reproduzir (iPad, staging, dev@; 5 de 5 aberturas a frio com Reduzir Movimento ligado (a 1ª constatada por screenshot, as outras pela árvore, y=343); 0 de 2 medidas com ele desligado (y=430/429)):
1. `xcrun simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` e
   `notifyutil -p com.apple.accessibility.reduce.motion.status`.
2. `terminate` + `launch com.proops.personal.dev`, esperar ~14 s, abrir `com.proops.personal.dev:///finance/goals`
   (plano ainda sem cache).
3. Esperar o card "Plano de metas" carregar. O cartão "Troca do notebook" fica em y=343 (árvore) em vez de y=430:
   cobre a linha "Simular juntas" (y=338–405) deixando visível só ~5 pt dela e fica assim (10 s+ de observação).
   `p-rm-metas-overlap.png` (defeito) × `p-rmoff-metas-fresh.png` (correto, y=430).
4. Tocar onde está "Simular juntas" (417, 372) abre a folha "Guardar" de "Troca do notebook"
   (`p-rm-toque-simular-abre-guardar.png`), isto é, a entrada do F08 fica inalcançável.
Não reproduz: com Reduzir Movimento desligado, nem reentrando na tela com o cache do plano quente (y=430).
O toast de dev "Open debugger to view warnings." que aparece nessas aberturas é o aviso do Reanimated (unified log, subsystem `com.facebook.react.log`): "[Reanimated] Reduced motion setting is enabled on this device… Some animations will be disabled by default" — não aparece com o ajuste desligado.
Hipótese (não investigada, nenhum código editado): `src/app/finance/goals.tsx:401` põe
`layout={transicaoDeLayout}` (`LinearTransition`, só iOS) nos cartões; o `GoalPlanningSummary` troca um
`Skeleton height={80}` pelo bloco real depois do primeiro desenho, e com Reduzir Movimento a transição de layout é
pulada deixando o cartão na posição de antes do crescimento (deslocamento medido: 87 pt).

## Observações (não são defeitos do F08)

- O1. Arrastar a folha para baixo quando a rolagem já está no topo a FECHA e descarta o rascunho sem confirmação
  (comportamento do `Sheet` compartilhado; aconteceu duas vezes ao rolar de volta ao topo com gesto de dedo).
- O2. Só em dev: a faixa azul "Refreshing…" do dev client aparece em algumas capturas com Reduzir Movimento desligado
  (`p-light-large-sim3/4`, `p-light-xl-sim3/4/5/6/8`; sem alteração em `src/` no período). O toast "Open debugger to view
  warnings." das capturas `p-rm-*` é o aviso do Reanimated acima (ver D1).
- O3. A rolagem corta o conteúdo na borda inferior da folha, e com accessibility-large essa linha cortada fica colada ao texto
  grande do fundo ("Reserva de emergência"): claro (`p-light-xl-sim2`, `sim6`) lê-se como corte porque a borda arredondada
  aparece; no escuro (`p-dark-xl-sim1`, `sim3`) a superfície da folha quase não se distingue do fundo escurecido e a linha
  cortada parece sobreposta. Tratado como corte de rolagem, não como sobreposição; é do `Sheet` compartilhado, baixa gravidade.
- O4. accessibility-large: o seletor Mês/Ciclo não cresce com a fonte (todo o resto cresce); o diálogo mantém a mesma
  altura (~626 pt de 1210) e o cabeçalho ocupa ~30% dela, deixando ~436 pt de conteúdo (usável, tudo alcançável).
- O5. O teclado numérico flutuante do iPad cobre o campo e substitui a árvore de acessibilidade por "dismiss popup"
  enquanto aberto; o valor lido só volta depois de dispensá-lo. O diálogo sobe com o teclado de software (`p-draft-ciclo`).

## Rotação (paisagem e "girar com a folha aberta")

NÃO EXECUTADO. Bloqueio, com as tentativas feitas:
- `simctl` não tem comando de rotação.
- O iPad ligado por `simctl` não aparece na Device Hub (Xcode 27, que substitui o Simulator.app): só existe janela do
  iPhone; "Rotate Left/Right" (Controls) age só sobre a janela de um aparelho. Automação por cliques de menu no host foi
  abandonada: o foco voltava para outro app do usuário entre os comandos (dois cliques errados, revertidos).
- Dentro do app (lldb, processo do iPad): `requestGeometryUpdate…LandscapeLeft` e `UIDevice orientation` por KVC não
  mudam nada (`effectiveGeometry` segue `portrait`, screenshot 1668×2420, `supportedInterfaceOrientations` = 30);
  nenhum código foi alterado.
- Para fechar esses casos é preciso rotacionar o aparelho pela janela da Device Hub (⌘←/⌘→ com o iPad aberto lá).
  A rodada de rascunho abaixo NÃO substitui esse caso.

Substituto executado (re-render com a folha aberta, rascunho digitado, lido por `AXValue`):
- Rascunho `50,00` em "Aporte inicial" (Troca do notebook), mudança de Dynamic Type large → accessibility-large →
  large com a folha aberta: valor `50,00` mantido (`p-conceal-draft-xl` na fonte grande; `p-conceal-draft-back` de volta ao large, valor lido por `AXValue`).
- Rascunho `12,34` (Reserva de emergência), troca Mês → Ciclo com recarga do preview: valor `12,34` mantido e preview
  atualizado (`p-draft-ciclo`); voltou a Mês (`regua:metas` = `civil`).
- Nenhum Salvar; folhas fechadas pelo "Fechar".

## Estado devolvido

Tema claro · `content_size large` · Ocultar valores desligado (`proops.conceal` = `0`) · Reduzir Movimento desligado
(chave removida + notificação, app relançado) · retrato · app em Metas com layout correto. Nenhum plano, aporte ou
movimento criado no staging (a folha "Guardar" foi aberta duas vezes por toque na área sobreposta, D1, e fechada sem gravar).

## Reteste D1 — correção `dd0f8e9b` (sem transição de layout no iOS com Reduzir Movimento) — 05/10/2026

**Veredito: D1 corrigido (PASSA nos 3 itens).** Mesmo iPad Pro 11" M5 (`EE942585-68F1-477A-8534-A7B10BEAA346`), staging, dev@,
somente leitura; nada gravado (folha "Guardar" nunca abriu; folhas e formulário fechados sem salvar). Capturas `reteste-*` nesta pasta.

### Prova de que o bundle é o novo
- Metro 8081 já de pé (não reiniciado). `curl` no bundle iOS (`index.bundle?platform=ios&dev=true…`, 19.819.004 bytes) contém
  `semTransicao` (3 ocorrências): `semTransicao = Platform.OS === 'android' || useReducedMotion()` e as duas
  `semTransicao ? undefined : LinearTransition.duration(…)`.
- `terminate` + `launch` antes de cada abertura. Prova no aparelho: com Reduzir Movimento ligado aparece o toast de dev
  "Open debugger to view warnings." (aviso do Reanimated, ver D1) e com ele desligado não aparece.

### 1. Reduzir Movimento LIGADO — 5 aberturas a frio em `…dev:///finance/goals` — PASSA (5/5)
Ajuste lido de volta: `ReduceMotionEnabled = 1`; app relançado a cada abertura (plano sem cache). Medido pela árvore de acessibilidade
depois de "Simular juntas" e "Troca do notebook" existirem + 5 s:

| Abertura | "Simular juntas" (y, h) | "Troca do notebook" (y) | Sobreposição | Toque em "Simular juntas" |
|---|---|---|---|---|
| 1 | 338, 67 (termina 405) | **430** (antes do fix: 343) | nenhuma | abre "Plano de metas · Ajuste intenções futuras…" |
| 2 | 338, 67 | 430 | nenhuma | abre o plano |
| 3 | 338, 67 | 430 | nenhuma | abre o plano |
| 4 | 338, 67 | 430 | nenhuma | abre o plano |
| 5 | 338, 67 | 430 | nenhuma | abre o plano |

"Reserva de emergência" em y=614 nas cinco. Em nenhuma abertura apareceu a folha "Guardar". Capturas:
`reteste-rm-run{1..5}-metas.png` (layout) e `reteste-rm-run1-toque-simular-abre-plano.png`, `reteste-rm-run{2..5}-toque.png` (folha do plano).

### 2. Reduzir Movimento DESLIGADO — PASSA
Chave removida (`defaults delete`) + `notifyutil`, app relançado; o toast do Reanimated sumiu.
- Metas certa: "Simular juntas" y=338, "Troca do notebook" y=430, "Reserva" y=615 (`reteste-rmoff-metas.png`).
- Bloco que muda de altura 1 — seletor "Período da simulação" (folha do plano): aberto empurra "Menor disponibilidade no período" de y=505
  para y=928; fechado volta a y=505 exatos, nada preso nem sobreposto (`reteste-rmoff-select-aberto.png`, `-select-fechado.png`).
- Bloco que muda de altura 2 — "Ver períodos": expandido, "Reserva de emergência" vai de y=510 para y=864 e mostra a lista "Caixa e
  disponível" + "Ver mais (9)" sem sobreposição; recolhido volta a y=510 exatos (`reteste-rmoff-periodos-aberto.png`, `-periodos-recolhido.png`).
- Ressalva (não é falha): a gravação de vídeo (60 qps) mostra a lista já no lugar no primeiro quadro após o toque e só um
  assentamento de ~23 pt do conteúdo logo abaixo nos quadros seguintes (`reteste-rmoff-frames-expandir*.png`). Isso é compatível com a
  transição de layout ativa, mas NÃO prova um "deslize" completo; a prova do que foi pedido (nada fica preso) é a posição final idêntica
  nos dois sentidos. Conferência do movimento a olho continua não executada.

### 3. iPhone 17 Pro (`F0BDF23C-0286-4183-97E3-3BCC61D4267D`), Reduzir Movimento desligado — PASSA
- Metas: "Simular juntas" y=368–453, "Troca do notebook" y=478, "Reserva" y=662; nada sobreposto (`reteste-iphone-metas.png`).
- Formulário de lançamento (`…dev:///finance/lancar?tipo=uma`): lista de contas aberta mostra "Sem conta", CONTAS (Nubank, Poupança),
  CARTÕES (3) e "Criar conta"/"Criar cartão" em sequência, sem sobreposição; "Data" desce de y=565 para y=1176 (depois de "Criar cartão")
  e volta a y=565 ao fechar a lista (`reteste-iphone-lancar-conta-aberta.png`, `-conta-fechada.png`, `-conta-fechada-depois.png`).
  Formulário fechado sem salvar.

### Estado devolvido
Reduzir Movimento desligado nos dois simuladores (iPad: chave removida + `notifyutil`, app relançado em Metas; iPhone: já estava em 0).
Tema claro, `content_size large`, retrato. Nenhum código editado; nada gravado no staging.
