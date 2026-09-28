# Internet em julho e áudio no simulador iOS

Data: 28/09/2026. Complementa [a auditoria de recorrência e áudio](2026-09-27-recorrencia-e-audio.md) e [a validação dos alcances](2026-09-28-escopos-de-edicao.md). Os testes autenticados usaram somente a staging `utkqoiigimqzeenxkxdl`, em `com.proops.personal.dev`. Nenhuma transação, recorrência ou conversa de teste foi gravada. As imagens em `evidence/` contêm dados financeiros e ficam ignoradas pelo Git.

## 1. Internet criada para o último dia

**Relato e reprodução antes:** a recorrência Internet começou em julho de 2026 com “último dia de todo mês”. Em Lançamentos → Julho, a tela exibia “Julho de 2026”, porém a régua padrão era **Ciclo 11/06–10/07**. O vencimento de 31/07 não pertencia a essa janela. Em Lançamentos → Agosto, o ciclo 11/07–10/08 continha 31/07, por isso o cartão aparecia no mês aparentemente errado. [Captura anterior](evidence/2026-09-28/internet-julho-antes-ciclo.png).

**Conferência da fonte:** a série Internet da staging (`0e064974-6dd6-4f0c-acd5-dd2c650226b1`) tem `dtstart` em 31/07/2026 e `FREQ=MONTHLY;BYMONTHDAY=-1`. A consulta de projeções retornou 31/07, 31/08 e 30/09, todos por R$ 120,00. Não havia lançamento real associado a essas datas. O banco projetava corretamente; a combinação do nome do mês civil com a régua de ciclo padrão causava a troca aparente. A projeção é virtual: mostra uma data calculada sem criar pagamento ou somá-lo aos lançamentos registrados.

**Correção:** Lançamentos agora inicia em **Mês**, mantendo a escolha Mês/Ciclo só para essa tela. Julho mostra 01/07–31/07; agosto, 01/08–31/08; setembro, 01/09–30/09. A opção Ciclo continua disponível e exibe explicitamente sua janela. O bloco passou de “Previstos sem lançamento” para **“Recorrências e parcelas”**, com explicação de que são datas calculadas, sem lançamento registrado. As linhas distinguem recorrência, parcela de contrato e parcela informada como paga sem valor lançado. O botão flutuante “Lançar” cobria valor e data desse bloco na primeira pintura; a ação foi para o cabeçalho nativo, acima da lista.

**Validação depois:**

| Caminho | Observação direta |
| --- | --- |
| Android → Julho | Mês 01/07–31/07; Internet R$ 120,00 em 31/07, valor e data legíveis. [Captura](evidence/2026-09-28/internet-julho-android-depois.png). |
| iPhone simulado → Julho | Mesmo intervalo e Internet em 31/07; `+` e menu no cabeçalho. [Captura](evidence/2026-09-28/internet-julho-ios-depois.png). |
| Android → Agosto | Mês 01/08–31/08; Internet em 31/08, sem a linha de 31/07. [Captura](evidence/2026-09-28/internet-agosto-android-depois.png). |
| Android → Setembro e fevereiro de 2027 | Internet em 30/09 e 28/02 respectivamente; fevereiro foi recortado como 01/02–28/02. |
| Android → Ver ocorrências → Julho/Agosto | O filtro da própria série mostrou 31/07 e 31/08, cada um no mês correspondente. |
| Android → Julho → Ciclo → Mês | Ciclo mostrou 11/06–10/07 e não exibiu 31/07; voltar a Mês restaurou 31/07 sem criar linha duplicada. |
| Android e iPhone simulado → `+` do cabeçalho | Abriu “Novo lançamento”; os dois formulários foram fechados sem salvar. |

A mesma consulta virtual e o mesmo componente de apresentação servem recorrências e parcelas/dívidas. O ajuste da régua de Lançamentos corrige a localização temporal de todos esses itens nessa lista. As regras de dia fixo 30/31 e fim de mês explícito, e os escopos de edição, têm evidência separada nos documentos anteriores.

## 2. Áudio recusado no simulador de iPhone

**Relato e reprodução antes:** tocar no microfone, gravar e parar mostrava “Não encontrei fala nesse áudio”. O erro era lançado pelo filtro local de nível de sinal, antes da rota de transcrição; não representava falha de interpretação do agente. O Device Hub estava com entrada **BlackHole 2ch**. A [documentação da Apple](https://developer.apple.com/documentation/xcode/configuring-a-simulator-for-your-environment) confirma que cada simulador escolhe sua própria entrada em Device → Sound → Sound Input ou no inspetor Settings → Input. BlackHole é uma entrada virtual e ficou em silêncio quando a pessoa falou no ambiente.

**Segundo fator encontrado:** o MacBook Air está com a tampa fechada (`AppleClamshellState=Yes`). A entrada “MacBook Air Microphone” produziu silêncio digital (`mean/max -91 dB`); o dispositivo USB (`-35,8/-22,5 dB`) e “iPhone Microphone” (`-46/-34 dB`) tinham sinal. Selecionar o microfone embutido não resolveria esta configuração física. A entrada padrão do macOS não foi alterada.

**Correção e verificação:** o texto local agora diz “O microfone não captou som. Confira a entrada de áudio e tente novamente.”, pois o medidor detecta sinal, não fala. No Device Hub, uma frase sintética alimentada pelo BlackHole 2ch foi captada, transcrita e apareceu na revisão editável **antes de qualquer envio**. [Captura da revisão](evidence/2026-09-28/agente-ios-revisao-transcricao.png). “Descartar” devolveu a conversa vazia. O dispositivo USB captou ruído, mas o transcritor devolveu “E aí”; esse resultado também foi descartado. Isso confirma por que a revisão humana obrigatória permanece necessária. O simulador foi deixado com **iPhone Microphone**, que tem sinal, [visível no inspetor](evidence/2026-09-28/agente-ios-entrada-iphone.png). A [captura do aviso com o microfone embutido silencioso](evidence/2026-09-28/agente-ios-silencio-microfone-fechado.png) documenta o caso negativo. Fala natural da pessoa no iPhone conectado ainda requer teste manual dela; áudio sintético não prova essa condição.

**Achado análogo no Android AVD:** ele havia sido iniciado sem `-allow-host-audio`, opção do emulador que zera a entrada do host. Reiniciei o mesmo AVD sem apagar dados e com essa opção; uma frase sintética passou da gravação nativa à revisão editável e foi descartada. Em reinicializações futuras do AVD, a opção precisa acompanhar o comando de início. Nenhuma permissão ou preferência global do Mac foi modificada.
