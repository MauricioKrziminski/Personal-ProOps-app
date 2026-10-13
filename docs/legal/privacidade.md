# Política de Privacidade do ProOps

Vigência: 13/10/2026

Esta Política explica como PROOPS SOLUTIONS LTDA., CNPJ 69.504.283/0001-05, com sede em Rua Major Feliciano, 549, Centro, Machado/MG, CEP 37750-000 ("ProOps", "nós"), trata dados pessoais no aplicativo ProOps e no assistente do WhatsApp, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018), o Marco Civil da Internet (Lei 12.965/2014) e o Código de Defesa do Consumidor. Somos a **controladora** dos dados.

Encarregado pelo tratamento de dados (DPO): gestao@proops.com.br.

## 1. Dados que tratamos

- **Cadastro:** e-mail, senha (guardada de forma protegida pelo serviço de autenticação, nunca em texto aberto), nome, preferências e identificadores da conta.
- **Telefone:** o número de WhatsApp, quando você decide vincular o WhatsApp. É verificado por código e serve para reconhecer suas mensagens.
- **Conteúdo financeiro e pessoal que você registra:** lançamentos, contas, cartões, faturas, categorias, orçamentos, metas, dívidas, bens, investimentos, notas, lembretes e anotações.
- **Mensagens com o assistente:** texto digitado, **áudios** (que são transcritos em texto), fotos de cupons, PDFs de fatura e arquivos de extrato que você enviar ou importar, e o histórico da conversa necessário para o assistente entender o contexto.
- **Assinatura:** identificador da conta de assinatura, plano, status e datas, recebidos da loja e da plataforma de assinaturas. Não recebemos os dados do seu cartão ou meio de pagamento.
- **Notificações:** token de notificação push do seu aparelho.
- **Notificações dos apps de banco (só Android, se você ativar):** o título e o texto das notificações dos apps de banco que você escolher, para sugerir lançamentos "a confirmar". Notificações de outros apps nunca saem do aparelho. Nada é lançado sem você confirmar, e num espaço compartilhado só você vê as suas.
- **Imagens e textos que você compartilha com o ProOps** (comprovante, print, texto do Pix): usados só para montar a sugestão do lançamento e não guardados. Antes de seguir para o provedor de IA, a imagem é convertida e perde os metadados (como a localização da foto).
- **Dados técnicos e de uso:** registros de operação (logs) do servidor, contagem de mensagens de IA usadas no período, versão do aplicativo, plataforma (iOS, Android ou web) e data do último acesso, necessárias à entrega de atualizações, ao suporte e à segurança, e registros de erro do aplicativo, do servidor e do painel.

Não coletamos dados sensíveis de propósito. Se você escrever algo sensível em notas ou mensagens, ele será tratado como o restante do seu conteúdo, apenas para prestar o Serviço.

## 2. Para que usamos (e a base legal)

| Finalidade | Base legal (LGPD, art. 7) |
|---|---|
| Criar e manter a conta, autenticar, entregar o aplicativo e o assistente | Execução de contrato |
| Interpretar mensagens, transcrever áudio, ler cupons e extratos, responder e registrar o que você pediu | Execução de contrato |
| Sugerir lançamentos a partir das notificações dos bancos que você escolheu e das imagens e textos que você compartilha | Execução de contrato |
| Enviar lembretes e avisos (push e WhatsApp) que você configurou | Execução de contrato |
| Gerir assinatura, limites de uso e cobrança pela loja | Execução de contrato; legítimo interesse |
| Segurança, prevenção a fraude e abuso, diagnóstico de falhas | Legítimo interesse; prevenção à fraude |
| Cumprir obrigações legais e regulatórias, e defesa em processos | Obrigação legal; exercício regular de direitos |
| Melhorar a qualidade do assistente com amostras de telemetria, com dados mascarados | Legítimo interesse |

Não vendemos seus dados, não os usamos para publicidade e não fazemos perfis para terceiros.

## 3. Com quem compartilhamos

Usamos operadores (prestadores) que tratam dados em nosso nome, somente para as finalidades acima:

- **Supabase:** banco de dados, autenticação e armazenamento de arquivos (comprovantes).
- **Google Cloud:** hospedagem do servidor do assistente, filas de tarefas e cópias de segurança, na região de São Paulo (southamerica-east1).
- **Anthropic (Claude), Google (Gemini) e Groq:** provedores de IA e de transcrição, descritos na seção 7.
- **Meta (WhatsApp Business Platform):** transporte das mensagens do WhatsApp. O WhatsApp trata os dados também como controlador, conforme os termos dele.
- **Langfuse:** telemetria da qualidade da IA, em servidor da União Europeia, com amostragem de interações e **mascaramento automático** de e-mail, CPF, CNPJ e telefone antes do envio.
- **RevenueCat, Apple App Store e Google Play:** gestão e cobrança da assinatura.
- **Expo:** entrega de notificações push e de atualizações do aplicativo.

Também podemos compartilhar dados com autoridades quando houver ordem legal, e em reorganização societária, com o mesmo nível de proteção. Se você usar um espaço compartilhado do aplicativo (por exemplo, com familiar), os membros do espaço veem os dados daquele espaço — exceto as sugestões vindas das notificações dos bancos, que só quem as recebeu vê.

O aplicativo **não usa rastreadores de terceiros, SDKs de publicidade nem ferramentas de análise comportamental**.

## 4. Transferência internacional

Alguns prestadores (como Anthropic, Google, Groq, Meta, RevenueCat, Expo e Langfuse) tratam dados fora do Brasil, em países como Estados Unidos e da União Europeia. Nesses casos adotamos as garantias previstas na LGPD (art. 33), como cláusulas contratuais e compromissos de segurança dos prestadores, e enviamos apenas o necessário para cada finalidade.

## 5. Por quanto tempo guardamos

- Enquanto sua conta existir, para prestar o Serviço. O histórico da conversa no aplicativo fica visível para você até você apagá-lo ou apagar a conta.
- **Ao apagar a conta**, apagamos imediatamente do banco de dados o cadastro, o conteúdo, o histórico do assistente (conversas, mensagens recebidas pelo WhatsApp, ações pendentes, estado interno da conversa, avaliações e eventos de uso) e os arquivos anexados. Dos registros de assinatura mantemos apenas a linha de auditoria da cobrança (identificador, tipo, data e resultado), sem o conteúdo do evento.
- **Cópias de segurança** do banco: diárias por **30 dias** e semanais por **90 dias**; só servem para recuperação de desastres, não são consultadas para outra finalidade e os dados apagados somem delas ao fim desse prazo (até 90 dias).
- **Enquanto a conta existe**, dados técnicos do assistente são apagados automaticamente: fila de mensagens do WhatsApp processadas, confirmações e rascunhos encerrados, 30 dias; registro de ações executadas e avisos enviados, 90 dias; contagens de uso e de envios, 13 meses (necessárias para limites do plano e custo); comentários de avaliação, 180 dias.
- **Notificações dos bancos**: o texto fica guardado só enquanto a sugestão espera você decidir, e é apagado quando você confirma ou descarta; a sugestão resolvida é apagada 30 dias depois, assim como a que parece já lançada e ficou 30 dias sem decisão. Ao sair de um espaço compartilhado, as suas sugestões daquele espaço são apagadas.
- **Registros de erro**: 30 dias. Os agrupamentos de erro são apagados 90 dias depois de resolvidos.
- **Histórico do WhatsApp:** a fila de mensagens é apagada em 30 dias; ao apagar a conta, o histórico some por completo.
- **Logs do servidor** (Google Cloud Logging) seguem a retenção padrão do Google Cloud de **30 dias**.
- Registros de acesso a aplicações são guardados pelo prazo exigido pelo Marco Civil da Internet, quando aplicável, e dados necessários para cumprir obrigações legais ou defender direitos podem ser mantidos pelo prazo legal.
- Dados de telemetria enviados ao Langfuse seguem a retenção do plano contratado nele, são amostrados e mascarados, e não permitem identificar você diretamente. Os prestadores de IA e transcrição (Anthropic, Google, Groq) e a Meta tratam o conteúdo que recebem segundo os próprios prazos e termos.

## 6. Seus direitos (LGPD, art. 18)

Você pode, a qualquer momento: confirmar que tratamos seus dados; acessar; corrigir; pedir anonimização, bloqueio ou eliminação de dados desnecessários; pedir **portabilidade**; obter informação sobre compartilhamento; ser informado sobre a possibilidade de não consentir e suas consequências; **revogar consentimento**, quando for a base; e pedir revisão de decisões automatizadas.

Como exercer: pelo aplicativo você acessa, corrige e apaga seus registros, **baixa seus dados** em Perfil → Privacidade e dados → Baixar meus dados (arquivo JSON) e **apaga a conta** em Perfil → Apagar conta. Se não tiver o aplicativo, peça a exportação por e-mail para gestao@proops.com.br. Para os demais pedidos, escreva para o mesmo endereço. Respondemos em até 15 dias e podemos pedir confirmação da sua identidade. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

## 7. Inteligência artificial

O assistente usa IA para interpretar mensagens e sugerir registros. Ele pode errar. Nenhuma alteração de dados é gravada sem a sua confirmação.

**Quem recebe:** Anthropic (Claude), Google (Gemini) e Groq (transcrição de áudio).

**O que é enviado:** suas mensagens, os áudios (para transcrição), as linhas de extrato importado e o contexto financeiro necessário para responder. Esses prestadores não treinam modelos com esse conteúdo; usamos as interfaces comerciais (API) deles.

**Autorização separada:** o uso de IA só acontece se você autorizar, no aplicativo, em uma escolha própria que vem **desligada por padrão**. Você pode revogá-la a qualquer momento em **Perfil → Privacidade e dados**. Sem a autorização, o assistente fica desligado; o restante do aplicativo segue funcionando.

As respostas do assistente são apoio à organização e não substituem aconselhamento profissional.

## 8. Segurança

Adotamos medidas como criptografia em trânsito, controle de acesso por conta e por espaço (isolamento por usuário no banco), segredos fora do código, validação de assinatura das mensagens do WhatsApp e cópias de segurança. Nenhum sistema é totalmente imune; em caso de incidente relevante, comunicaremos você e a ANPD conforme a lei.

## 9. Crianças e adolescentes

O Serviço é destinado a maiores de 18 anos. Se soubermos que um menor criou conta, ela poderá ser encerrada e os dados apagados.

## 10. Cookies e rastreamento

Esta Política se aplica ao aplicativo e às páginas legais publicadas por nós, que não usam cookies, scripts de terceiros nem rastreamento.

## 11. Alterações

Podemos atualizar esta Política. Mudanças relevantes serão avisadas no aplicativo, a data de vigência acima será atualizada e você será convidado a aceitar a nova versão na próxima abertura.

## 12. Contato

Dúvidas gerais e assuntos de proteção de dados: gestao@proops.com.br. No aplicativo, o suporte fica em **Perfil → Ajuda e suporte**.
