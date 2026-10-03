# F04 — pacote de revisão visual

Direção confirmada: **Operate**, expansão do mundo Suave / Papel e Tinta existente.
O usuário pediu todos os22 pontos, um por vez, com arquitetura robusta e teste iOS/Android;
reuso do kit, espaçamento/tipografia coerentes, UI/UX cuidada e movimento com qualidade.
F04 acrescenta consequência antes de salvar; não substitui a identidade do app.

Ground truth: `PRODUCT.md`, `DESIGN.md`, `src/design/tokens.ts`, componentes `ui/row.tsx`,
`ui/button.tsx`, `ui/note.tsx`, `motion/presenca.tsx` e os três formulários existentes.
O [contrato F04](contrato.md) fixa o alcance. O [registro nativo](registro-nativo.md)
distingue cobertura de código, SQL, dispositivo e limitações. Não existe comp aprovado
para esta extensão: a implementação incumbente e os tokens são a referência visual.

QUALITY BAR: consequência legível antes da ação existente; progresso de carregamento/erro;
cronograma por revelação progressiva; nenhum número de outro rascunho durante animação;
valores ocultos também em parcelas/metadata; estimativa e horizonte explícitos;
fonte grande/384dp sem truncar valores, identificadores ou ações. Nenhum token novo ou
dependência nativa. Cores semânticas seguem o kit. Calendário financeiro vive no servidor.

Artifact: `src/components/finance/finance-write-preview.tsx`, integrado nos corpos de
`formulario-do-lancamento.tsx`, `formulario-da-serie.tsx`, `formulario-da-divida.tsx`.
Hooks/builders: `use-finance-write-preview.ts`, `finance-write-preview.ts`,
`finance-write-input.ts`, `lancamento-write.ts`.

Referências impeccable: `/Users/gabrielalmeidadias/.agents/skills/impeccable/reference/`
`craft-floor.md`, `ios.md`, `android.md`. **Detector HTML/CSS não executado: plataforma nativa.**
TDD/UI inclui frame retido, privacidade, identidade, cancelamento e resultado atrasado;
a matriz nativa usa a conta TEST em staging. Nenhum dado financeiro pessoal nas capturas.

Capturas requeridas, em `.impeccable/review/f04/`:

Depois da revisão, esses caminhos apontam para os PNGs canônicos em `f04/evidence`, com bytes
conferidos, para conservar as referências da revisão sem duplicar binários no repositório.

- `phone-ios.png`: claro, cartão com entrada, resumo pronto antes de salvar.
- `phone-ios-large.png`, `phone-ios-schedule.png`: escuro, fonte extra-extra-extra-large.
- `phone-android.png`, `phone-android-card.png`: claro, Pix e cronograma do cartão.
- `phone-android-compact.png`, `phone-android-compact-summary.png`:384dp×fonte1,3, escuro.
- `tablet-ios.png`, `tablet-ios-schedule.png`: iPad A16, resumo e cronograma.
- `tablet-android.png`: viewport800dp no AVD, escuro; não é hardware tablet.
- `privacy-ios.png`, `privacy-android.png`: cronograma com valores ocultos.
- `recurring-ios.png`, `financing-android.png`, `pending-ios.png`: demais estados prontos.
- `offline-android.png`, `recovered-android.png`: erro e recuperação sem alterar rascunho.

Capturas são nativas, aguardam resultado pronto e animação estabilizada. Nas capturas de
cronograma a rolagem contextual é deliberada; não são prints do topo do formulário.
Todas as imagens encaminhadas precisam ser abertas uma vez pelo primary antes da revisão.

Os cinco blocos do contrato foram explicitados ao reviewer a partir da direção existente:
THESIS = consequência do próprio rascunho antes de salvar; OWN-WORLD = Suave/Papel e Tinta;
STORY = preencher→conferir→cronograma opcional→salvar; FIRST VIEWPORT = editor incumbente e
header preservados, resumo após os campos; FORM = kit Section/Row/Note/Button e movimento
de presença/troca. Sem seed novo ou comp aprovado; esse limite de input foi declarado.

## Veredito independente

`impeccable_finish_reviewer`, GPT-6.1 Sol/high, contexto novo sem histórico herdado.
**disposition: ship** após abrir as17 capturas requeridas e inspecionar a amostra de código.

- **persistence:** PRODUCT/DESIGN e pacote sustentam o mundo observado.
- **fidelity:** TYPE, MATERIAL, GROUND e os cinco blocos acima correspondem ao kit e contrato.
- **ceiling:** atingido para esta extensão Operate; fonte ampliada,384dp e tablets legíveis;
  privacidade integral no resumo/parcelas; horizonte e estimativa explícitos; recuperação clara.
- **material_fixes:** nenhuma material demonstrada no escopo F04.
- **keep:** discrição do resumo, ritmo do kit, quebras sem truncamento, estimativas e ocultação.

A revisão não certifica hardware, leitor de tela, desempenho ou movimento por uma imagem
estática. Código/harnesses sustentam a proteção temporal; a matriz nativa e SQL têm seu aceite
próprio no registro. O documento do padrão é produzido após esse veredito, preservando a
identidade existente; não há reparo geral do sidecar antigo.
