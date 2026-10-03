# F04 — registro de execução

Status: **aceito no escopo F04 em 02/10/2026**, com limites explícitos abaixo. F05 liberado.

## Implementação

Branch `gabriel/financas-22-melhorias`, sobre F03 `ae42c6a4`. [Contrato](contrato.md).
`finance-write-input.ts` e `lancamento-write.ts` constroem os argumentos compartilhados entre
prévia e gravação. O componente `FinanceWritePreview` usa o kit Suave nos três corpos do launcher,
com tratamento de identidade, cancelamento, atualização, falha e preferência de ocultação.

A RPC executa o comando autorizado e suas constraints reais numa subtransação revertida;
usa isolamento de fotografia específico da função, com validação em runtime. A projeção de
recorrência no cartão foi corrigida na fonte compartilhada do caixa: conta pagadora e data da
fatura resolvida, incluindo adiamentos. `invoice_target_for` é compartilhada com o trigger real.
Não há calendário financeiro reimplementado no cliente.

## Banco aplicado e API

Somente staging `utkqoiigimqzeenxkxdl`; `.env.local` e link CLI conferidos por
`scripts/supabase-target.sh`. Dry-run listou exclusivamente:

- `20261003000528_finance_write_preview.sql`
- `20261003002625_finance_projected_card_cash.sql`

Push aplicado: exit 0, sem seeds ou roles. Types regenerados do staging; incorporado o contrato
novo da RPC, preservados os contratos anteriores. Produção, release e push Git não executados.

Quatro probes HTTP autenticados TEST passaram pelo decoder real: avulso Pix, compra com entrada,
recorrência futura e financiamento fixo. Tempos 214–266 ms nesta execução, sem promessa de SLA.
Conteúdo de transações, planos, séries, dívidas e faturas idêntico antes/depois; runtime de isolamento
aceito pelo PostgREST. Probes e snapshots privados em `/private/tmp/proops-f04-http-probes.*`.

## Verificação de código e SQL

RED/GREEN dos argumentos canônicos e preparação do lançamento; resposta tardia e troca de
identidade com QueryObserver real; cancelamento do transporte; invalidade, falha e valores
sem base confiável; ocultação também nas camadas de movimento retidas; confirmação automática
prevista distinta de pagamento realizado. O runner SQL ganhou isolamento explícito e testes.

Gates finais até esta etapa: `npx tsc --noEmit` exit 0, `EXPO_NO_DOTENV=1 npx expo lint` exit 0,
`npm test` exit 0: 1.560 testes, zero falhas/skips. React Doctor: 86/100, zero erros e 17 avisos;
16 de complexidade preexistente e um de lookup em F02. Agente não alterado.

SQL contra o staging já aplicado, todos com rollback e exit 0:

- `finance_write_preview.sql`: conteúdo de 18 tabelas, revisões, versões e nonces;
  comparação com comando real; constraints adiadas; Pix/pendente/transferência/taxa;
  fechamento inclusivo, mês curto e bissexto; entrada/histórico/contratos extensos;
  recorrência, qualidade do limite, ACL/RLS/CAS e validação.
- `projected_card_cash.sql`: datas e valores literais independentes; pagadora, horizonte,
  fatura adiada, materialização sem duplicação; conta nula/bancária, transferência,
  legado de receita em cartão, calendário ausente, caller sem auth.uid e permissões.
- `anon_sem_execute.sql`: zero função pública reaberta a anon.

Replay combinado das duas migrations e suítes `caixa_por_conta`, `horizonte_por_conta` e
`ledger_expected_lines`: exit 0, com rollback. A suíte existente
`expected_recurring_occurrences.sql` falhou em fixture com início fixo 01/10/2026 no passado.
Uma cópia temporária preservando assertions e equivalência de calendário avançou esse bloqueio,
mas falhou na contagem de histórico (espera uma versão, recebe duas criadas na primeira edição;
o retry mantém duas). A fronteira vem da restauração do histórico introduzida em F01.
A fixture original permaneceu intacta; as assertions posteriores não foram alcançadas.
Esse resultado é registrado como falha, sem apresentá-lo como suíte verde.
Revisão independente e conferência da fonte mostram intervalos contíguos com os mesmos
atributos; o leitor recorta por validade e conserva as mesmas ocorrências. Neste caso não foi
demonstrada alteração financeira ou duplicação pelo retry. O gate antigo conta representação
física; uma atualização futura deve comparar projeção, revisão e snapshot após primeiro save
versus retry, incluindo continuidade, em vez de apenas substituir a contagem esperada.

## Execução nativa

iOS: iPhone 17 Pro, iOS 26.5, `F0BDF23C-0286-4183-97E3-3BCC61D4267D`.
Android: AVD `tudo_azul_audit_20261002`, `emulator-5574`, API 36 arm64.
Apps DEBUG development 1.6.3 e mesmo Metro staging; nenhuma dependência ou alteração nativa.
Conta TEST autenticada; capturas mostram apenas dados sintéticos do staging.
Na matriz, números sem símbolo monetário estão em centavos; a seta indica antes→depois.

| Cenário | iOS | Android |
|---|---|---|
| Pix quitado, prévia/gravação | R$12,35; −48146→−49381; exatamente um registro | R$10,01; −48146→−49147; exatamente um registro |
| Compra parcelada no cartão | R$100,02 com entrada Pix2000 e plano8002; 2667/2667/2668 | Total10001; 3333/3333/3335 |
| Faturas reais das três parcelas | 05/11, 05/12/2026, 05/01/2027 | Mesmas datas |
| Entrada separada | Saldo−49381→−51381; limite477655→469653 | Sem entrada; limite477655→467654 |
| Recorrência futura, cancelar | 765 em 10/11 e 10/12; horizonte90dias, estimativa | 3210 em três ocorrências; cancelar |
| Financiamento, cancelar | 3×3333=9999; cronograma até10/01/2027 | 3×12899=38697; cancelar |
| Pendente com vencimento, cancelar | 2345 em10/11: saldo−51381 inalterado; previsto−79060→−81405 | Não executado neste incremento; SQL cobre pendente |
| Edição avulsa, cancelar | Pix1235; efeito sem alteração; revisão0 original preservada | Não executada neste incremento |
| Privacidade/cronograma | Resumo e todas as parcelas mascarados; preferência restaurada | Mesmo resultado; preferência restaurada |
| Troca de valor | Testes com QueryObserver; troca pendente/quitado e datas pela UI | 2002→3003: somente efeito final−49147→−52150; cancelado |
| Offline/foco/recuperação | Sem execução nativa | Retomada offline removeu números; recuperação preservou título,1001 e conta; prévia−49147→−50148; cancelado |
| Escuro/fonte grande | iPhone extra-extra-extra-large: limites, datas, cronograma e ação legíveis | 384dp×fonte1,3: quebras de linha sem truncamento |
| Tablet, cancelar | iPad A16/iOS26.5:10001/3; limite469653→459652; última3335 em05/01/2027 | Viewport800dp no mesmo AVD: resumo legível; não é tablet físico |

As tentativas que falharam por seletor, viewport, teclado ou bundle antigo foram diagnosticadas
antes de qualquer novo save. No iOS, Row estático expõe título/subtítulo separadamente; entrada
inicia com origem preenchida; prazo do financiamento deve tocar o TextField `Ex.: 48`; dois
calendários precisam de seletor contextual. No Android, stop/launch carregou o bundle atual.
Nenhum desses erros de automação foi contado como sucesso funcional. Na primeira tentativa
Android de retomada offline houve números antigos no bundle anterior. Depois de cold launch
do bundle atual, o mesmo cenário removeu os números e exibiu recuperação. A causa do estado
anterior não foi isolada; essa tentativa permanece registrada como falha, sem equivaler a pass.
Também houve retry indisponível no rascunho de duas parcelas desse bundle; a RPC com os mesmos
argumentos passou. A recuperação nativa aprovada usa o avulso1001 após cold launch.

O retorno à rede também pode coincidir com falha da consulta de contas do formulário: nesse
estado o rascunho está preservado, mas a prévia deixa de ter entrada válida. A ação existente
“Tentar de novo” recuperou as contas e a prévia automaticamente. A validação não alegou que a
ação da prévia substitui a recuperação dessa dependência.

Os únicos saves foram um Pix e um plano de três parcelas em cada sistema, mais a entrada
associada ao plano iOS. A [prova sanitizada](persistencia-test.json) registra valores/status/
datas/revisões e SHA das migrations. Snapshots privados completos conferiram identidade,
origem e igualdade após cancelamentos; não foram publicados. iOS:4 transações principais,
1 plano e1 entrada; Android:4 transações e1 plano. Zero taxas, séries ou dívidas F04.

Configurações restauradas: iPhone Claro/appearance light/content_size large; iPad sem alteração
de preferência, app encerrado e simulador desligado; iPhone original novamente booted.
Android Sistema,1344×2992,density480,font1,nightno,stylusnull,window/transition1,animatornull,
airplane0/wifi1. Nenhum cleanup dos registros de teste foi executado.

31 capturas em [evidence](evidence/), todas abertas pelo primary; [origem e SHA](captures.json).
Todas mostram dados sintéticos TEST. As evidências de erro,
recuperação e viewport compacto Android foram recapturadas sem o aviso DEBUG sobre a interface
antes de serem encaminhadas à revisão; dispensar o LogBox pela UI não altera o código.

## Limites e aceite

Prévia numérica cobre criação dos quatro comandos e edição de avulso. Edições vinculadas e
conversões ainda pedem alcance na confirmação e não recebem uma simulação de criação;
[contrato](contrato.md) explica a fronteira. Faturas sem calendário não ganham data inventada;
limite sem cadastro ou histórico confiável continua sem número.

Hardware físico, VoiceOver/TalkBack em hardware, offline iOS, release e produção não certificados.
A troca de valor Android foi sequencial; não prova corrida manual abaixo de350ms. Essa borda
tem teste de identidade/QueryObserver e transporte real, sem alegar execução manual equivalente.
Troca de origem, juros e histórico têm cobertura de contratos/SQL; não foram repetidos pela UI
em toda combinação neste incremento. Campos editáveis e cálculo local preexistente do rascunho
continuam visíveis com ocultação ligada; todos os valores novos de “Ao salvar” são ocultados.

Revisão visual independente: **ship** para a extensão Operate, após17 capturas requeridas;
[cinco seções e limites](revisao-visual.md). O documenter acrescentou somente o padrão construído
F04 em `DESIGN.md` e no sidecar existente; identidade/tokens e drift geral preservados.
Primary inspecionou os dois diffs, JSON e escopo, além de abrir todas as31 capturas finais.
Os gates, provas de banco e matriz descritos sustentam o aceite técnico; não certificam os
cenários explicitamente sem execução. F05 pode começar após este registro.
