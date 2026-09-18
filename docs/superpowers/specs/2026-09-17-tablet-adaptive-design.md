# Personal ProOps em tablet — mesa de decisões (17/09/2026)

## Estado e decisão

Gabriel aprovou a direção “mesa de decisões” para **Android tablet e iPad** em 17/09/2026. Este
documento estende a identidade **Papel e Tinta / Suave** de `PRODUCT.md` e `DESIGN.md`; não a troca.
O produto continua sendo pessoal, em pt-BR, com dados financeiros reais e a mesma hierarquia de
ações. O telefone continua sendo uma experiência completa, não uma versão reduzida do tablet.

O trabalho se divide em três entregas verificáveis: (1) infraestrutura adaptativa e cinco raízes,
(2) fluxos de notas, finanças e agente, (3) conta, tarefas auxiliares e matriz de qualidade.
**Todas as rotas voltadas ao usuário entram na auditoria e no aceite final**, ainda que uma rota
simples precise apenas de largura de leitura e não de múltiplos painéis. `/`, `catalog` e
`design-preview` não são telas de uso normal; a vitrine permanece útil para QA.

### Evidência atual

- No Pixel Tablet Android 16, em 2560×1600 px (1280×800 dp), a pílula de cinco abas ocupa quase
  toda a largura. Hoje, Notas, Financeiro e Perfil usam sobretudo a coluna central limitada pelo
  `MaxContentWidth=800`; a raiz do Agente se estende quase de ponta a ponta. A tela de Lembretes
  deixa grandes áreas vazias. Capturas locais foram feitas das cinco raízes, login e lembretes.
- O repositório tem 50 arquivos de rota além de sete layouts; 21 rotas pertencem ao Financeiro.
  `FolderGrid` já troca de duas para três colunas, mas não existe uma composição de tablet para
  navegação, lista-detalhe, formulários e área de análise como um sistema.
- O app usa `expo-router`, `NativeTabs` no iOS, `expo-router/ui` e `PillTabBar` no Android,
  `Screen` para insets/rolagem/teclado, e já possui Reanimated 4, Skia, Gesture Handler e
  FlashList. Não há necessidade demonstrada de um novo kit visual.
- Há alterações não consolidadas em arquivos do Agente nesta branch. Implementação posterior
  deverá revisar o diff atual antes de tocar nesses arquivos e preservar a autoria concorrente.

### Referências e o que elas ensinam

| Fonte oficial | Aprendizado aplicado — sem copiar a aparência |
|---|---|
| [YNAB no iPad](https://support.ynab.com/en_us/using-ynab-on-an-ipad-a-guide-BkzOqBdAq) | Contas e registro visíveis lado a lado; mais colunas financeiras só quando melhoram a decisão. |
| [Copilot Money no iPad](https://help.copilot.money/en/articles/10003978-copilot-money-for-ipad) | Busca global, revisão e edição contextual de transações sem abrir uma tela inteira para cada gesto. |
| [Notion em tablet](https://www.notion.com/nl/releases/2020-04-07) | Barra lateral persistente em paisagem, colapso em retrato e menus proporcionais em vez de tela cheia. |
| [Google Home adaptativo](https://design.google/library/google-home-ux-miche-alvarez) | Um sistema que muda a composição ao redimensionar, não layouts separados por modelo. |
| [Android: navegação](https://developer.android.com/develop/adaptive-apps/guides/build-adaptive-navigation) e [lista-detalhe](https://developer.android.com/develop/adaptive-apps/guides/list-detail) | Barra compacta vira rail em janela ampla; lista e detalhe coexistem quando há largura. |
| [Apple: split views](https://developer.apple.com/design/human-interface-guidelines/split-views) | Seleção persistente, larguras fluidas e retorno coerente quando a janela fica estreita. |
| [Material: coreografia](https://m1.material.io/motion/choreography.html) | Uma transição guarda um foco visual reconhecível; não anima todos os elementos ao mesmo tempo. |

O Android 16 pode ignorar a restrição de orientação em telas grandes; por isso o `orientation:
"portrait"` de `app.json` não é uma estratégia de tablet. Ver [documentação Android](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability).
O `SplitView` do Expo Router 57 é [alpha e não pronto para produção](https://docs.expo.dev/versions/v57.0.0/sdk/router/split-view/);
esta entrega não ficará dependente dele.

## Tese visual e hierarquia

**Mesa de decisões**: em uma tela larga, a pessoa vê o número ou objeto em foco, as evidências
que o explicam e a próxima ação no mesmo campo de visão. O ganho do tablet não é mais cards;
é menos idas e voltas entre telas. A tinta escura marca o foco, o papel organiza a leitura, e
verde/tijolo/âmbar continuam exclusivamente semânticos. A marca permanece monocromática.

Há três papéis espaciais, usados somente quando o conteúdo pede:

1. **Navegação** — cinco destinos e estado selecionado; no iPad, a posição é a barra nativa do sistema no topo.
2. **Área principal** — o que a pessoa está tentando compreender ou editar.
3. **Painel de apoio** — lista, detalhe, compromissos ou contexto **real** relacionado ao foco.

O painel de apoio não pode virar “coluna de decoração”, duplicar uma métrica com outro rótulo,
mostrar dados estimados como exatos nem empurrar uma ação crítica para fora da leitura. Um único
herói de tinta por tela continua possível; em tablet ele pode ocupar só a área principal.

## Contrato adaptativo

### Janela, não aparelho

Uma função pura classifica a **largura disponível da janela em dp**: compacta `<600`, média
`600–839`, ampla `>=840`. `useWindowDimensions()` recalcula classe e geometria durante rotação,
Split View/multi-window e mudanças de fonte; nenhuma decisão depende de `Device.modelName` ou
de pixels físicos. A classe média pode mostrar rail + uma área; duas áreas só aparecem quando
cada uma mantém largura legível e alvos de toque adequados. A área ampla pode usar dois ou três
painéis conforme o fluxo, com limites mínimo/máximo por papel, não percentuais cegos.

No compacto, composição, gestos e caminhos atuais permanecem. No médio/amplo, a estrutura muda
sem perder a seleção, a posição de leitura, o rascunho ou a URL quando a janela encolhe ou cresce.
Não há rolagem horizontal da página; listas, gráficos e editores têm rolagem própria quando
necessário. Janelas estreitas em um tablet recebem a experiência compacta completa.

### Navegação e rotas

- **Android compacto:** a `PillTabBar` Suave existente continua. **Android médio/amplo:** rail
  de tinta com cinco destinos rotulados, badge real de Hoje, indicador animado e a ação primária
  contextual. A seleção vem da rota, não de um estado paralelo. Rotas profundas mantêm retorno
  previsível; o rail permanece nas áreas de trabalho quando houver espaço e some em tarefas
  imersivas/modalizadas justificadas.
- **iPhone/iPad:** preservar `NativeTabs`, Liquid Glass, SF Symbols e o gesto de voltar.
  **Decisão de 18/09/2026:** Gabriel escolheu manter a barra nativa do iPadOS no topo depois de
  ver e rejeitar a pílula do Android no iPad. Os cinco ícones SF Symbols seguem configurados;
  na captura do iPadOS 26, o sistema desenhou apenas os rótulos na barra superior. Não forçar
  ícones com um controle próprio, nem usar o `SplitView` alpha do Expo como fundação.
- **Lista-detalhe:** tocar em um item continua produzindo sua URL real (`/notes/[id]`,
  `/finance/[txId]`, `/agent/[id]` etc.). Em janela ampla, lista e detalhe podem ficar juntos;
  ao colapsar, o detalhe ocupa a tela e o Back volta à lista. Seleção visível, deep link direto,
  recuperação de scroll e foco acessível são parte do contrato.
- Respeitar o comentário/invariante de `Screen`: no iOS, uma `View` arbitrária entre a pilha e a
  `ScrollView` de uma rota empurrada pode quebrar o colapso do large title. A composição ampla
  deve ser testada sem regredir o telefone; se precisar de header compacto no tablet, isso será
  uma opção explícita da rota, não um efeito colateral.

### Primitivos previstos

1. `useAdaptiveWindow` + função pura de classe/larguras em `src/design/`: decisão central e
   testável, sem estado global desnecessário.
2. Evolução pequena de `Screen` para aceitar áreas largas e limites de leitura sem alterar os
   defaults compactos nem o manejo atual de safe area, teclado, pull-to-refresh e FAB.
3. Um primitivo de **painéis** para lista/detalhe/apoio, com proporções limitadas, placeholder
   útil e colapso determinístico. Não será um “layout engine” genérico com dezenas de flags.
4. Navegação Android por classe de janela no `app-tabs.android.tsx`, reaproveitando o registro
   de rotas de `expo-router/ui`; componente de rail separado da pílula. Tokens, `Icon`, botões,
   campos, cards, linhas e gráficos existentes são reutilizados.
5. Superfícies de tarefa dimensionadas para formulários, importação, paywall e confirmação:
   modal/sheet apenas quando a semântica pede; não transformar tudo em dashboard.

## Anatomia por fluxo

| Fluxo | Compacto preservado | Composição em tablet |
|---|---|---|
| **Hoje** | Sequência por urgência atual, `Livre até`, sinais, saídas/entradas, contas, agenda e lembretes. | O `Livre até` e sua Pista ancoram a área principal; uma faixa de decisões mostra vencimentos e lembretes, e o restante se distribui por tempo e assunto sem mudar a prioridade dos dados. A lista de obrigações e o número compartilham o mesmo horizonte temporal. |
| **Financeiro** | Ciclo, cartões, mosaico, lançamentos e gráficos atuais. | Uma mesa financeira com ciclo e curva no foco; cartões e tarefas à mão, e livro-caixa/explicações ao lado. Selecionar mês, conta, categoria ou ponto do gráfico atualiza o contexto visível sem criar valores novos nem consultas duplicadas. A Carteira, voo e fatura conservam sua identidade. |
| **Notas** | Captura rápida, pastas e lista; detalhe abre por rota. | Biblioteca/filtro à esquerda e nota à direita; busca e captura rápida acessíveis no topo. Pastas, arquivadas e lixeira reutilizam o mesmo padrão. Editor não vira campo de largura ilimitada. |
| **Agente** | Lista, nova conversa e thread atuais. | Lista de conversas + thread; painel de resultados apenas quando uma ação retornou registro verificável. Mensagem e registro permanecem ligados; nada de resposta decorativa ou conteúdo inventado. A implementação incorpora, sem sobrescrever, as mudanças concorrentes da branch. |
| **Perfil** | Seções e ações de conta atuais. | Grupos de configurações como índice; detalhe de membros/alertas em área de leitura, com estados e ações preservados. Dados sensíveis continuam sob trava e esconder saldo. |
| **Telas de tarefa** | Login, cadastro, OTP, onboarding, busca, lembretes, lançamento, importação, plano, paywall e edições existentes. | Formulários e leitura em largura confortável, ações próximas aos campos, teclado sem ocultar foco; listas podem ganhar detalhe, mas telas de decisão permanecem concentradas. Nada de esticar inputs ou sheets até a borda. |

As 21 rotas financeiras serão triadas uma a uma: raiz, lançamentos, detalhe de lançamento,
formulário, ciclo, contas, cartões, Carteira, faturas, detalhe de fatura, parceladas,
orçamentos, metas, dívidas, recorrentes, projeção, relatórios, patrimônio, regras, plano e
gerenciar. O critério de adaptação é a tarefa de cada
rota: **lista/detalhe**, **análise/contexto**, **formulário concentrado** ou **experiência
imersiva**. As rotas de notas, agente, perfil, autenticação e auxiliares entram na mesma
auditoria. Não se aceitará “passou no `MaxContentWidth`” como prova de layout de tablet.

## Movimento, qualidade e dados

- Movimento é continuidade: rail indica mudança de destino; lista → detalhe preserva um
  elemento focal; gráficos respondem ao dedo e à seleção; overlays retornam para a origem
  quando houver origem real. A coreografia pode ser expressiva, mas a informação que alguém
  está lendo não se desloca só por ornamento.
- Reanimated/worklets conduzem transformações e opacidade na UI thread; Skia fica nos gráficos
  que já o usam. Virtualizar listas grandes e estabilizar itens/seletores evita jank sem reduzir
  a ambição do movimento. Uma biblioteca nova só entra por lacuna comprovada e compatibilidade
  verificada com Expo SDK 57; não instalar kit visual que crie uma segunda linguagem.
- `Reduce Motion`/“remover animações” preserva causalidade com crossfade ou corte. Valores em
  centavos inteiros e estados `isError` continuam fontes de verdade; uma animação nunca passa
  por um valor financeiro falso. Ações destrutivas e de alto valor conservam confirmação.
- Alvos de toque: pelo menos 48 dp Android / 44 pt iPad. Ordem de foco, TalkBack/VoiceOver,
  teclado externo, rótulos, contraste, fonte 1,3× (e checagem maior em telas críticas), claro e
  escuro são requisitos, não polimento opcional.

## Estados e falhas

Todo painel trata `loading`, vazio, erro e sucesso separadamente. O painel de apoio vazio explica
o que pode ser selecionado; não finge que há dados. Um erro em uma leitura não invalida outra,
mas bloqueia ações que dependem daquela leitura, inclusive quando o cache ainda possui dados
antigos. Redimensionar durante edição preserva rascunho e foco quando possível; ao falhar, a
recuperação nunca apaga dados. Back, deep link e fechamento de modal funcionam nos dois sentidos.

## Aceite e sequência de implementação

1. **Fundação + cinco raízes:** testes puros da classe de janela e geometria; Android rail;
   composição ampla de Hoje, Notas, Financeiro, Agente e Perfil; telefone sem regressão.
2. **Fluxos profundos:** lista/detalhe e visualização/edição nas notas, agente e 21 rotas
   financeiras; URLs, ações e estados preservados. Revisão pontual do diff concorrente antes
   de tocar no Agente.
3. **Conta e auxiliares:** autenticação, onboarding, busca, lembretes, importação, alertas,
   membros, paywall e formulários; matriz completa de tela/estado e correções agrupadas.

Verificação proporcional: `tsc`, lint e testes existentes + testes da lógica adaptativa;
capturas e interação reais em emulador Android celular/tablet e simuladores iPhone/iPad, em
retrato e paisagem, claro/escuro, fonte ampliada, janela estreita e teclado aberto. No Android,
testar Back e rail; no iPad, tab bar, navegação e gestos. Cada rota voltada ao usuário terá um
registro de **mantida, reestruturada ou apenas contida**, com evidência de renderização; nenhum
resultado de compilação será apresentado como prova de ergonomia ou movimento em hardware.
Desempenho tátil, taxa de quadros e postura dependem de aparelho físico e serão reportados
separadamente do que o emulador/simulador comprovar.

## Fora de escopo

Não alterar cálculos financeiros, contratos de API, banco, agente Python, copy factual,
permissões ou identidade de marca para “preencher” o tablet. Não publicar builds nem fazer
deploy nesta etapa. Não mover ou remover função sem mapear seu destino e seu acesso no fluxo
compacto e amplo.
