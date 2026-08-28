# Onboarding — `src/app/onboarding.tsx` *(tela nova)*

**Não existe hoje.** Quem termina o login cai direto na aba Hoje, vazia, com um card dizendo para
mandar mensagem no WhatsApp — e nenhum caminho até o WhatsApp. Nem uma tela do app referencia
`wa.me` ou guarda o número do produto (`grep -rn "wa.me" src/` não devolve nada): o app pede para
a pessoa fazer uma coisa e não diz onde.

O produto é operado por WhatsApp; **o app é a segunda superfície**. Então o onboarding não explica
funcionalidades — ele tem um único desfecho aceitável: **a primeira mensagem enviada, e a resposta
da IA chegando de volta.** Enquanto isso não acontece, o usuário não usou o produto, viu um app.

Porta de mão única: concluído, nunca reabre.

## Pergunta que responde

> "E agora, o que eu faço?"

Três telas, um botão por tela, e a pessoa está conversando com o produto.

## Persona

**Todo mundo, uma vez.** Mas o desenho é feito para o **Rafa, 29** — o autônomo que baixou o app
achando que ia digitar planilha e vai descobrir que é só mandar áudio. Se ele mandar o primeiro
áudio nesta tela, ele fica. Se ele fechar o app aqui, ele não volta.

Contra-caso que decide uma escolha adiante: **o parceiro do casal**, que entrou por convite
(`accept_pending_invites` no login). Ele já cai num workspace com dados. Para ele, "mandar a
primeira mensagem" continua valendo, mas o texto sugerido não pode ser um gasto inventado que
sujaria o financeiro compartilhado do casal.

## Entrada e saída

- **Entrada:** logo depois do primeiro login bem-sucedido. **Só** por aí.
- **Estrutura de rota** — mesmo mecanismo do login, um guard a mais:

```tsx
<Stack.Protected guard={!!session && !profile?.onboarded_at}>
  <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
</Stack.Protected>
<Stack.Protected guard={!!session && !!profile?.onboarded_at}>
  <Stack.Screen name="(tabs)" />
  {/* … */}
</Stack.Protected>
```

- **Saída:** gravar `profiles.onboarded_at = now()` faz o guard virar; as abas montam e a rota
  `onboarding` **deixa de existir na pilha**. Não há `replace`, não há `preventDefault`, não há
  flag de "já vi" — há ausência. É a mesma mecânica de `docs/design/login.md`.
- **Back:** `gestureEnabled: false` e sem back no header. Dentro do fluxo, o passo 2 volta para o
  1; o passo 3 não volta (a mensagem já foi mandada).
- **O que o back faz:**
  - `onboarded_at timestamptz` é **coluna nova em `profiles`** (migration nova — o topo hoje é
    `0037_trial_ending_alert.sql`). Servidor, não `AsyncStorage`: a flag tem que sobreviver a
    reinstalação e acompanhar a conta. Reapresentar o onboarding para quem já usa o produto há
    seis meses porque trocou de aparelho é pior que qualquer atrito.
  - `expo_push_token` gravado em `profiles` pelo mesmo caminho do Perfil.
  - **`profiles.whatsapp_verified` existe desde a `0001_init.sql:13` e nada no repositório
    escreve nele** — nem app, nem Edge Function. Ele passa a ser marcado pelo `whatsapp-webhook`
    na primeira mensagem recebida daquele telefone **(backend, novo)**. É o sinal que fecha o
    onboarding do lado certo: o servidor confirmando que a mensagem chegou, não o app confiando
    que o usuário tocou no botão.

## Anatomia

Três passos. Nenhum é uma tela de features.

### 1. "Seu WhatsApp está vinculado"

Confirmação, não formulário. O número já foi verificado pelo OTP — repetir a digitação seria
desfazer o que acabou de acontecer.

1. Marca monocromática, pequena.
2. Título: *"Pronto, {primeiro nome ou o número} está vinculado."*
3. Uma linha: *"Tudo que você mandar nesse número vira nota, lembrete ou lançamento aqui."*
4. O número, grande, com `tabular-nums`, e um "não é esse número?" discreto que leva de volta ao
   login (é o único jeito de sair daqui sem ficar preso a um número errado).
5. Botão **"Continuar"**.

*Existe porque um número errado descoberto no passo 3 custa uma reinstalação; descoberto aqui,
custa um toque.*

### 2. "Deixa eu te avisar"

O passo com maior consequência econômica do produto inteiro. Sem `expo_push_token`, **todo**
lembrete e **todo** alerta sai por template pago do WhatsApp — e a partir de 01/10/2026 nem a
janela de 24h é grátis.

1. Ícone SF `bell.badge`.
2. Título: *"Lembrete só serve se chegar."*
3. Duas linhas concretas, com exemplos do produto: *"'Pagar aluguel' na hora certa. 'Sua fatura
   fecha amanhã.' Sem isso, o app só existe quando você abre ele."*
4. Botão **"Ativar notificações"** → `Notifications.requestPermissionsAsync()`.
5. **"Agora não"** — texto discreto, sempre disponível.

*Pergunta de permissão vem depois da razão, nunca antes.* O prompt do sistema só aparece uma vez
na vida do app: gastá-lo num diálogo sem contexto é gastar a única chance. E se a pessoa recusar,
o Perfil já é desenhado para insistir com jeito (a seção Notificações sobe para o topo enquanto o
push está desligado — `docs/design/perfil.md`).

### 3. "Manda a primeira"

O passo que é o produto.

1. Título: *"Manda a primeira mensagem."*
2. **Três sugestões tocáveis**, cada uma uma `Row` com ícone SF, que abrem o WhatsApp **com o
   texto já escrito**:
   - `gastei 45 no mercado` (financeiro)
   - `me lembra de pagar o aluguel todo dia 5` (lembrete)
   - `anota: ligar pro dentista` (nota)

   Uma por domínio, porque a primeira mensagem ensina o alcance do produto melhor que qualquer
   tela de features. Para quem **entrou por convite** num workspace que já tem dados, a primeira
   sugestão vira `quanto a gente gastou esse mês?` — consulta, não lançamento: ninguém quer que
   seu primeiro ato num financeiro compartilhado seja inventar um gasto de 45 reais.
3. Uma linha sobre áudio: *"Ou manda um áudio — funciona igual."* É o diferencial que mais
   converte o Rafa e o que menos gente descobre sozinho.
4. **"Já mandei / pular"** discreto no rodapé.

O toque abre `https://wa.me/<numero>?text=<sugestão>` com `expo-linking` (já instalado). O número
do produto vem de **`EXPO_PUBLIC_WA_NUMBER` (env nova)**, documentada em `supabase/.env.example`
como as outras — nunca literal no código, porque ele muda entre WABA de teste e de produção,
exatamente como os nomes de template (`.claude/rules/whatsapp.md`).

### 3b. Estado de espera (o mesmo passo, depois do toque)

Voltar do WhatsApp para o app cai aqui, e **este é o único momento de delight do produto**:

- Enquanto nada chegou: *"Esperando sua mensagem…"* com a marca em pulso lento.
- Quando chega: a linha criada aparece **de verdade** (a nota, o lembrete ou o lançamento, com o
  valor formatado), com haptic `notificationAsync(Success)` e o botão **"Entrar no app"**.

Mostrar o dado real chegando é o que prova a promessa. Uma tela dizendo "tudo certo!" sem mostrar
nada seria só mais uma tela.

**Como o app sabe que chegou:** realtime em `notes`, `transactions` e `reminders` — as três estão
na publicação `supabase_realtime` (`0001_init.sql:225-226`, `0005_finance_core.sql:318`).
**Não** dá para escutar `ai_events`: essa tabela **não está** na publicação, e é justamente o erro
que a tela de Atividade da IA comete hoje (`docs/design/atividade-ia.md`). Fallback: `refetchInterval`
de 3 s enquanto a tela está em foco, teto de 90 s. Depois do teto, a tela oferece "Entrar no app"
sem drama — mensagem que demora não pode virar cadeia.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Número e flag | `useProfile()` **(novo, compartilhado com Perfil)** | `['profile']` | `profiles` (`phone`, `onboarded_at`, `whatsapp_verified`) | — |
| Push | `usePushRegistration()` **(novo, compartilhado com Perfil)** | `['profile','push']` | `profiles.expo_push_token` | — |
| Concluir | `useCompleteOnboarding()` **(novo)** | — | `update profiles set onboarded_at = now()` | — |
| Chegou algo? | `useFirstArrival()` **(novo)** | `['onboarding','arrival']` | `notes` / `transactions` / `reminders`, `limit(1)` | as três tabelas |

`usePushRegistration` é o mesmo hook do Perfil — o código de permissão + `getExpoPushTokenAsync`
que hoje vive solto dentro de `src/app/(tabs)/profile.tsx:41-53` sai de lá e passa a ser usado
pelos dois. Duas cópias dessa lógica é como uma delas para de gravar o token e ninguém percebe.

## Ação primária

**Mandar a primeira mensagem.** Tudo nas três telas existe para chegar nesse toque; qualquer
elemento que não empurre para lá sai.

## Ações secundárias

Pular o passo de push · pular a mensagem · voltar ao login por número errado.

**Pular está sempre disponível e nunca escondido.** Onboarding que prende é onboarding que
desinstala; e o Perfil recupera o push depois.

## Estados

- **Loading** — só no passo 1, esperando `useProfile`. `Skeleton` no lugar do número. Nunca tela
  branca entre o login e o passo 1: o splash segura (mesmo mecanismo do login).
- **Empty** — não existe. Onboarding é uma tela sem dado por definição.
- **Error — perfil não carrega** — não bloqueia: o passo 1 mostra o telefone da sessão
  (`session.user.phone`) e segue. Falhar aqui prenderia a pessoa na porta de entrada.
- **Error — não deu para gravar `onboarded_at`** — o botão "Entrar no app" **entra assim mesmo** e
  a gravação vai para retry em background. Um erro de rede não pode transformar o onboarding em
  loop infinito na próxima abertura. (Se ele reabrir uma vez, é um incômodo; ficar preso fora do
  app é uma desinstalação.)
- **Permissão negada** — texto próprio, sem culpa: *"Sem problema. Você liga depois em Perfil ›
  Notificações."* e segue. Nunca repetir o pedido na mesma sessão — o sistema não mostra o prompt
  duas vezes de qualquer forma, e insistir só ensina a ignorar.
- **WhatsApp não instalado** — `Linking.canOpenURL` falha: mostra o número copiável e
  *"Salva esse contato e manda por lá."* Não é raro: tablet e aparelho secundário.
- **Voltou sem mandar nada** — o estado de espera não acusa; passados 90 s vira
  *"Quando quiser, é só mandar."* + "Entrar no app".
- **Conteúdo longo** — as sugestões truncam em uma linha; o número nunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Passo → passo | continuidade espacial | slide horizontal, `Motion.base` (~250 ms), com indicador de 3 pontos. Volta é mais rápida que ida |
| Marca no passo 1 | delight | entrada única com `scale 0.92 → 1` + fade, `Motion.spring.settle`. **Momento raro — é onde delight se paga** |
| Espera pela mensagem | explicação | pulso da marca, ciclo de 1,6 s, opacidade 0,4 → 1. Lento de propósito: é espera, não carregamento |
| Chegada do item | mudança de estado | a linha entra com `FadeInDown` + `scale 0.96 → 1` em `Motion.spring.settle`; haptic `notificationAsync(Success)` |
| Ativar notificações | feedback | o botão vira ✓ in-place em `Motion.fast`; haptic `impactAsync(Light)` |
| Saída para as abas | continuidade | a troca do `Stack.Protected` é o movimento. Sem confete, sem tela de parabéns |

`Reduce Motion` colapsa os slides em cross-fade e o pulso em opacidade fixa.

## Acessibilidade

- Cada passo é uma tela para o leitor de tela, com `accessibilityViewIsModal` — o conteúdo dos
  passos vizinhos não vaza.
- Indicador de passo anunciado ("passo 2 de 3"), não só três pontinhos.
- Botão de sugestão com label completo ("Mandar no WhatsApp: gastei 45 no mercado").
- Estado de espera com `accessibilityLiveRegion="polite"`: a chegada precisa ser **ouvida**, é o
  único evento da tela.
- "Agora não" e "pular" com alvo ≥ 44pt — link discreto não pode significar link difícil de tocar.
- Dynamic Type XL: os textos são curtos de propósito e cabem; as sugestões quebram em duas linhas.
- Contraste conferido nos dois temas; a marca segue a regra monocromática (`design.md §9`) e usa o
  mesmo par cor de fundo + variante do splash, senão pisca cor errada na transição.

## Fora de escopo

Tour das abas · carrossel de features · pedir nome, foto ou data de nascimento (nada disso existe
no schema e nada disso é necessário para mandar uma mensagem) · escolher plano ou paywall (o teste
grátis já está correndo; cobrar antes de entregar valor é o oposto do objetivo desta tela) ·
importar extrato · cadastrar contas e cartões (o produto funciona sem conta cadastrada — o
lançamento do WhatsApp vem sem conta e `private.cash_total()` conta ele mesmo assim, migration
`0028`) · convidar o parceiro (mora em Perfil › Membros) · reabrir o onboarding a pedido.
