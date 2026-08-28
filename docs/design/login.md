# Entrar — `src/app/login.tsx` *(vira rota)*

Hoje o login **não é uma rota**. É um componente (`src/components/login-screen.tsx`, 207 linhas)
que o layout raiz renderiza no lugar do `<Stack>`:
`{loading ? null : session ? <Stack/> : <LoginScreen/>}` (`src/app/_layout.tsx:22-45`). Funciona,
e cobra o preço em três lugares: não existe URL de login (deep link para qualquer rota com sessão
expirada cai numa tela sem história), o `loading` inicial renderiza **`null`** — tela preta por
cima do splash — e nada garante que a pilha antiga seja destruída no logout.

A forma documentada pelo Expo para isto é `Stack.Protected` com `guard`, que **remove as rotas da
pilha** quando o guard vira falso. Vira:

```tsx
<Stack>
  <Stack.Protected guard={!!session}>
    <Stack.Screen name="(tabs)" />
    {/* …demais rotas do app */}
  </Stack.Protected>
  <Stack.Protected guard={!session}>
    <Stack.Screen name="login" options={{ headerShown: false }} />
  </Stack.Protected>
</Stack>
```

É isso que responde "por que o back nunca volta ao login": **as telas do outro lado do guard não
existem na pilha**. Não é um `preventDefault` no botão de voltar, não é uma flag — é ausência.
Logado, `login` não está montada; deslogado, as abas não estão. No Android o back físico na raiz
sai do app, e não há estado antigo para reentrar.

Login é OTP por telefone (Supabase Auth Phone OTP): **o telefone é a chave de vínculo com o
WhatsApp**, não um identificador qualquer. Quem entra com o número errado não "erra o login" — ele
não recebe as próprias mensagens.

## Pergunta que responde

> "Sou eu, deixa eu entrar."

Tela de zero prazer e zero tolerância a atrito: cada segundo aqui é abandono.

## Persona

**Qualquer usuário, exatamente duas vezes na vida** (primeiro acesso e troca de aparelho) — e uma
terceira, pior, quando a sessão cai sozinha. O tom é o de quem já foi convidado: nada de vender o
produto, isso é papel do onboarding.

Caso especial silencioso: **o parceiro do casal.** Um convite feito para o telefone dele vira
acesso no primeiro login — `useSession` chama `accept_pending_invites()` no `SIGNED_IN`
(`src/hooks/use-session.ts:13-27`), best-effort. Ele digita o número e já entra no workspace
compartilhado, sem código de convite, sem link. É a melhor parte deste fluxo e ninguém precisa
saber que ela existe.

## Entrada e saída

- **Entrada:** cold start sem sessão; expiração de sessão em qualquer lugar do app; "Sair da
  conta" no Perfil.
- **Saída:** sucesso não navega — `onAuthStateChange` (`use-session.ts:24`) troca o `guard`, o
  `Stack.Protected` remonta e a rota vira `/today`. Usuário novo cai em `/onboarding` (ver
  `docs/design/onboarding.md`), que é a outra porta de mão única.
- **Back:** dentro do fluxo, o passo do código volta para o passo do telefone (o "Usar outro
  número" de hoje, `:134-140`, vira o back do header). Depois de logado, back não existe: a rota
  saiu da pilha.
- **O que o back faz:** `signInWithOtp({ phone })` → Supabase Auth dispara o **Send SMS Hook**,
  que é a Edge Function `wa-send-otp` → template Authentication no WhatsApp (`WA_OTP_TEMPLATE`).
  `verifyOtp({ phone, token, type: 'sms' })` cria a sessão; o trigger `on_auth_user_created`
  (`0001_init.sql`) cria o `profiles` com o telefone já preenchido — é o vínculo com o WhatsApp
  nascendo junto com a conta.

## Anatomia

Dois passos na **mesma rota**, com `step` local — não duas rotas: voltar do código para o telefone
é corrigir um dígito, não navegar.

### Passo 1 — telefone

1. **Marca** — a marca monocromática de `assets/images/brand/` (preta no claro, branca no escuro),
   discreta. O `type="title"` "Personal" + "by ProOps" de hoje (`:66-69`) é texto fazendo papel de
   logo.
2. **Uma linha de contexto** — *"Entra com o número do seu WhatsApp."* Não é slogan; é a
   instrução que evita a pessoa digitar o telefone fixo.
3. **Campo de telefone** — prefixo `+55` **fixo e visível à esquerda**, e máscara BR ao digitar:
   `(11) 98888-7777`. Hoje o campo é cru (`:80-88`) e o `+55` é remendado no envio, em dois
   lugares diferentes (`:26` e `:40`) — mesma expressão duplicada, que é como um dos dois fica
   para trás. `keyboardType="phone-pad"`, `autoComplete="tel"`, `textContentType="telephoneNumber"`.
   Máscara e normalização E.164 em `src/lib/phone.ts` **(novo)**, com teste (`node --test`, mesma
   convenção de `dates.test.ts`) — 10 e 11 dígitos, com e sem 9º dígito, colado com espaço e
   parêntese vindo do clipboard.
4. **Botão "Receber código"** — largura total, desabilitado enquanto o número não tem 10 ou 11
   dígitos. Desabilitar é mais honesto que deixar tocar e devolver erro do servidor.
5. **Linha legal** — *"Ao entrar você concorda com os termos."* com link.

### Passo 2 — código

1. **Header** — back para o passo 1, e o número digitado logo abaixo, com "Trocar". Ver o próprio
   número escrito é o que faz a pessoa descobrir que errou um dígito.
2. **Campo de 6 dígitos** — seis caixas, avanço automático, colar preenche tudo. `keyboardType="number-pad"`,
   `autoComplete="one-time-code"`.
   > **O rótulo de hoje mente.** `:92` diz *"Código enviado por SMS"* — e o código vai por
   > **WhatsApp** (template Authentication via `wa-send-otp`; `type: 'sms'` no `verifyOtp`, `:41`,
   > é o nome do canal na API do Supabase, não o meio de entrega). O texto certo é *"Mandamos um
   > código no seu WhatsApp"*, com o ícone SF de balão. Consequência prática: **o preenchimento
   > automático do iOS não vai funcionar** — ele lê SMS, não WhatsApp. Por isso as seis caixas
   > precisam ser rápidas de digitar e o "colar" tem que funcionar de primeira.
3. **Reenviar em 0:60** — contador regressivo com `tabular-nums`, virando o botão "Reenviar
   código" no zero. Sem contador o usuário toca cinco vezes e colhe o rate limit do Supabase, que
   responde uma frase em inglês. O contador **é** o tratamento desse erro, feito antes.
4. **"Não chegou?"** — abre uma linha com as duas causas reais: número errado (volta ao passo 1) e
   WhatsApp em outro aparelho.

### Atalho de desenvolvimento

O botão `__DEV__` (`:142-148`) fica, com três correções: sem emoji (`🔧`), separado por um
`Section` com o rótulo "Desenvolvimento", e **as credenciais saem do código-fonte** para
`EXPO_PUBLIC_DEV_LOGIN_EMAIL` / `EXPO_PUBLIC_DEV_LOGIN_PASSWORD`. Hoje `dev@proops.local` /
`devtest123` estão literais no repositório (`:55-56`); mesmo protegido por `__DEV__`, é uma conta
com senha pública — ela não pode existir no projeto Supabase de produção.

## Dados

Sem TanStack Query: aqui não há cache, não há refetch e não há realtime. É `useState` + duas
chamadas do `supabase.auth`.

| Bloco | Origem | Observação |
|---|---|---|
| Sessão | `useSession()` (`src/hooks/use-session.ts`) | alimenta o `guard` do `Stack.Protected` |
| Enviar código | `supabase.auth.signInWithOtp({ phone })` | E.164 vindo de `src/lib/phone.ts` **(novo)** |
| Verificar | `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` | sucesso não navega — o guard troca sozinho |
| Convites | `accept_pending_invites()` | disparado pelo `useSession` no `SIGNED_IN`, best-effort |
| Config ausente | `isSupabaseConfigured` (`src/lib/supabase.ts`) | o aviso de `.env` de hoje (`:110-115`) continua, só em `__DEV__` |

**Erro do Supabase nunca vai cru para a tela.** Hoje `setError(err.message)` (`:30`, `:44`) mostra
o inglês do servidor ("Token has expired or is invalid") para um usuário brasileiro. Um mapa
`authErrorPt(err)` em `src/lib/phone.ts` **(novo)** traduz os quatro casos que existem de verdade —
código errado, código expirado, número inválido, muitas tentativas — e cai num genérico
educado para o resto, com o código original só no `console` em `__DEV__`.

## Ação primária

**Receber e digitar o código.** Um campo por passo, um botão por passo, e nada mais competindo.

## Ações secundárias

Trocar de número · reenviar (só depois do contador) · "não chegou?" · atalho de desenvolvimento.

## Estados

- **Loading de sessão (cold start)** — hoje é `null` (`_layout.tsx:22`), ou seja, tela preta por
  cima do splash. Passa a **manter o splash** (`SplashScreen.preventAutoHideAsync` já está em
  `_layout.tsx:10`) até `useSession` resolver. O usuário nunca vê o intervalo.
- **Enviando / verificando** — o botão vira spinner in-place mantendo a altura (o
  `ActivityIndicator` de `:125-126` já faz isso), campos desabilitados, sem overlay de tela cheia.
- **Empty** — não existe: o campo vazio é o estado inicial.
- **Erro — código errado** — mensagem inline sob as caixas: *"Código errado. Confere e tenta de
  novo."*, os seis dígitos **limpos e com foco de volta na primeira caixa**, haptic
  `notificationAsync(Error)` (já existe em `:45`), shake curto. Nunca deixar o código errado no
  campo para o usuário apagar dígito a dígito.
- **Erro — código expirado** — texto próprio: *"Esse código expirou."* com o "Reenviar" liberado
  na hora, ignorando o contador.
- **Erro — muitas tentativas** — *"Muitas tentativas. Espera um minuto."* + contador. É o rate
  limit do Auth, e é a única mensagem que pede paciência.
- **Erro — sem rede** — *"Sem internet."* + "Tentar de novo", separado dos erros de código: a
  pessoa não pode achar que digitou errado quando o problema é o wi-fi.
- **Conteúdo longo** — nada cresce aqui; o número formatado tem tamanho fixo.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Passo telefone → código | continuidade espacial | slide horizontal curto (o passo avança, não navega), `Motion.base`, ~250 ms. O `FadeInUp`/`FadeInDown` de hoje (`:65`, `:75`, 600 ms) é lento demais para uma tela de atrito |
| Volta para o telefone | continuidade | o mesmo slide invertido, mais rápido — saída sempre menor que entrada |
| Erro de código | feedback | shake de ±6px, 200 ms, uma vez; haptic `notificationAsync(Error)` |
| Caixa de dígito ganhando foco | feedback | borda em `Motion.fast` (120 ms) |
| Contador de reenvio | mudança de estado | só o número muda, `tabular-nums`; **nada anima** — contador que pulsa vira ansiedade |
| Sucesso | — | sem animação própria: a troca do `Stack.Protected` é o movimento. Haptic `notificationAsync(Success)` (já existe em `:33`) |

## Acessibilidade

- Campo de telefone com `accessibilityLabel` "Número de WhatsApp com DDD" e a máscara **não**
  lida dígito a dígito pelo leitor.
- As seis caixas do código são **um** campo para o leitor de tela ("código de seis dígitos"), não
  seis campos anônimos.
- Erro com `accessibilityRole="alert"` e `accessibilityLiveRegion="assertive"` — quem não vê o
  vermelho precisa ouvir que o código está errado.
- Contador anunciado só ao chegar em zero ("Reenviar liberado"), nunca a cada segundo.
- Alvos ≥ 44pt em "Trocar", "Reenviar" e "Não chegou?", que hoje são texto solto (`:135`).
- Dynamic Type XL: as seis caixas encolhem em largura, nunca em tamanho de fonte.
- Contraste do botão primário em `tint` conferido nos dois temas — hoje o texto é `#ffffff`
  hardcoded (`:193`), que é hex em tela e reprova na contagem anti-slop.

## Fora de escopo

Login por e-mail/senha para o usuário final (o telefone **é** a chave do WhatsApp; um segundo
identificador quebraria o vínculo) · social login · biometria para reabrir o app · "lembrar deste
aparelho" · tela de cadastro separada (não existe: o primeiro OTP cria a conta) · recuperação de
conta por outro canal · trocar o número de uma conta existente (mexe em `profiles.phone`, que é
`unique` e é o que o webhook usa para achar o usuário — decisão de produto, não de tela).
