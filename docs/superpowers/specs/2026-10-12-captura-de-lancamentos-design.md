# Captura de lançamentos sem Open Finance — design

Data: 12/10/2026. Pedido do dono do produto: *"automatizar o lançamento de um gasto/receita
(notificação ou qualquer outra maneira…) que não seja via open finance"*. Escopo aprovado:
**Android pelas notificações** e **Compartilhar comprovante/print** (Android e iOS).

## O que existe no mercado (pesquisa de 12/10/2026)

- **Ler a notificação do app do banco** é o que Mobills e Organizze fazem no Android. Não é
  permissão restrita do Google Play (diferente de `READ_SMS`, cuja exceção para finanças é
  revisão manual e já foi negada a outros apps). A pessoa liga "Acesso a notificações" nas
  configurações do Android.
- **iOS não deixa** nenhum app ler notificação de outro. A automação "Transação" dos Atalhos
  (Apple Pay) fica FORA deste escopo até o teste no iPhone do dono do produto. FinanceKit não
  existe no Brasil.
- **Compartilhar** (share sheet / intent `SEND`) cobre o Pix, que nenhum dos outros caminhos pega,
  e não tem risco de loja.

## Decisões

1. **Nada é lançado sozinho.** Toda captura vira um rascunho "a confirmar". Confirmar abre o
   formulário único (`/finance/lancar`) preenchido; **salvar é o caminho normal** (o mesmo da
   voz, F16). Não existe uma segunda porta de escrita.
2. **Um intérprete só.** Notificação e imagem passam pelo `finance_node` + `montar_rascunho`
   (`agent/app/routes/finance_draft.py`), o MESMO da voz. `ia.md`: "foto de cupom, print de Pix
   e PDF de fatura entram no mesmo nó de domínio e no mesmo schema — nunca um segundo prompt".
   Nenhum schema novo, nenhum campo novo em `FinanceAction`.
2b. **Instrução fora do envelope, dado dentro.** O texto da notificação vai no `<user_input>` sem
   nenhuma instrução nossa (o modelo é treinado a tratar o que está lá como dado). "Isto é uma
   notificação do banco X; fatura fechada, limite e propaganda não são lançamento" vai numa linha
   confiável que `user_turn` monta de `state["origem"]` — o mesmo lugar do `corrigindo`. Sem
   `origem`, o turno é idêntico ao de hoje.
3. **Regex só valida estrutura.** O servidor descarta, sem chamar modelo, a notificação SEM valor
   em reais (`R$ 1` ou `1,23`): movimento de dinheiro sempre tem valor. Quem decide se é compra,
   Pix ou propaganda é o modelo (`agent.md` → *valida estrutura, nunca infere sentido*).
4. **Filtro no aparelho.** O serviço nativo só guarda notificação de pacote ESCOLHIDO pela pessoa
   entre os bancos conhecidos. As outras nunca saem do celular. O servidor confere o pacote de
   novo (allowlist igual).
5. **O nativo não fala com a rede.** O serviço grava num arquivo local; o JS envia quando o app
   abre (ou volta ao primeiro plano), com o JWT de sempre (`agentFetch`). Sem token no nativo,
   sem WorkManager. Custo aceito: o "a confirmar" aparece quando a pessoa abre o app — que é
   quando ela confirmaria de qualquer jeito.
6. **"A confirmar" mora no banco** (`public.captured_notifications`): sobrevive a reinstalar,
   aparece em qualquer aparelho da conta e dá para conciliar. O app só lê e muda o `status`.
7. **Conciliação reusa a cascata da importação** (`reconcile.conciliar`): o que já está lançado
   (pelo WhatsApp, por exemplo) entra como `duplicate` com o lançamento achado, fora da Hoje —
   inclusive `near_match` e `uncertain` (mesmo valor em poucos dias, nome parecido), porque o nome
   da notificação ("MERCADO SAO JOSE") quase nunca é o que a pessoa escreveu. Esses vão para
   "Parecem já lançados", onde ela decide.
7b. **Capturas não entram no badge da aba nem em `pendentesDaHoje`.** O badge é o que o "Seu dia"
   tem para resolver (`design.md` §8); o bloco "A confirmar" mostra a própria contagem.
8. **Cota:** captura não conta no limite MENSAL de mensagens do plano (a pessoa não "mandou
   mensagem"), mas passa pelo consentimento de IA e pela rajada por hora (`check_limits`,
   `kind='capture'`) e grava `ai_events` com `kind='capture'` (custo medido). Teto duro de
   **60 chamadas de modelo de captura por espaço em 24 h** (contadas em `ai_events`, inclusive as
   que concluíram "não é lançamento"). Custo estimado: ~US$ 0,002 por notificação
   no Haiku.
9. **Compartilhar não precisa de fila**: a pessoa está com o app na mão. Imagem vai a
   `POST /internal/finance/draft/media`; texto vai ao `/internal/finance/draft` que já existe. O
   resultado abre `/finance/lancar` preenchido. Conta como mensagem do plano (`kind='turn'`),
   igual à imagem no WhatsApp.
10. **Biblioteca do Compartilhar:** `expo-share-intent` (autor achorein; SDK 57 → 8.x). No iOS ela
    cria uma Share Extension invisível que abre o app. **Risco:** o app já tem uma extensão
    (widgets, `expo-widgets`). A Task 7 começa por uma prova de que as duas convivem num build do
    EAS; se não convivem, o iOS fica para depois e o Android sai sozinho (`disableIOS`).
11. **Privacidade:** o texto da notificação fica guardado só enquanto o item está em aberto; ao
    confirmar ou descartar o app apaga o texto (`texto = null`). A política de privacidade ganha o
    parágrafo. Langfuse já mascara e-mail, CPF, CNPJ e telefone.
12. **Versão:** módulo nativo + plugin novo = **MINOR, 1.14.0** (fecha o OTA para a 1.13.x).
    Ordem de produção: migration → agente → app.

## Bancos (pacotes conferidos na Play Store em 12/10/2026, todos 200)

| banco | pacote |
|---|---|
| Nubank | `com.nu.production` |
| Itaú | `com.itau` |
| Banco do Brasil | `br.com.bb.android` |
| Bradesco | `com.bradesco` |
| Caixa | `br.com.gabba.Caixa` |
| Santander | `com.santander.app` |
| Inter | `br.com.intermedium` |
| C6 Bank | `com.c6bank.app` |
| PicPay | `com.picpay` |
| Mercado Pago | `com.mercadopago.wallet` |
| Neon | `br.com.neon` |
| PagBank | `br.com.uol.ps.myaccount` |

Teste: `com.android.shell` ("Teste (adb)"), aceito só em `__DEV__` no app e com
`CAPTURA_ACEITA_TESTE=true` no agente (staging), para `adb shell cmd notification post`.

## Fora do escopo (e quando entra)

- Automação "Transação" do iOS (Apple Pay): depois do teste manual no iPhone.
- Push "nova compra a confirmar": exige o nativo enviar sozinho (WorkManager + credencial). Entra
  se a pessoa reclamar que só vê ao abrir o app.
- Confirmar em lote / num toque sem abrir o formulário: entra quando houver regras (o pedido de
  "regras do agente") para dar confiança ao preenchimento automático.
- E-mail encaminhado; leitura de SMS (descartada: política do Google Play).
