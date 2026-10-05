# Sessão sem rede — fix `4b8049cf` (abertura sem rede com token vencido mostra "Sem conexão") — 05/10/2026

Android 16 (userdebug) `emulator-5574` (AVD `s26`), build `com.proops.personal.dev`, staging `utkqoiigimqzeenxkxdl`, sessão dev@
(`dev@proops.local`). HEAD `dd0f8e9b`. Nenhum código editado; nada gravado no staging além do login/refresh de sessão.

## Veredito

| Item | Resultado |
|---|---|
| (a) Offline + token vencido: "Sem conexão" + "Tentar de novo", nunca o login | **PASSA** |
| (b) Rede volta + "Tentar de novo": entra sem pedir senha | **PASSA** |
| (c) Rede volta sem tocar: entra sozinho | **PASSA** (ver tempo: ~56–62 s para sair do "Sem conexão") |
| (d) Controle sem sessão: abre direto no login, sem espera | **PASSA** |

## Prova de que o bundle é o novo

- Metro 8081 já de pé (não reiniciado). `curl` no bundle Android do manifesto
  (`index.bundle?platform=android&dev=true&…&transform.routerRoot=src%2Fapp…`, 19.866.519 bytes) contém `semConexao` (11),
  `carregarSessao` (3) e `TETO_SEM_REDE_MS = 12_000`.
- No aparelho: "Sem conexão" / "Tentar de novo" só existe no código novo (`src/components/auth/sem-conexao.tsx`) e apareceu.

## Como o cenário foi montado (e por quê)

- **Token vencido:** o token do aparelho (dev@) vencia em ~34 min. Relógio adiantado +3 h
  (`adb root` + `settings put global auto_time 0` + `cmd alarm set-time <ms+3h>`), então `expires_at` ficou no passado para o
  cliente. O servidor devolve `expires_at` pelo relógio dele, então depois de cada refresh o token ainda "vence" para o aparelho
  adiantado, sem precisar adiantar de novo em (c).
- **Rede:** `cmd connectivity airplane-mode enable/disable` (conferido: `Active default network: none`, `ping` →
  `Network is unreachable`; ao desligar, `ping` ao host do Supabase volta).
- **Armadilha de ambiente (não é do app):** este dev build busca o bundle em `10.0.2.2:8081`, que some em modo avião
  ("Unable to load script"). Foi preciso `adb reverse tcp:8081 tcp:8081` + gravar `debug_http_host=localhost:8081` em
  `shared_prefs/com.proops.personal.dev_preferences.xml`. Os dois foram DESFEITOS no fim.

## (a) Offline + token vencido — PASSA

`force-stop` → modo avião → relógio +3 h → abrir o app. O `AuthRetryableFetchError` ("Unable to resolve host
utkqoiigimqzeenxkxdl.supabase.co") é lançado pelo `getSession`, e a tela passa por: preto → logo (`a1`) → fundo creme vazio
(`a2`) → **"Sem conexão" + "Tentar de novo"** (`a3`; árvore de acessibilidade: `Sem conexão`, `Tentar de novo`). Ficou assim, sem mudar, enquanto estive
olhando (≥ 30 s em (a); ~70 s em (c)). Em nenhuma das capturas (a cada ~5 s) nem dos quadros de 2 s da gravação `c2` apareceu "Entrar"/e-mail/senha.

Tempo: "Sem conexão" aparece quando o PRIMEIRO `getSession` volta com erro (o teto de 12 s só é conferido depois dessa volta).
Nesta máquina (carregada, vários emuladores/simuladores em uso) isso levou ~21–27 s depois do "Running main" (log: 16:56:00,3 → erro 16:56:21,8 na
rodada (a); 13:59:11 → 13:59:38 na (c)), e há ~6–10 s de tela creme vazia antes do aviso. É mais que o "~15 s" do roteiro, mas o
resultado (aviso em vez de login) é o esperado; em build de release o início é bem mais curto.

Capturas: `00-estado-inicial.png` (logado, antes), `a1-abertura-splash.png`, `a2-abertura-carregando.png`, `a3-sem-conexao.png`.

## (b) Desliga o avião + "Tentar de novo" — PASSA

Rede de volta (ping ok), `b1` ainda mostra "Sem conexão". Toque em "Tentar de novo": creme → esqueleto da Hoje (`b2`) → Hoje
carregada, "Boa tarde, Gabriel" (`b3`), ~14–24 s depois do toque. Sem tela de login, sem pedir senha. O `RKStorage` passou a ter
token novo (`expires_at` = agora real + ~60 min, ou seja, o refresh foi feito de verdade).

## (c) Repetição sem tocar — PASSA

`force-stop` → avião → abrir (token ainda "vencido" para o relógio adiantado) → "Sem conexão" → ligar a rede às 13:59:51 e NÃO
tocar em nada. O app saiu sozinho do "Sem conexão": última leitura com o aviso às 14:00:46; às 14:00:53 já em transição (tela vazia);
14:01:09 esqueleto; **14:01:15 Hoje carregada**. Ou seja, ~56–62 s depois da rede voltar para sair do aviso (quem tira o app do
aviso é o refresh periódico do auth-js, não um novo `getSession`; o intervalo medido é o que importa) e
~84 s até a Hoje inteira. Dentro do "até ~60 s" para sair do aviso; mais longo para a tela completa.

Gravação `c2-gravacao-offline-religa-rede.mp4` (163 s) e folha de contato `c1-quadros-a-cada-2s.png` (1 quadro / 2 s): lançador →
preto (bundle) → logo → creme → "Sem conexão" (≈ 34 quadros) → esqueleto da Hoje → Hoje. **Nenhum quadro de login.**
`c3-entrou-sozinho-hoje.png`.

## (d) Controle: sem sessão de verdade — PASSA

`pm clear` (apaga o `RKStorage`, logo a chave `sb-…-auth-token`; NÃO foi usado "Sair", então nada foi revogado no servidor), `debug_http_host`
regravado (o `pm clear` apaga), modo avião ligado, abrir. Abre no **login** ("Entrar", e-mail, senha, "Entrar como teste (dev)") —
`d1-login-offline-sem-sessao.png` — e não aparece "Sem conexão". Tempo (gravação de tela + log, mesma máquina):

| Caso | `launch → Running main` | `Running main →` primeiro quadro do login |
|---|---|---|
| Sem sessão, OFFLINE | 14,3 s | ≈ 17 s |
| Sem sessão, ONLINE (`d2`) | 15,4 s | ≈ 14 s |

Offline e online diferem ~3 s (ruído desta máquina): o login sai do mesmo caminho de abertura, sem esperar o teto de 12 s nem o
aviso. Depois: rede ligada, "Entrar como teste (dev)" → dev@ logado de novo (Hoje carregada).

## Observações (não são defeitos do fix)

- O1. Em dev o auth-js escreve o `AuthRetryableFetchError` com `console.error`, o que acende a barra vermelha do LogBox sobre
  "Sem conexão" (capturas `a*`). Só existe em `__DEV__`.
- O2. `pm clear` zera preferências locais: a Hoje voltou com o cartão "Primeiros passos" no lugar de "Próximo passo", e permissões
  concedidas ao app foram perdidas. Estado local, não do servidor.

## Estado devolvido

Relógio automático (`auto_time` = 1; aparelho 14:28:07 = Mac), modo avião desligado, rede ok, `adb reverse` removido, arquivo
`…_preferences.xml` (`debug_http_host`) removido (o app volta a ler o Metro em `10.0.2.2:8081` e carregou), gravações em `/sdcard`
apagadas, app logado como dev@ na Hoje. Nada de produção tocado.
