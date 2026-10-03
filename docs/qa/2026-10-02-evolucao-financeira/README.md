# Execução e evidência — evolução financeira

Baseline `main b7eccc0e`; branch `gabriel/financas-22-melhorias`. Início 02/10/2026.

Contrato: [spec dos 22 pontos](../../superpowers/specs/2026-10-02-evolucao-financeira-22-pontos-design.md) e [plano](../../superpowers/plans/2026-10-02-evolucao-financeira-22-pontos.md).

## Ambiente confirmado

`scripts/supabase-target.sh`: CLI e `.env.local` = staging `utkqoiigimqzeenxkxdl`. `.env` isolado ainda aponta para produção; processos de teste precisam carregar explicitamente `.env.local`/variante development. Não houve escrita de produção.

Android: `emulator-5574`, AVD `tudo_azul_audit_20261002`, Android 16/API 36/arm64.
Build DEBUG development atual instalado (1.6.3/versionCode 1), APK SHA-256
`852b072737dbfb29117770db1eac280a65e7c2a82c119a6c75a39d8880950412`.
As demais instalações e dados do AVD foram preservados. iOS: iPhone 17 Pro, UDID
`F0BDF23C-0286-4183-97E3-3BCC61D4267D`, runtime 26.5, app DEBUG. Usuário liberou o acesso;
a conta de teste do app está autenticada nos dois sistemas. **Selo STAGING verificado nas duas
interfaces**, além da configuração e do link CLI. Simulador isolado `ProOps F01 QA iOS`,
UDID `C7ECB864-1C0B-4E4D-B0E7-0B7037305D4B`, desligado para eliminar ambiguidade de driver.
A validação segue no iPhone original. Metro usa somente variáveis públicas de `.env.local`,
`EXPO_NO_DOTENV=1 APP_VARIANT=development` e host `127.0.0.1` acessível ao reverse do Android.
Esses fatos e a abertura do formulário ainda não equivalem ao aceite funcional.

## Estado por ponto

| Id | Feature | Estado | iOS | Android |
|---|---|---|---|---|
| F01 | Forma de pagamento | Aceite técnico no staging em 02/10/2026 | Validado na matriz | Validado na matriz |
| F02 | Criar origem no fluxo | Aceite técnico no staging em 02/10/2026 | Validado na matriz | Validado na matriz |
| F03 | Saldo/limite no seletor | Aceito; qualidade explícita, privacidade e consultas agregadas | Validado; limites no registro | Validado; offline/recuperação incluídos |
| F04 | Prévia do efeito | Aceito; argumentos compartilhados, rollback e identidade | Validado; entrada/edição/pendente/fonte/iPad | Validado; centavos/privacidade/offline/compacto |
| F05 | Filtros por pagamento | Aceito; seleção múltipla, paginação e dados preservados | Validado; fonte/privacidade/iPad; limites no registro | Validado; página 2/offline/recuperação/compacto |
| F06 | Classificações independentes | Aceito; snapshots, defaults e recortes independentes | Matriz nativa e oráculos aprovados; limites no registro | Matriz nativa, offline/retry e oráculos aprovados; limites no registro |
| F07 | Reserva dedicada | Liberado após aceite F06 | Não validado | Não validado |
| F08 | Metas no planejamento | Aguardando F07 | Não validado | Não validado |
| F09 | Subcategorias | Aguardando F08 | Não validado | Não validado |
| F10 | Prazo pela contribuição | Aguardando F09 | Não validado | Não validado |
| F11 | Alocar/transferir | Aguardando F10 | Não validado | Não validado |
| F12 | Aporte/resgate | Aguardando F11 | Não validado | Não validado |
| F13 | Resultado/reavaliação | Aguardando F12 | Não validado | Não validado |
| F14 | Plano percentual | Aguardando F13 | Não validado | Não validado |
| F15 | Explicação de mudanças | Aguardando F14 | Não validado | Não validado |
| F16 | Voz contextual | Aguardando F15 | Não validado | Não validado |
| F17 | Ajuda e avisos | Aguardando F16 | Não validado | Não validado |
| F18 | Transferência recorrente | Aguardando F17 | Não validado | Não validado |
| F19 | Marcos nas metas | Aguardando F18 | Não validado | Não validado |
| F20 | Acumulação/renda futura | Aguardando F19 | Não validado | Não validado |
| F21 | Primeiro cadastro guiado | Aguardando F20 | Não validado | Não validado |
| F22 | Favoritos/duplicação | Aguardando F21 | Não validado | Não validado |

## Registro obrigatório por incremento

Cada entrega acrescenta: arquivos e contrato alterado; testes RED/GREEN e comandos/códigos de saída; migrations/aplicação/tipos; cenários de persistência com dados controlados; aparelho/build/backend; passos e resultado real de cada plataforma; capturas; problemas corrigidos e limites. Sem esses dados, não marcar “aceito”.

## Descoberta inicial

Repositório inicialmente limpo. Foram usadas impeccable, UI/UX Pro Max e skills de planejamento/TDD. Dois trabalhadores fizeram descoberta de contratos e sistema visual, somente leitura. A primary conferiu contratos e consolidou a especificação. Identificados: frontend antigo em docs/design, FinanceAction no teto de schema e lookup ambíguo/edição parcial dos juros do Pix. F01 precisa tratar o caminho tocado antes de aceite.

A pesquisa de UI/UX Pro Max retornou sugestões genéricas de landing/serifas/azul que não correspondem ao produto; a identidade existente prevalece. Sidecar impeccable está mais antigo que DESIGN.md; não foi reparado fora do escopo. Primitivos e regra recente governam o vidro dos controles iOS.

## F01 — implementação e aceite técnico

Implementados o seletor compartilhado nos formulários, a preservação da escolha entre formatos, padrões de série/compra/financiamento e método independente da entrada. A compatibilidade filtra contas sem apagar seleção, título ou valor. Crédito exige cartão; métodos antigos continuam desconhecidos. Detalhe exibe o método e duplicação conserva-o.

A gravação de lançamento e taxa passa por uma RPC atômica com revisão esperada e identificador de intenção. Retry após perda de resposta conserva a intenção; nova criação após confirmação renova-a. Taxa usa FK explícita: conta/data/descrição não adotam taxas antigas. Builder canônico de conversão envia uma linha principal e taxa explícita, sem linha de juros solta. Criação recorrente também usa intenção idempotente. A validação usa o formulário visível ao configurar série ou compra, preservando o rascunho oculto.

Evidências que sustentam o aceite:

- Helpers e harnesses compartilhados: 102 testes, exit 0; RED antes do builder canônico.
- Hooks/UI: intenção idempotente em criação/retry, revisão, omissão/null, nova intenção após
  confirmação, vínculo explícito da taxa, edição da taxa pelo pai e método da entrada.
- Revisão independente encontrou perda da taxa se o pai tivesse o mesmo título usado pela
  linha de juros. Guardas passaram a usar `pix_fee_for_transaction_id`, sem inferência pelo
  texto. RED: três falhas esperadas; GREEN: 347 testes nas três suítes focadas, exit 0.
- Agente: primary executou a suíte completa: 1219 passed, dois avisos já existentes,
  exit 0; novo teste de scheduler e Ruff F/E9 também passaram. Schema/prompt FinanceAction não mudou.
- Migration final + F01 SQL: exit 0, sempre rollback. Migration final + 18 regressões:
  exit 0, sempre rollback. Arquivos em `/private/tmp/proops-f01-sql-final.log` e
  `/private/tmp/proops-f01-regressions-final.log`.
- **Migration aplicada somente no staging**, dry run/apply com exatamente um arquivo e
  sem roles/seeds. Tipos completos gerados desse projeto; nulabilidade SQL aceita mantida.
- Typecheck após geração/correção de nulabilidade: exit 0. Suíte Node completa após o ajuste do seletor: 1475/1475,
  exit 0. Lint: exit 0. React Doctor: 87/100, oito avisos de complexidade nos formulários;
  sem regressão da nota, sem erro de segurança/correção reportado.
- Maestro 2.11.0 oficial, analytics desabilitado nos testes; nenhum upload para Maestro Cloud.
  iOS: seis métodos e null criados pela interface e conferidos no banco; crédito sem
  cartão foi bloqueado. Android: seis métodos e null criados e conferidos no banco; Pix com título
  digitado em UTF-8 e valor BRL colado também foi verificado. As interrupções do driver não foram contadas como passes.
  Diagnóstico em [F01 Android Maestro](f01/android-maestro-diagnosis.md).
- UI iOS revelou lookup visual errado da origem incompatível: id e hint conservados, mas
  seletor mostrava “Sem conta”. `SelectField` agora aceita a identidade preservada, sem
  oferecê-la como alternativa elegível; `AccountPicker` recebe a conta da lista completa.
  O cabeçalho incompatível fecha a lista sem emitir uma seleção. Campo de juros ganhou
  label acessível próprio. RED observado no harness e nos campos; GREEN: 76 testes focados,
  typecheck e lint exit 0. Validação nativa dessa correção passou nos dois sistemas após recarga do app: conta
  incompatível preservada, seleção compatível deliberada e limpeza explícita do método.
- Android: crédito sem cartão bloqueado; escolha do cartão e gravação conferidas.
  Nas duas plataformas, taxa zero removeu somente a filha vinculada, preservando a outra
  compra no mesmo dia; Boleto pendente foi quitado sem perder conta/método/vencimento;
  transferência própria bloqueou origem=destino e permaneceu `kind=transfer` ao salvar.
- Recorrência mensal: um contrato por plataforma após duplo toque, três ocorrências
  de R$ 32,10 materializadas e os três alcances de edição conferidos por UI e SDK.
  Só esta: Débito/Boleto/Boleto; próximas: Débito/Pix/Pix; todas: Transferência nas três.
  O padrão da série acompanhou somente os alcances previstos, soma R$ 96,30 preservada.
- Parcelas/entrada: iOS e Android gravaram plano Boleto de R$ 80,02 em três parcelas
  (26,67 / 26,67 / 26,68), primeira já paga, mais entrada Débito de R$ 20,00 em Poupança.
  FKs independentes, total combinado R$ 100,02. Não houve inferência por nome de taxa.
- iOS: financiamento Boleto, troca entre os três formatos e cancelamento, salvar/criar
  outro mantendo método/conta e limpando campos da nova compra, conversão de legado null
  para recorrência Pix conservando UUID/valor/status. Pagamento de parcela herdou Boleto:
  uma saída de 12.899 centavos e saldo da dívida 25.798, uma parcela paga.
- Novos testes SQL de materialização/histórico/legado e conversão/replay passaram com
  rollback no staging aplicado. A migration aplicada permanece com o SHA registrado.
- Revisão iOS: capturas em claro e escuro, texto ampliado extra-extra-extra-large;
  método, origem, taxa e ação continuam legíveis, sem truncamento na composição revisada.
  Tema Claro, appearance light e content_size large originais restaurados.

- Android: financiamento, troca/cancelamento, salvar/criar outro e conversão passaram,
  com os mesmos valores/identidades previstos para cada caso. Gravação offline conservou
  rascunho e zero registros; retry online gravou exatamente um gasto Pix de R$ 14,57.
- Revisão Android: telefone de 384 dp em escuro/fonte 1,3 e largura de 800 dp em escuro,
  com método, origem, juros e total legíveis. Dimensões, densidade, fonte, tema, stylus e
  conectividade originais restaurados. Preferência de movimento reduzido foi testada
  separadamente, com relançamento do app e restauração em `finally`.
- Snapshot final por leitura: 37 registros QA principais/parcelas, duas taxas vinculadas,
  quatro séries, dois planos, duas entradas, duas dívidas e um pagamento de dívida.
  Os registros de teste permanecem no staging; IDs e dependências constam em
  [snapshot-final.json](f01/evidence/snapshot-final.json), sem usuário/workspace/credenciais.

- Movimento reduzido iOS: iPad com preferência confirmada ativa, app relançado,
  foco nos juros, rolagem até Data, Salvar acessível e cancelamento passaram. OFF original
  restaurado, app encerrado e iPad novamente desligado. Capturas revisadas pela primary.
- Smoke do agente isolado (`proops-f01-smoke`, porta local 18081): startup + health 200,
  webhook sem assinatura 401 e payload de número sintético assinado por
  `scripts/fake_meta.py` 200. Banco staging e token inválido do override `sem-envio`
  confirmados dentro do container; nenhum erro/traceback no log. Este smoke cobre boot/HMAC,
  não é probe de Gemini nem prova de paridade de criação por voz. Container encerrado ao fim.
  Evidência: `/private/tmp/proops-f01-agent-smoke-{up,hmac,container,down}.log`.

**Aceite técnico F01 concluído em 02/10/2026.** A primary conferiu a matriz,
resultados dos comandos, capturas e persistência. [Registro e rastreabilidade](f01/registro-nativo.md).
F02 liberado. Offline nativo iOS e teclado virtual iPad continuam explicitamente sem
execução, conforme limites complementares do registro; não foram transformados em passes.
Hardware físico, release, produção e paridade de criação Gemini não são certificados.

## F02 — implementação e aceite técnico

[Contrato](f02/contrato-de-implementacao.md) e [registro de execução](f02/registro-nativo.md).
Cadastro contextual compartilha campos com Contas e conserva o lançamento. Criação atômica,
UUID de intenção, confirmação perdida/retry e leitura da entidade atual foram verificados.
Fonte final: 1.512 testes, TypeScript/lint exit 0; SQL rollback e concorrência real passaram.
Criação/persistência de corrente negativa, cartão, recorrente e conta da entrada conferidas
no iOS e Android, além de cancelamento/volta, nome duplicado/longo, teclado, escuro,
fonte ampliada, tablet e movimento reduzido. Snapshot final: 13 contas e 11 registros F02.
Offline/retry nativo foi executado no Android; offline nativo iOS permanece sem execução.
Hardware físico, release e produção não são certificados. F03 liberado após esse aceite.

## F03 — aceite

[Contrato e arquitetura](f03/contrato-de-implementacao.md), [registro nativo e limites](f03/registro-nativo.md).
Gates finais: Node 1.529/1.529, TypeScript e lint exit 0; SQL de obrigações/RLS em rollback
contra a migration aplicada no staging, exit 0. Duas consultas agregadas para 100 seletores.
Saldo/limite, privacidade, null/zero/negativo, fonte ampliada e tema conferidos nos dois sistemas.
Um gasto Pix por plataforma, 1.234 centavos, conferido no banco e refletido imediatamente no
saldo do seletor. Android offline/recuperação conservou rascunho e origem. Dezenove capturas
inspecionadas e arquivadas; configurações dos dispositivos restauradas. F04 liberado.

## F04 — prévia do efeito e aceite técnico

O resumo “Ao salvar” simula a operação real com os mesmos argumentos da gravação e desfaz
todas as alterações antes de responder. Mostra saldo atual, caixa previsto com horizonte,
limite disponível, entrada/juros e cronograma progressivo. A identidade do rascunho e a
privacidade impedem números antigos ou ocultos de reaparecerem nas transições. Recorrência
no cartão usa a conta pagadora e a fatura resolvida na regra compartilhada do servidor.

[Contrato e fronteira](f04/contrato.md), [registro completo](f04/registro-nativo.md),
[31 capturas com origem/SHA](f04/captures.json), [persistência sanitizada](f04/persistencia-test.json)
e [veredito visual ship](f04/revisao-visual.md). TypeScript/lint exit 0; Node1560/1560;
SQL do incremento/API/staging e saves únicos conferidos. A suíte antiga de recorrência
com fixture vencida/assertion física de histórico continua registrada como falha; não foi
contada como verde. Limites nativos e de hardware constam do registro. Duas migrations
aplicadas só no staging, sem seeds/roles. Nenhum push/release/produção. F05 liberado.


## F05 — recortes por pagamento

Aceite técnico no staging em 03/10/2026. Seleção múltipla no componente compartilhado,
rascunho cancelável, Todos por grupo, Não informado explícito, contagem/resumo humano,
links validados e filtragem no servidor antes da paginação. As previsões usam a mesma
seleção sem materialização; o resumo global fica oculto em recortes. QA também corrigiu
dinheiro excessivamente encolhido no Row iOS e nomes acessíveis que revelavam valores ocultos.

TypeScript/lint exit 0; suíte completa **1.590 passed, 0 failed/skip/cancelled**. HTTP real
compara 10 recortes e todas as páginas com leitura independente; todas as colunas dos
121 lançamentos, 7 recorrências, 10 planos e 4 dívidas permanecem idênticas.
iOS/Android cobrem draft/aplicar/limpar/links/busca/conta/detalhe, previsões, dinheiro
máximo sintético, ocultação visual/acessível, temas e fonte ampliada; Android inclui
página 2 e offline/recuperação. iPad e viewport 800dp Android conferidos. Revisão independente
**ship**, após abrir as 23 capturas finais; nenhum defeito visual material de F05.

[Contrato](f05/contrato.md), [registro nativo e limites](f05/registro-nativo.md),
[prova sanitizada de leitura](f05/leitura-staging.json), [capturas verificadas](f05/captures.json)
e [revisão visual](f05/revisao-visual.md). Sem migration, escrita financeira, produção,
push ou release. Offline iOS, fala de leitor de tela, hardware físico e benchmark de
frames não foram certificados. A restauração das preferências dos simuladores foi concluída.

## F06 — classificações independentes

Aceite técnico em 03/10/2026 no staging. Previsibilidade e necessidade são escolhas
opcionais independentes; padrões da categoria viram snapshots, decisões manuais/null
ficam protegidas e alterar histórico exige uma ação explícita. Criação, edição por
alcance, troca de formatos, prévia, detalhe e recortes compartilham o mesmo contrato.

Node1.703/1.703, TypeScript/lint exit0, quatro migrations novas e suites SQL/replay/CAS/
concorrência aprovadas. iOS/Android passaram a matriz e recuperação final de URL inválida;
Android inclui retry offline com exatamente uma escrita. Oito hashes financeiros
comprovam preservação nas reclassificações. Revisão independente de17 capturas pediu
uma correção de copy, resolvida e recapturada: ship para a correção pontuada.
Documentação visual reconciliada por merge, sem trocar tokens ou identidade.

[Aceite e limites](f06/aceite.md), [contrato](f06/contrato.md),
[registro nativo](f06/registro-nativo.md), [banco](f06/registro-sql.md),
[revisão visual](f06/revisao-visual.md). Sem push/release/produção. F07 liberado.
