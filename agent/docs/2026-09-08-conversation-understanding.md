# Conversação: causas e correções — 08/09/2026

Estado: implementado e validado localmente; este backend ainda não foi publicado. A validação usa Gemini real com entidades fictícias e proíbe escritas. Não comprova entrega pelo WhatsApp nem compreensão de qualquer frase.

## Falhas e correção pela raiz

| Comportamento | Causa | Correção |
| --- | --- | --- |
| “Quero usar outro cartão” e “Usa o Inter em vez do Nubank” perdiam a compra pendente. | A opção só era reconhecida pelo rótulo/ID/número. O classificador genérico não recebia as opções; uma resposta incerta era confundida com assunto novo e expirava a proposta. O transporte também perdia o cartão informado. | Classificação contextual das opções, preservação do cartão e da compra, nova resolução de conta/limite e outra confirmação antes de executar. Escolher outro cartão não aprova a compra. |
| “Não, só as oito anteriores” não revisava a proposta de baixar todas. | Não existia decisão de revisão de escopo na confirmação. | Preservar o ID da compra, resolver novamente o subconjunto, congelar os itens revisados e pedir nova confirmação. A frase corretiva não executa nem as 48 nem as oito. |
| Pedidos sobre parcelas existentes eram enviados ao cadastro de financiamento. | O roteamento inferia o tipo pelo assunto “carro” e não distinguia a entidade existente. | Consultar os candidatos de compra e dívida no workspace; uma entidade determina o domínio, duas exigem escolha. Busca parcial parametrizada e com caracteres LIKE escapados encontra nomes como “Carro usado”. Histórico de outra dívida não muda o domínio de uma compra explicitamente referida. |
| “No cartão Inter” podia virar uma conta chamada “cartão”. | Extração genérica capturava somente uma palavra e não descartava a grafia acentuada do rótulo. | Descartar nomes genéricos e preservar o nome explícito informado, inclusive nomes compostos. |
| Uma dúvida ou falha do classificador apagava a pendência. | Falha/ambiguidade e assunto novo compartilhavam o mesmo resultado. | Resultado distinto de manutenção da pendência; proposta e rascunho sobrevivem à dúvida e à falha do modelo. |

A proposta apresentada ao classificador é dado não confiável, separado das instruções de sistema. A escolha de domínio executa somente o extrator selecionado. As operações permanecem sujeitas à resolução e confirmação do grafo, não à mera intenção extraída pelo modelo.

Referências claras como “marca essas” após uma lista de duas contas preservam ambas para confirmação. Se houver dois candidatos de mesmo nome com datas diferentes, o agente pede desambiguação. Não foi mantida uma regra que proibisse pronomes plurais indiscriminadamente.

## Evidência final

- **22/22 cenários com Gemini real em uma única rodada final**, com roteamento estrito: `/tmp/proops-conversation-final-integrated.json`. Cadastro de cartão/conta/financiamento, respostas contextuais, contrato incompleto, distinção entre dívida e compra, intervalos de parcelas, histórico de pagamento, troca de cartão, revisão, aprovação e cancelamento.
- **553 testes do backend passaram**, incluindo 22 regressões em `tests/test_conversation_understanding.py`; `ruff check app --select F,E9` e `git diff --check` passaram.
- Grafo com checkpoint em memória: Nubank→Inter exige outra confirmação; cancelar não escreve; revisão de 48→8 mostra R$ 11.760 e conserva o snapshot; a execução protege contra alterações concorrentes. A lista clara luz (R$ 120) + internet (R$ 90) não escreve antes da resposta e executa somente os dois IDs revisados após aprovação.
- Ensaio HTTP local assinado, reexecutado após as mudanças: texto/clique válidos: 200; assinatura ausente, inválida ou corpo adulterado: 401; token GET incorreto: 403. Persistência e tarefas são substituídas por memória. Não é ensaio de worker, banco ou entrega Meta reais.

Reprodução a partir de `agent/`:

```sh
.venv/bin/python scripts/evaluate_conversation_understanding.py --output /tmp/conversation-eval.json
.venv/bin/pytest
.venv/bin/ruff check app --select F,E9
.venv/bin/python scripts/verify_signed_inbound.py
```

A primeira avaliação havia aprovado 17/19 componentes, mas invocava o parser financeiro mesmo quando o roteador escolhia outro domínio. Essa lacuna foi corrigida no harness antes da rodada final. Uma expectativa que rejeitava “essas” após uma lista clara também foi corrigida; o teste ambíguo passou a ter candidatos realmente indistinguíveis pelo pedido. Esses resultados preliminares não são apresentados como prova final.

## Limites e publicação

“Sim, mas muda para 24 parcelas” ainda não edita automaticamente a quantidade da proposta: informa que precisa de nova proposta, sem aprovar nem apagar a atual. Essa limitação não é tratada como compreensão completa da edição.

Os cenários escolhidos não garantem determinismo das futuras respostas do modelo. Não foram usados banco de produção, worker de entrega ou WhatsApp real. Após autorização explícita do usuário, o backend foi publicado em staging (`agente-staging-00072-vg8`) e produção (`agente-00026-5mk`), ambos com health saudável. A validação de entrega pelo WhatsApp real permanece pendente.

Preparação do payload de deploy: a listagem local do gcloud incluía 7775 arquivos, entre eles `.env.production`, `.env` e 7506 arquivos da `.venv`. O Dockerfile copiava somente requirements e app, mas o arquivo de origem enviado ao build não tinha essa restrição. Foi adicionado `.gcloudignore` com os inputs explícitos do Dockerfile e ampliada a exclusão de ambientes no `.dockerignore`. A nova listagem contém 62 arquivos, nenhum ambiente/venv/cache Python, e preserva todos os arquivos de app necessários. Evidências: `/tmp/proops-agent-upload-files-before.txt` e `/tmp/proops-agent-upload-files-after.txt`. Nenhum upload ou deploy foi executado nessa verificação.
