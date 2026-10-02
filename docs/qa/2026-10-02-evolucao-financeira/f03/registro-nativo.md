# F03 — registro de QA nativo

Estado: **aceito no escopo F03 em 02/10/2026**. Executado no branch `gabriel/financas-22-melhorias`, build DEV 1.6.3, contra staging `utkqoiigimqzeenxkxdl`, conta TEST. Este registro complementa o [contrato F03](./contrato-de-implementacao.md); implementação em [AccountPicker](../../../../src/components/finance/account-picker.tsx), [opções e metadados](../../../../src/lib/accounts.ts) e [migration](../../../../supabase/migrations/20261002231028_account_picker_context.sql).

## Gates

| Verificação | Resultado |
|---|---|
| `npm test` (`all-tests-v2`) | exit 0; 1.529 passaram, 0 falharam. |
| `npx tsc --noEmit` (`tsc-v2`) | exit 0; log vazio. |
| `npx expo lint` (`lint-v2`) | exit 0. |
| SQL `account_picker_context.sql` no staging | passou; execução termina com rollback. |
| React Doctor | 86/100, sem erros; 16 avisos (15 de complexidade e 1 busca de array no loop, em `account-form.tsx`). |
| Imutabilidade da migration | SHA-256 `ca0bc94dd76d914d6c2b1a4dd8275e7729a38b003fb43d2eee38be9f4ec46488`. |

## Cenários nativos registrados

| Caso | iOS | Android |
|---|---|---|
| Conta corrente com saldo confirmado negativo; sinal preservado (`−R$ 469,12`) | passou; captura integral no fluxo de gravação | passou |
| Cartão com limite disponível derivado de todas as faturas (`R$ 4.776,55`) | passou | passou |
| Cartão com limite disponível zero continua selecionável; botão Salvar habilitado | passou | passou |
| Trocar origem conserva rascunho (`QA F03 … metadata 20261002`, `R$ 12,34`); fechar encerra o formulário | passou | passou |
| Privacidade: opção selecionada e lista ocultam o valor com seis marcadores; reexibir restaura a preferência | passou | passou |
| Cartão sem limite cadastrado: texto explícito, sem zero inventado e Salvar habilitado | passou | passou |
| Cartão com saldo inicial histórico: precisa de conferência, sem disponibilidade inventada e Salvar habilitado | passou | passou |
| Limite disponível negativo (`−R$ 9.343,16`) conserva sinal e permite escolher | passou | passou |
| Fonte ampliada, textos inteiros e tema | fonte extra-extra-extra-large em claro; prova escura do contexto em execução separada | escuro, largura 384 dp, fonte 1,3 |
| Gasto Pix de R$ 12,34 gravado pela interface; seletor atualizado de −R$ 469,12 para −R$ 481,46 | passou; um registro conferido no staging | passou; um registro conferido no staging |
| Sem rede, retorno do background, envio bloqueado e retry conserva título/valor/origem | não executado nativamente | passou; modo avião + Wi-Fi desligado, erro de contas, recuperação pela ação existente |

Dispositivos: iPhone 17 Pro, iOS 26.5 (`F0BDF23C-0286-4183-97E3-3BCC61D4267D`); emulador Android `5574`, API 36. **19 capturas reais foram inspecionadas pelo agente principal** e copiadas para `imagens/`; [manifesto com origem e SHA](evidence/captures.json). Números, rótulos acessíveis e estados dos botões foram conferidos pela hierarquia nativa. Preferência de privacidade restaurada nos dois sistemas; iOS Claro/fonte large e Android Sistema/dimensões/fonte/movimento/handwriting/conectividade originais restaurados e conferidos.

As primeiras tentativas no iOS não passaram por interação com teclado/toque e por uma asserção de “Criar cartão” fora da área visível. A hierarquia confirmou que a lista estava aberta; a retomada `ios-metadata-resume-v3` concluiu os casos registrados acima. A primeira tentativa de privacidade Android procurou o controle na aba Hoje; o fluxo corrigido pela aba Finanças passou. Fonte ampliada no iOS exigiu dispensar o teclado pelo Return e recentralizar o cabeçalho após a seleção; a repetição concluiu os casos. As capturas dessa repetição estavam em **claro**, apesar do nome original do teste; o manifesto e os nomes arquivados corrigem essa classificação. O contexto escuro foi validado separadamente, sem relançar entre a escolha do tema e a abertura do formulário. Falhas iniciais não contam como passes. O aviso de conexão do LogBox nas capturas offline pertence ao build DEBUG.

## Persistência e contrato de consulta

[Snapshot final limitado ao F03](evidence/snapshot-final.json), sem usuário/workspace/credenciais. Dois gastos `expense/cleared`, 1.234 centavos, método `pix`, um por plataforma:

- iOS: `4daef78c-795b-4f44-8a6b-c9921d676a79`, conta `60bf2681-7cc0-48c5-b0cd-f4a8b96d3328`.
- Android: `778fac2f-cc20-46b7-a746-3b906141e875`, conta `8d3b86e2-84d2-4536-b29e-cbc29110c134`.

Cada descrição aparece uma vez; nenhuma taxa, transferência, série, plano, dívida ou entrada vinculada. Saldo confirmado das duas contas: −48.146 centavos. Formulários de consulta/privacidade/visual/offline foram fechados sem gravar.

O [SQL de rollback](../../../../supabase/tests/account_picker_context.sql) cobre exposição de faturas atuais e futuras, pagamento parcial, adiamento com juros/IOF e desfazer, quitação manual/desfazer, exclusão do pagamento, null/zero/negativo, saldos iniciais assinados, receita/estorno, débito/transferência sem fatura e transferência de entrada sem vínculo. JWTs de workspaces diferentes e ACL de anon também foram exercitados; nenhum fixture SQL persistiu. Dry run e aplicação no staging continham só a migration F03, sem roles/seeds. Types gerados desse projeto: entrada nova da RPC incorporada preservando as correções de nulabilidade existentes que o gerador não representa.

RED/GREEN das opções e do componente real cobre erro, carregamento, pausa, atualização, overflow, campos ausentes e privacidade antes da preferência carregar. Um teste de animação falha quando o snapshot anterior perde a proteção de privacidade; a proteção foi restaurada e o teste passou. QueryClient/QueryObserver reais com 100 seletores fazem exatamente duas RPCs agregadas, sem consulta por opção. A revisão independente encontrou um retry bancário bloqueado por consulta de cartão ativa em outro campo: RED reproduziu a falha; o botão agora considera somente os recursos que está recuperando. Suítes focadas finais: 123/123, exit 0.

## Fixtures de cartão no staging

Criadas por SDK/RLS, com guarda de staging, usuário e workspace, IDs estáveis e sem override. São cadastros exclusivos da evidência nativa, sem lançamento vinculado, distintos dos fixtures SQL de rollback. [Dados e qualidade retornada](evidence/legacy-fixtures.json).

| ID | Nome | Limite cadastrado | Saldo inicial | Resultado |
|---|---|---:|---:|---|
| `cb17ec53-b2a4-4ca0-8df2-3ab4918d1a11` | QA F03 Sem limite 20261002 | null | 0 | `not_set`; limite disponível null |
| `3b67ca63-3149-40a1-98eb-8d270317d221` | QA F03 Legado 20261002 | R$ 1.000,00 | R$ 10,00 | `needs_review`; limite disponível null |

Os casos cobrem limite ausente e legado incompleto sem inventar disponibilidade. IDs identificam as fixtures; dados pessoais e de workspace foram omitidos.

## Limites do aceite

Falha exclusiva da RPC de saldo/limite, pausa do TanStack e ocultação durante saída animada foram verificadas no harness do componente real; não foram forçadas isoladamente no dispositivo. No offline Android a consulta de contas também falha, então o formulário usa sua recuperação existente e desmonta o seletor até recuperar a identidade; não foi contado como demonstração nativa da ação específica **Atualizar saldos e limites**. Não houve desconexão real do simulador iOS, teste com leitor de tela ligado, hardware físico, release ou produção. O aceite cobre as implementações e cenários descritos, sem prometer cobertura de toda situação possível. F04 está liberado após este aceite.
