# F05 — pacote de revisão visual

Direção: **Operate**, extensão do mundo **Suave / Papel e Tinta** existente.
O pedido é implementar os 22 pontos em sequência, com arquitetura robusta, teste real
iOS/Android, componentes reutilizados e qualidade de tipografia, espaçamento e movimento.
F05 acrescenta recortes por pagamento à folha incumbente; não introduz outra identidade.

Ground truth: `PRODUCT.md`, `DESIGN.md`, `src/design/tokens.ts`, `finance/chip.tsx`,
`ui/row.tsx`, `ui/list-filters.tsx`, `ui/filter-bar.tsx`, `ui/sheet.tsx` e a tela de
Lançamentos. O [contrato](contrato.md) e o [registro](registro-nativo.md) delimitam
funcionalidade e prova. Não existe comp aprovado; a implementação incumbente e os
tokens são a referência de crítica. O catálogo de valores máximos é sintético e local.

Aplicabilidade da skill: `reference/new-work.md:29–31` determina herdar mundo/composição
ao estender uma superfície, sem concept tournament; a linha39 proíbe executar o roll
para extensão local. Assim, **seed/comp não se aplicam** a F05. Os blocos abaixo tornam
o alcance auditável sem fabricar uma direção ou trocar o padrão solicitado pelo usuário.

## Cinco blocos da direção

- **THESIS:** encontrar os lançamentos por método, incluindo histórico desconhecido,
  sem perder outros critérios nem publicar um total global como total filtrado.
- **OWN-WORLD:** Suave / Papel e Tinta; preto/branco sem nova paleta, controles e vidro
  nativo existentes, tipografia e ritmos do kit.
- **STORY:** abrir Filtros → escolher métodos no rascunho → aplicar → conferir lista;
  fechar cancela; Todos remove só o grupo; Limpar reinicia os critérios.
- **FIRST VIEWPORT:** navegação, busca e régua de período preservadas; resumo do recorte
  e contagem antes da lista; erro de link tem recuperação explícita.
- **FORM:** folha compartilhada, chips com seleção/feedback tátil/molas do projeto,
  conteúdo que quebra em linhas conforme largura/fonte; dinheiro legível no `Row`.

QUALITY BAR: métodos legíveis e selecionados distinguíveis nos dois temas; fonte máxima,
384dp e tablets sem números ilegíveis ou ações cortadas; critério múltiplo contado uma
vez; nomes humanos no resumo; cancelamento inequívoco; ausência de vazamento de dinheiro
oculto no visual e em rótulos; estados vazios/erro/recuperação honestos. Sem dependência,
API privada, paleta nova ou animação paralela.

Artifact: `src/app/finance/transactions.tsx`, `src/components/ui/list-filters.tsx`,
`filter-bar.tsx`, `row.tsx`, `src/lib/payment-method-filters.ts`, hooks de finanças e
`ledger-expected.ts`. As demais mudanças financeiras alinham nomes acessíveis ao
formatter de ocultação existente. `catalog.tsx?rows=1` é exclusivo de desenvolvimento.

Referências impeccable: `/Users/gabrielalmeidadias/.agents/skills/impeccable/reference/`
`craft-floor.md`, `ios.md`, `android.md`. **Detector HTML/CSS não executado: plataforma nativa.**

## Capturas requeridas

Todas em `.impeccable/review/f05/`, com links relativos para os bytes canônicos em
`f05/evidence`. Origem, SHA-256, dimensões, contexto e abertura pela primary constam em
[captures.json](captures.json). Todas foram abertas e mostram o estado indicado.

- `phone-ios-chips.png`, `phone-ios-list.png`: claro, seleção restaurada/aplicada.
- `phone-ios-dark-chips.png`, `phone-ios-dark-list.png`: escuro, fonte máxima iOS.
- `phone-ios-money-max.png`: catálogo sintético, número completo com fonte máxima.
- `privacy-ios.png`, `invalid-ios.png`, `transfer-ios.png`, `predictions-ios.png`:
  ocultação, link inválido, transferência recebida e previsões Boleto.
- `phone-android-chips.png`, `phone-android-list.png`: claro, métodos e busca+Pix.
- `phone-android-compact-chips.png`, `phone-android-compact-money.png`: escuro,
  384dp/fonte1,3, seleção e valor de R$20.000,00.
- `phone-android-money-max.png`: 384dp/fonte3, catálogo sintético de valor máximo.
- `privacy-android.png`, `privacy-detail-android.png`: lista/detalhe ocultos finais.
- `offline-android.png`, `recovered-android.png`, `page-two-android.png`: erro real de
  rede, recuperação e registro desconhecido além da página inicial.
- `tablet-ios-chips.png`, `tablet-ios-list.png`: iPad A16 real no simulador.
- `tablet-android-chips.png`, `tablet-android-list.png`: viewport 800dp no AVD de telefone;
  não corresponde a hardware tablet.

As capturas de valores máximos e algumas folhas são contextuais, deliberadamente
roladas. As capturas de grupo completo substituem enquadramentos antigos incorretos;
nenhuma imagem foi editada/comprimida. Capturas estáticas não certificam movimento,
fala de leitor de tela ou desempenho. Um vídeo nativo iOS tem inspeção de frames
amostrados documentada separadamente, sem alegação de FPS da aplicação.

## Veredito independente

`impeccable_finish_reviewer_f05`, GPT-6.1 Sol/high, contexto novo sem histórico herdado.
**disposition: ship**, após abrir as 23 imagens, conferir hashes/dimensões e amostrar código.

- **persistence:** PRODUCT/DESIGN/tokens sustentam o mundo incumbente; capturas válidas.
- **fidelity:** TYPE/MATERIAL/GROUND e os cinco blocos correspondem ao padrão; reflow
  de dinheiro é adaptação justificada de acessibilidade, sem identidade paralela.
- **ceiling:** atingido no alcance F05; seleção, espaçamento, hierarquia, fonte ampliada
  e recuperação estão legíveis nas classes capturadas.
- **material_fixes:** nenhuma correção visual material demonstrada neste incremento.
- **keep:** chips compartilhados, resumo humano, contagem por grupo, dinheiro completo,
  ocultação e materiais próprios de cada plataforma.

É uma revisão estática com código amostrado: não certifica interação, benchmark ou fala.
O reviewer não executou os testes ou aparelhos; o registro de QA sustenta esses aceites
separadamente. A documentação de DESIGN/sidecar segue o comportamento construído,
preservando o schema existente e sem reparar metadata antiga fora de escopo.
