# F01 — Registro de evidência nativa

**Estado:** aceite técnico F01 concluído em 02/10/2026 no staging, após integração,
gates automatizados, execução funcional em iOS/Android, conferência de persistência e
revisão visual. F02 liberado para implementação. O aceite vale para o incremento e os
cenários da matriz; não declara ausência de todos os defeitos possíveis nem valida
hardware físico, release ou produção.

**Ambiente:** staging; iPhone 17 Pro (iOS 26.5, app DEBUG), Android `emulator-5574` (Android 16/API 36, build DEBUG development 1.6.3/versionCode 1) e iPad A16 em portrait (app de telefone, 1640 × 2360). IDs, SHA e detalhes de acesso permanecem no README da execução, não são repetidos aqui. Snapshot portátil exclui `user_id`, `workspace_id`, credenciais e tokens. `amount_cents` é inteiro em centavos; `origin`, `uuid`, `fee_uuid` e `fee_fk` são UUIDs QA. O snapshot não inclui nenhum identificador de usuário ou workspace.

## Resultados com evidência

- **Seis métodos e null:** os registros QA de staging cobrem `pix`, `credit`, `debit`, `cash`, `bank_transfer`, `boleto` e `null` nas duas plataformas. O Pix bancário está agora explicitamente limpo nas duas plataformas (`null`, revisão 3, R$ 123,45, conta bancária preservada); a reabertura confirmou a forma limpa e o valor. O fluxo Android também percorreu a guarda de incompatibilidade e preservou conta/título/valor. Os snapshots preservam o estado anterior Android `pix` e o estado atual `null`. Pix no crédito continua evidenciado em compras separadas com juros nos dois sistemas. Veja [EV01](evidence/01-metodos-e-limpeza.md) e `evidence/snapshot-portable.json`.
- **Pix no crédito e juros:** duas compras no mesmo dia permanecem separadas por FK. iOS A teve juros editados para R$ 5,02 e depois zerados explicitamente sem taxa filha; B permaneceu com R$ 7,00. Android A foi explicitamente zerado, sem taxa filha, enquanto B permaneceu com R$ 7,00 e FK própria. [EV02](evidence/02-juros-pix-ios.md) e [EV03](evidence/03-juros-pix-android.md).
- **Boleto:** lançamentos iOS e Android de R$ 56,78 mudaram de pendente para quitado, conservando método boleto, conta bancária e vencimento 13/10/2026. [EV04](evidence/04-boleto-baixa-ios.md).
- **Transferência própria:** iOS e Android bloquearam origem=destino; salvar para Poupança persistiu `kind=transfer`, método `bank_transfer`, sem taxa. [EV05](evidence/05-transferencia-propria-ios.md).
- **Recorrência:** duplo toque criou um único contrato mensal iOS de boleto, R$ 32,10, dia 2. A ocorrência materializada (`dcb36447-bc66-475c-b493-6cfbc2904e7c`) foi confirmada como Boleto pela UI e pelo snapshot. A abertura/edição e a ocorrência de novembro também mostram Boleto na UI. Os escopos “só esta”, “esta e as próximas” e “todas, inclusive passadas” passaram no iOS e foram conferidos nos snapshots: cada cenário preservou R$ 32,10 por ocorrência, com os métodos esperados. [EV06](evidence/06-recorrencia-ios.md) e [EV08](evidence/08-escopos-recorrencia-ios.md).

- **Parcelas e entrada:** iOS persistiu plano de três parcelas Boleto com resto de centavo, primeira parcela em data passada e entrada Debit em conta Poupança, com FKs distintas e total combinado preservado. [EV07](evidence/07-parcelas-ios.md).

- **Casos complementares:** iOS criou financiamento Boleto (3 × R$ 128,99), registrou uma parcela, alternou formatos sem perder os valores visíveis, salvou e abriu outro formulário limpo preservando Pix/conta, e converteu o lançamento legado para recorrência preservando identidade e estado. Android criou um único contrato Boleto apesar do duplo toque; materializou outubro–dezembro, passou pelos três escopos, validou parcelamento/entrada e financiamento, troca de formato, “salvar e criar outro”, conversão e retry após gravação offline. Capturas de iPhone em modo escuro e texto extra-grande e capturas estáveis de iPad portrait foram revisadas como legíveis. [EV09](evidence/09-casos-nativos-complementares.md), [EV10](evidence/10-interacoes-offline-e-ipad.md) e `evidence/snapshot-native-followup.json`.
- **Revisão visual e movimento reduzido:** iPhone em modo escuro/fonte extra-grande, iPad portrait e Android em 384 dp/fonte 1.3 e tablet 800 dp foram revisados; o movimento reduzido passou em Android e iPad. Método, conta/cartão, juros e total permanecem legíveis nas capturas selecionadas. [EV09](evidence/09-casos-nativos-complementares.md), [EV10](evidence/10-interacoes-offline-e-ipad.md) e [EV11](evidence/11-revisao-visual-android.md).

## Rastreabilidade dos critérios de F01

Os critérios resumidos abaixo vêm de F01 na spec e no plano. A tabela aponta evidência observada; não altera o estado de aceite.

| Critério da spec | Testes automatizados | Evidência nativa | Limite de cobertura |
|---|---|---|---|
| Round trip dos seis métodos e null; editar/limpar; troca incompatível de origem | `src/lib/payment-method-fields.test.ts`, `src/lib/payment-method-flow.test.ts`, `supabase/tests/payment_methods.sql` | EV01, EV11 | UI e persistência cobertas nas duas plataformas; EV11 registra também o bloqueio de Débito com cartão. |
| Pix bancário/Pix no crédito; duas compras Pix com juros no mesmo dia | `supabase/tests/payment_methods.sql`, `src/lib/payment-method-flow.test.ts` | EV01–EV03 | Vínculos e totais são por UUID/FK; sem inferência por data ou título. |
| Boleto pendente/quitado; pagamento externo versus transferência própria | `supabase/tests/payment_methods.sql` | EV04 e EV05 | Evidência nativa combina baixa de Boleto e transferência própria em iOS/Android. |
| Parcelas com resto, entrada independente e data passada | `src/lib/payment-method-flow.test.ts`, `supabase/tests/payment_methods.sql` | EV07 e EV09/EV10 | Os planos/linhas e os totais registrados estão nos snapshots portáteis. |
| Alcances recorrentes e materialização | `supabase/tests/payment_methods.sql`, `supabase/tests/materialize_payment_method.sql`, `agent/tests/test_scheduler_payment_method.py` | EV06, EV08 e EV09; snapshots portáteis | Escopos “só esta”, “esta e as próximas” e “todas” foram executados em ambas as plataformas. |
| Conversão entre formatos preservando identidade, método e total | `supabase/tests/conversion_payment_method.sql`, `supabase/tests/payment_methods.sql` | EV09 e EV10 | Um caso legado representativo passou em cada plataforma; isso não equivale a cobrir todos os payloads antigos. |
| Cliente antigo, retry e payload conflitante | `supabase/tests/payment_methods.sql`, `supabase/tests/conversion_payment_method.sql`, `agent/tests/test_scheduler_payment_method.py` | EV09/EV10 | As suítes do registro de execução estão verdes para cliente antigo, replay e conflito. O retry offline nativo foi exercitado no Android; conflito de payload foi provado em automação, sem reprodução nativa. |
| Método persistido e totais financeiros preservados em iOS e Android | Testes acima e `src/lib/payment-method-flow.test.ts` | EV01–EV10; `snapshot-portable.json` e `snapshot-native-followup.json` | Os estados observados e respectivos montantes estão resumidos nos snapshots, sem IDs de usuário/workspace. |
| Matriz visual complementar: claro/escuro, fonte ampliada, tablet e movimento reduzido | — | EV09–EV11 | iOS dark/fonte ampliada, iPad portrait e Android dark/fonte 1.3/tablet/movimento reduzido foram revistos; o movimento reduzido passou em Android e iPad (evidência iOS). Teclado iPad continua sem prova. |

## Decisão de aceite e limites

A primary conferiu os critérios da tabela, os resultados dos comandos, os estados
persistidos e as capturas. Os seis métodos/null e os fluxos de criação, edição, limpeza,
incompatibilidade, juros vinculados, baixa, recorrência, parcelas/entrada, financiamento,
conversão, troca/cancelamento e salvar/criar outro passaram nas duas plataformas.
Cliente anterior, concorrência, replay, payload conflitante e isolamento também foram
verificados na automação SQL/hooks. Movimento reduzido foi exercitado em Android e iOS
(iPad); temas/fontes e composições estão em EV09–EV11. O smoke local do agente conferiu
startup/health/HMAC, com staging e envio bloqueado, sem alterar o schema Gemini.

Limites complementares preservados:

- Offline nativo iOS não foi simulado: o comando Maestro usado não produz essa condição
  nessa plataforma. Android offline/retry e resposta perdida/replay nos hooks/SQL têm
  evidência própria; não são apresentados como execução offline iOS.
- Obstrução por teclado virtual no iPad não foi conferida: CUA não disponibilizou o
  Simulator/DeviceHub e Ajustes não mostrou controle de teclado de hardware. Os telefones
  percorreram digitação/rolagem nos formulários; isso não certifica teclado virtual iPad.
- Hardware físico, desempenho de release e produção não foram verificados. Não houve
  deploy, OTA, push/tag ou escrita financeira em produção.

O [snapshot final](evidence/snapshot-final.json) reúne o estado atual e IDs dos dados QA
mantidos no staging. Snapshots anteriores são históricos de cada cenário, não contagem
de entidades únicas. Configurações temporárias dos dispositivos e o container de smoke
foram restaurados/encerrados. Esses limites não deixam pendente um critério explícito de
aceite F01 e permanecem rastreáveis para QA complementar.
