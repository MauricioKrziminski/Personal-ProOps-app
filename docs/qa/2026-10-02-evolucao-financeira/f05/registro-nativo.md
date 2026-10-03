# F05 — execução e evidência

Branch `gabriel/financas-22-melhorias`, sobre F04 `8ea1fdbe`. Execução entre
02–03/10/2026. Backend **staging `utkqoiigimqzeenxkxdl`**, conta TEST. Produção não
foi usada. F05 é leitura: nenhuma migration, RPC de escrita, criação de lançamento,
contribuição, materialização de previsão ou publicação.

## Entrega

Lançamentos filtra Pix, Crédito, Débito, Dinheiro, Transferência, Boleto e Não informado,
com seleção múltipla, rascunho cancelável, Todos por grupo, limpeza, contagem e resumo
acessível. Query/cache/paginação e previsões usam contrato canônico compartilhado.
Links inválidos bloqueiam a consulta e oferecem ajuste; link vazio limpa o grupo.
O filtro combina com os critérios existentes; o resumo global é ocultado no recorte.

O QA também demonstrou e corrigiu ajuste tipográfico excessivo do dinheiro no `Row`
iOS e exposição de valores ocultos nos nomes acessíveis financeiros. Os detalhes
estão no [contrato](contrato.md); não houve troca de identidade visual ou dependências.

## Código e transporte

- RED/GREEN dos helpers: ordem/duplicatas, null explícito, strings/repetição de
  parâmetros, conjunto inválido, arrays esparsos, omissão e remoção.
- Harnesses dos componentes reais: aplicar/fechar, seleção imutável, Todos mantendo
  outros grupos, Limpar, contagem única e resumo com nomes em vez de IDs.
- Cliente PostgREST real com transporte controlado: método AND outros grupos OR,
  seleção antes do range 50, paginação ordenada, erro/retry, cache e consultas desabilitadas
  para link inválido. Previsões são lidas em todas as páginas e filtradas sem escrita.
- Tipografia: regressão antiga atualizada para validar ajuste somente quando a largura
  e escala exigem uma linha reservada, em vez de forçar ajuste de todo dinheiro inline.
- Privacidade: falha nativa Android antes da correção; testes RED dos nomes de
  lista/detalhe/previsão. Widgets reais `PeriodSummaryCard` e fluxo/`TrendCard` usam
  o formatter real em contexto oculto/revelado. Auditoria das expressões monetárias
  nos rótulos tocados encontrou zero formatter bruto após a correção.
- Gates finais: `npx tsc --noEmit`, `npm run lint`, `npm test`, todos exit 0;
  **1.590 passed, 0 failed, 0 skipped, 0 cancelled**. Logs privados:
  `/private/tmp/proops-f05-{tsc,lint,test}-acceptance.log`.
- React Doctor atualizado não encontrou erros. O scan final versus HEAD tem 14 avisos
  em estruturas preexistentes: 13 funções complexas e 1 mapa de parcelas sem virtualização.
  Uma busca linear nova do resumo foi substituída por `Set.has`. Comparação com um
  arquivo temporário do HEAD, na mesma versão do Doctor, confirmou que complexidade
  de `Row`/Lançamentos já existia. Scores de versões/escopos diferentes não são comparáveis.
- Revisão independente do contrato de filtros/queries não apontou bloqueio. Essa revisão
  leu o código e diff; não executou aparelhos. A revisão visual tem aceite separado.

## HTTP real e invariância dos dados

O harness privado usa os hooks de produção e o cliente HTTP com somente `.env.local`,
confere host staging, usuário/workspace TEST e compara a ordenação de IDs de cada página
com leitura independente do banco. Credenciais e IDs privados não estão no artefato.

Foram comprovados: Pix 19; Não informado 57 em páginas 50+7; seleção Crédito/Pix/Não
informado 86 em páginas 50+36; método+conta+situação+busca 4; pendentes+valores 4;
datas somente inicial 19/final 27; vazio 0; transferência recebida 2; limpeza 121 em
páginas 50+50+21. Há registros correspondentes além dos primeiros 50 globais em todos
os casos relevantes. As 3 previsões de outubro usam Boleto.

A comparação antes/depois é de **todas as colunas**, não só contagem: 121 lançamentos,
7 recorrências, 10 planos parcelados e 4 dívidas idênticos, com hashes por tabela.
Ela cobre a matriz principal iniciada após o primeiro smoke; as recapturas finais e
checagem de ocultação no início são somente leitura. O primeiro smoke antecede esse
snapshot, por isso não se atribui a ele uma comparação temporal que não foi realizada.
Resultados sanitizados em [leitura-staging.json](leitura-staging.json). Snapshots completos,
credenciais e harness autenticado permanecem privados, fora do repositório.

## Matriz iOS

iPhone 17 Pro, iOS 26.5, `F0BDF23C-0286-4183-97E3-3BCC61D4267D`, app DEBUG development
1.6.3, mesmo build nativo anterior, Metro com fonte final. Recarregar a fonte
por cold launch foi necessário para confirmar o comportamento atualizado do `Row`.

| Caso | Resultado real |
|---|---|
| Link com método inválido, Ajustar filtros e aplicação | Consulta bloqueada; recuperação para lista válida |
| Três métodos, Aplicar, alterar rascunho e Fechar | Contagem1; seleção anterior restaurada ao reabrir |
| Busca QA F04 IOS Pix, detalhe e BackButton | Registro 12,35; retorno conserva busca/método |
| Boleto+busca sem correspondência | Estado vazio correto; nenhum registro Pix |
| Todos com busca; Limpar filtros | Todos remove só métodos; Limpar remove critérios |
| Boleto sobre previsões/séries | Financiamento e séries correspondentes; sem tocar previsão |
| Não informado | Metadata null; previsões conhecidas excluídas |
| Conta destino+Transferência | Duas transferências recebidas 34,56; AND entre critérios |
| Escuro+extra-extra-extra-large | Chips completos e valores legíveis; rascunho cancela |
| Catálogo 12,35/999.999.999,99, inline e coluna | Número completo, tamanho legível e chevron preservado |
| Ocultação em início/lista/detalhe/previsões | Visual e hierarquia sem os valores; revelação restaurada |
| iPad A16 | Seleção múltipla, cancelar, Todos/Pix, aplicar e Limpar; folha/lista legíveis |

Fluxos finais privados `proops-f05-ios-final-{start,light,search,methods,large,privacy}.yaml`,
cancelamento retomado em `final-cancel-resume`; catálogo em `ios-row-large-final`;
recaptura do grupo em `ios-chip-focus`. Logs/capturas em
`/private/tmp/proops-f01-ios-qa/.maestro/tests/2026-10-02_23*` e `2026-10-03_001518`.
iPad: `proops-f05-ipad-final` em `000139`, grupo completo `ipad-chip-focus` em `002024`.

Falhas de automação foram corrigidas e os casos repetidos: ponto percentual decimal
inválido no Maestro, label real do campo de busca, Row agrupado acessível e BackButton.
Uma rolagem de recaptura fechou a folha; não foi tomada como captura de chips nem como
regressão funcional. Os enquadramentos incorretos foram descartados do pacote final.

Vídeo local `/private/tmp/proops-f05-ios-filter-flow.mp4`, 110,66s, 1206×2622, H264;
SHA-256 `627b774ba224486a24b8397f0b62020d4f9701453586b8f011ffbb671c8fcaf6`.
Inspecionados frames amostrados de perfil, transição/carregamento, folha, seleção
restaurada e lista escura. Não houve playback integral nem medição de FPS da aplicação;
a taxa aproximada 17,4fps é da gravação e não um benchmark de renderização.

## Matriz Android

`emulator-5574`, AVD `tudo_azul_audit_20261002`, Android 16/API 36/arm64, app DEBUG
development 1.6.3. APK SHA-256
`852b072737dbfb29117770db1eac280a65e7c2a82c119a6c75a39d8880950412`.

| Caso | Resultado real |
|---|---|
| Todos, múltiplos, cancelar/reabrir | Seleção/contagem corretas, cancelar descarta rascunho |
| Pix+busca e Boleto+busca | Registro 10,01 e vazio correto; Todos conserva busca |
| Link inválido e recuperação | Sem lista ampliada silenciosamente; ajuste retorna dados |
| Conta+Pix, detalhe e retorno | Contagem 2 e critérios preservados |
| Não informado+início abril, página 2 | `pc gamer (1/8)`,30/04/2026,900,00, posição 57; filtro na paginação |
| 384dp/fonte1,3/escuro | Chips e salário 20.000,00 legíveis, sem encolhimento indevido |
| 384dp/fonte3/catálogo | 12,35 e 999.999.999,99 completos, inline e coluna |
| 800dp | Lista/folha legíveis no viewport ampliado do AVD |
| Ocultação final após cold launch | Lista/detalhe/previsões e início sem valores no nome acessível |
| Offline avião 1/wifi 0 | Erro real da dependência de período, bordas— e Tentar de novo |
| Rascunho Débito+Boleto offline→online | Seleções conservadas; cancelar descarta só alteração não aplicada |
| Retry online, março 2031 | Vazio real, bordas 01/03–31/03, Gastos/Débito e contagem 2 conservados |

Evidências privadas `/private/tmp/proops-f05-android-*.png`,
`proops-f05-android-row-*.png`, `proops-f05-android-extra-*.png` e logs Maestro.
Os PNGs `extra-hidden-list/detail` são RED anteriores à correção; o pacote usa somente
`extra-fixed-hidden-*`. As hierarquias nativas demonstram a remoção do valor bruto.
O check final do início financeiro pela primary entrou pela aba após o app carregar:
o openLink imediatamente após cold launch havia chegado a Hoje antes da inicialização.
Esse incidente de harness não certifica nem refuta o recebimento de URL inicial pelo OS.

## Restauração, revisão e limites

iPhone voltou à fonte large, OS claro, aparência explícita escura original, régua Ciclo
e valores revelados. iPad voltou ao estado desligado, OS claro e fonte large originais.
Android voltou a 1344×2992/density480/font1/nightno, Sistema, avião 0/wifi 1 e valores
revelados; stylus/animator null e window/transition 1 preservados. Dados não removidos.

As [23 capturas finais](captures.json) foram abertas pela primary, copiadas sem edição
e conferidas por bytes/SHA-256. O [veredito visual](revisao-visual.md) independente é
**ship**, com os cinco blocos do contrato revisados e nenhuma correção visual material.
Aceite técnico em staging em 03/10/2026, com os limites abaixo explicitamente preservados.

Limites: offline iOS não executado; não houve aparelhos físicos, fala real de
VoiceOver/TalkBack ou benchmark de frames. As telas adicionais de finanças receberam
auditoria de código dos labels e gates, não navegação nativa exaustiva de cada uma.
Datas de QA são fixas em outubro 2026; mudança do relógio não é prova do atalho Hoje.
Valores sintéticos extremos testam layout, não gravam patrimônio de teste. Sem produção,
push, release ou alteração das regras de situação herdadas.
