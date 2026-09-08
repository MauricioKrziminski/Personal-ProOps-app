# Onboarding e tempo de release

Data: 2026-09-08. Escopo: itens 2 e 10.

**Estado:** onboarding implementado e validado na sessão staging do emulador, incluindo conclusão e reabertura. Pipeline OTA implementado e verificado localmente; nenhuma publicação/build foi executada, portanto entrega OTA e redução real do tempo de CI continuam pendentes.

## 2. Preferências no primeiro acesso

### Causa anterior à correção

`src/app/index.tsx` enviava toda sessão para `/today`; a raiz apenas registrava onboarding. A tela antiga apresentava telefone/WhatsApp como principal superfície, e `finish` somente executava `router.replace('/')`, sem persistência. O pedido de push solicitava permissão sem registrar token.

Nome, tema e avisos financeiros independentes já existiam em `use-profile`, `use-theme` e `use-push`. A correção reutiliza esses contratos. Alertas automáticos e lembretes pessoais continuam separados.

### Implementação

- Nome opcional, tema e os mesmos controles de avisos financeiros do Perfil, sem exigir WhatsApp nem mostrar histórico durante configuração.
- Conclusão grava `onboarding_completed: true` em metadata da conta. Trata-se somente de preferência de apresentação, nunca autorização ou substituto de RLS.
- `index` e os guards da raiz enviam contas sem conclusão ao onboarding e impedem o retorno de contas concluídas. Contas antigas sem marcador também recebem a tela uma vez. Sem migration.
- Falha ao salvar mostra erro e permite nova tentativa; não declara conclusão falsa. Nome não editado é preservado. Canais existentes não são alterados ao concluir.
- Troca de tema usa o armazenamento local existente. A conclusão é por conta; a preferência de tema continua sendo do aparelho, como no Perfil.

### Prova real no emulador

O bundle servido pelo Metro em `localhost:8081` foi inspecionado antes de concluir: única URL Supabase `utkqoiigimqzeenxkxdl` (staging), pacote `com.proops.personal.dev`. Nenhum token foi exposto. Usou-se a conta já autenticada.

Foi inspecionada a tela com nome existente, dois canais desligados e push bloqueado corretamente no simulador. Temas claro/escuro, fonte 1.3 e densidade 560 mantiveram texto legível e botão final alcançável por rolagem. Densidade 480, fonte 1.0 e tema “Seguir o aparelho” foram restaurados.

“Começar a usar” gravou apenas a conclusão em staging e abriu Hoje. Depois de encerrar o processo e reabrir com deep link explícito `/onboarding`, o app abriu Hoje novamente. Nome e canais foram preservados; não houve alteração de metadata por ferramenta externa.

| Evidência preservada | O que comprova |
| --- | --- |
| [Onboarding em escala normal](evidence/onboarding/proops-onboarding-normal.png) | Nome, tema e canais apresentados; botão final visível |
| [Tema claro com fonte ampliada](evidence/onboarding/proops-onboarding-light.png) | Contraste, quebra de texto e acesso ao botão após rolagem |
| [Tema escuro com fonte ampliada](evidence/onboarding/proops-onboarding-bottom.png) | Conteúdo e botão alcançáveis; captura anterior à troca de “fallback” por texto comum |
| [Após concluir](evidence/onboarding/proops-onboarding-complete.png) | Navegação para Hoje após salvar |
| [Após encerrar e reabrir](evidence/onboarding/proops-onboarding-reopened.png) | Guard mantém Hoje mesmo com deep link para onboarding; captura durante carregamento dos dados |

Pendentes: conta realmente nova, segunda conta/logout/login, falha de rede ao concluir e autorização/entrega de push em aparelho físico. Os testes unitários cobrem a decisão por metadata, mas não substituem essas provas de sessão e dispositivo.

## 10. Release rápida para mudanças compatíveis

### Causa anterior à correção

O único workflow de publicação era `.github/workflows/publish-android-release.yml`: toda tag `v*` executava `eas build --wait`, download, verificação de identidade/assinatura, manifesto e publicação do APK. A compilação nativa faz parte desse tempo; não havia caminho automatizado de OTA.

`expo-updates ~57.0.21`, URL de EAS Update e política `appVersion` já estavam configurados. Ausência de import JavaScript de Updates não prova defeito: a biblioteca nativa verifica no carregamento por padrão. A política `appVersion` foi preservada porque `app.config.js` documenta divergência anterior de fingerprint entre CLI e builder com config dinâmica.

### Implementação

- `publish-android-ota.yml` usa exclusivamente `workflow_dispatch`, destino explícito produção e uma tag de APK publicado informada como referência. Não existe publicação OTA automática por push ou tag.
- O caminho APK continua nas tags `v*`. Provider, comparação por `versionCode`, manifesto, verificação de hash e instalador não foram alterados. Não se força reload de OTA sobre formulário aberto; o carregamento continua com o comportamento nativo do Expo Updates.
- Release nativa passa a anexar `native-compatibility.json` ao APK verificado. O comprovante registra fingerprint do código-base no runner, SHA do código, runtime, identidade/canal/variante resolvidos da configuração validada, versão do gerador e hash das variáveis públicas do ambiente EAS, sem seus valores. O perfil distribution deve ser produção, APK interno, com apenas APP_VARIANT no env do perfil; override de runtime Android, project/updateURL divergentes ou ambiente/canal incorretos são rejeitados.
- Antes de publicar o APK, o comprovante é vinculado aos metadados EAS do build FINISHED: source SHA, runtime.version, updateChannel.name, project ID, package e perfil, mais SHA-256 do APK já inspecionado. Metadados ausentes ou divergentes bloqueiam a release. O fingerprint retornado pelo EAS é registrado separadamente do fingerprint de fonte; não se presume que sejam idênticos.
- OTA exige comprovante atestado, correspondência exata de fingerprint/ambiente/runtime, tag apontando ao SHA registrado e ancestralidade desse SHA em HEAD. Diferenças em dependências, configuração nativa, módulos, plugins ou regras de fingerprint rejeitam publicação mesmo com hash igual.
- O workflow OTA executa geração do fingerprint e publicação no mesmo processo envolvido por um único `eas env:exec --environment production`. A publicação interna herda essa snapshot e não faz uma segunda consulta de ambiente EAS. Exige CI, APP_VARIANT=production e EXPO_NO_DOTENV=1.
- O primeiro APK após esta mudança estabelece o comprovante. APKs anteriores sem esse asset falham fechado; não houve backfill por suposição. Staging não ganhou workflow OTA sem pipeline equivalente de APK comprovável.

### Verificações locais

- `node --test src/lib/onboarding.test.ts scripts/release/ota-compatibility.test.mjs scripts/release/native-compatibility.test.mjs`: **39 testes passaram** (2 onboarding e 37 release). Publicação simulada é chamada uma vez quando compatível e nunca quando divergem runtime, ambiente, tag/SHA, fingerprint, dependências ou plugins. Também são rejeitados drift de configuração production, comprovante sem build e divergência de metadados EAS.
- `src/lib/anti-slop.test.ts`: **5 testes passaram**; input usa `Type.body`.
- `npx tsc --noEmit` e ESLint do escopo passaram. Ambos os workflows foram parseados com a biblioteca `yaml`, com triggers e passos presentes.
- Geração real de comprovante com ambiente fictício, sem rede/publicação, produziu fingerprint. Repetição após mudanças somente JS do onboarding manteve o mesmo hash. Isso valida API/serialização e esse caso local, não equivalência com o builder.

### Revisão final e lacunas reais antes da publicação

O CLI instalado e fixado no workflow é **eas-cli 23.2.0**. A revisão do código `commands/update/index.js` confirmou que a segunda consulta de ambiente só ocorre quando a flag interna `--environment` é fornecida. `update/utils.js` permite o ambiente herdado quando CI está definido; essa função real foi chamada offline com SDK 57 e passou. O workflow conserva ambiente explícito no `env:exec` externo, que envolve fingerprint e update. Não houve chamada real de build/update para verificar isso.

1. **Proveniência separada.** O fingerprint e hash de ambiente são da snapshot do runner. Runtime, canal, identidade e source SHA passam a ser comparados com os metadados EAS do build final; o checksum vincula o APK verificado ao comprovante. Isso é mais forte que confiar apenas na fonte, mas não substitui inspeção do runtime/channel embutidos ou execução no aparelho.
2. **Builder remoto ainda carrega seu próprio ambiente.** A janela de reconsulta foi eliminada no caminho OTA. Na release nativa, o EAS Build resolve o ambiente remoto ao iniciar seu trabalho; o hash do runner não inspeciona os valores efetivamente embutidos nesse APK. Variáveis adicionais em `eas.json` são rejeitadas para evitar discrepância conhecida entre profile e snapshot, mas alteração do ambiente EAS durante uma build requer nova verificação operacional.
3. **Não houve execução de CI nem entrega OTA.** Primeira release nativa com comprovante, aplicação OTA em APK release compatível e rejeição de update incompatível permanecem sem teste real. O fluxo manual de APK foi preservado, mas prioridade operacional quando há APK e OTA simultaneamente também não foi exercitada.
4. **Tempo não medido.** Os aproximadamente 18 minutos informados não foram medidos novamente. O caminho OTA evita o comando de compilação nativa, mas nenhuma redução quantitativa foi comprovada nesta sessão.

Esses limites são registrados para a primeira publicação coordenada; esta tarefa não executou build, deploy, publicação ou alteração de ambiente EAS.

## Fontes consultadas

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/).
- [Expo Updates SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/updates/): configuração nativa, verificação automática e compatibilidade de runtime.
- [Ambientes EAS](https://docs.expo.dev/eas/environment-variables/usage/): ambiente explícito em build/update e `env:exec`.
- [Fingerprint SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/fingerprint/).

Histórico local de distribuição foi usado como contexto. Os arquivos atuais e as verificações descritas sustentam o estado acima; publicação passada não comprova OTA no aparelho de hoje.
