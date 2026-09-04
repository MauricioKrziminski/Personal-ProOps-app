# Perfil — `src/app/(tabs)/profile/index.tsx`

Aba 4. Vira diretório com `<Stack>` aninhado (requisito para header nativo em `NativeTabs`); as
telas novas que nascem daqui — membros, histórico de importações, histórico de alertas — ficam
dentro dessa pilha (`(tabs)/profile/members.tsx` etc.), não no Stack raiz. Hoje tem 197 linhas, três cards e **nenhum dos três estados obrigatórios**: o fetch de
`expo_push_token` (linhas 27-33) ignora `error` por completo, então falha de rede vira "push
desativado" em silêncio.

## Pergunta que responde

> "Como está a minha conta, e como eu mexo nas configurações?"

Tela de manutenção. O sucesso dela é o usuário achar o que veio buscar e sair — não é uma tela
onde se passa tempo.

## Persona

- **Primária: qualquer usuário**, em momento raro (vincular WhatsApp, ativar notificação,
  convidar alguém, cancelar).
- **Secundária: o casal** — precisa ver quem está no workspace e com qual papel. Hoje
  `plan.tsx` mostra só o **número** de membros; `workspace_members` tem nome e `role` e nada lê.

## Entrada e saída

- **Entrada:** aba.
- **Saída:** `push` para plano, membros, lixeira de notas, histórico de importações, histórico de
  alertas, regras. Sair da conta → `replace` para login (porta de mão única via `Stack.Protected`).
- **Back:** aba raiz.

## Anatomia

Lista agrupada estilo iOS Ajustes — `Section` + `Row`, sem card solto para cada coisa.

1. **Header nativo** — large title "Perfil".
2. **Identidade** — número de WhatsApp vinculado, nome do workspace, marca monocromática discreta.
   `workspaces.name` é editável aqui (hoje não há como renomear em lugar nenhum).
3. **Conta**
   - Plano e cobrança → `/finance/plan`
   - Membros → **tela nova**: quem está, papel, remover, convidar
4. **Notificações**
   - Dois toggles independentes para avisos financeiros automáticos: push e WhatsApp. Ambos
     começam desligados; não existe fallback entre eles.
   - O toggle de push registra a capacidade do aparelho quando necessário, mas desligá-lo só
     muda a preferência e preserva o token usado pelos lembretes pessoais.
   - WhatsApp fica indisponível sem telefone verificado.
   - Histórico de alertas → tela nova (`alerts_sent` já tem policy de leitura para isso)
5. **Preferências**
   - Fuso horário (`profiles.timezone` — usado pelo cron de lembretes e nunca editável hoje)
   - Categorias sugeridas / Regras de categoria → `/finance/rules`
6. **Dados**
   - Lixeira de notas → `/notes/trash` (a tela **mora na aba Notas**, aqui é só um atalho —
     lixeira de nota pertence a notas, não a ajustes)
   - Importações → histórico (`import_batches`, hoje perdido ao recarregar a tela)
   - Exportar CSV
7. **Sair da conta** — `Row` destrutiva, isolada no fim, com action sheet de confirmação.

## Dados

| Bloco | Hook | Fonte | Observação |
|---|---|---|---|
| Sessão | `useSession` | Supabase Auth | — |
| Workspace | `useWorkspace()` **(novo)** | tabela `workspaces` | hoje sem nenhuma leitura no app |
| Membros | `useWorkspaceMembers()` **(novo)** | `workspace_members` | idem |
| Plano | `usePlanStatus` | RPC `plan_status` | já existe |
| Push | `usePushStatus()` / `useRegisterPush()` | `profiles.expo_push_token` | capacidade do aparelho, não consentimento para aviso automático |
| Avisos | `useAlertPreferences()` | `profiles.alerts_*_enabled` | preferências independentes, default `false` |
| Perfil | `useProfile()` **(novo)** | `profiles` | `timezone`, `locale`, `whatsapp_verified` |

## Ação primária

**Escolher se e por onde receber avisos financeiros automáticos.** Telefone e token só tornam o
canal possível; nenhum deles ativa avisos sozinho. Lembretes criados pela pessoa mantêm o canal
próprio em `reminders.channel`.

## Ações secundárias

Renomear workspace · ajustar fuso · convidar membro · exportar ·
lixeira · sair.

## Estados

- **Loading** — `Skeleton` no formato da lista agrupada (blocos de linha), nunca tela em branco.
- **Empty** — não existe empty real aqui; o que existe é **estado indefinido**: sessão carregando,
  plano não resolvido. Esses são loading, não empty.
- **Error** — inline por seção. `usePlanStatus` falhando não pode esconder o resto da tela, e o
  erro do fetch de push precisa **aparecer** (hoje é engolido).
- **Estados específicos de push**, cada um com texto próprio: permissão negada (com atalho para
  os Ajustes do sistema) · app não vinculado ao EAS · token gravado · falha ao gravar.
- **Conteúdo longo** — nome de workspace e telefone truncam; nunca quebram a linha.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Toggle de push | feedback | `Switch` nativo, sem reimplementar. Haptic `selectionAsync` |
| Seção Notificações subindo/descendo | continuidade | `LinearTransition` em `Motion.base` |
| Entrada das seções | continuidade | `FadeInDown`, stagger 60 ms |
| Sair da conta | — | sem animação de saída própria; a troca de rota é do navegador |

Tela de ajustes é o lugar onde movimento decorativo mais atrapalha. O padrão aqui é **quase nada**.

## Acessibilidade

- Toggle com label e estado anunciados.
- "Sair da conta" com `accessibilityRole="button"` e confirmação — nunca destrutivo em um toque.
- Alvos ≥ 44pt em toda `Row`.
- Telefone `selectable`.
- Dynamic Type XL: `Row` com valor trailing empilha em duas linhas em vez de truncar o label.

## Fora de escopo

- Avatar / foto de perfil: não existe no schema e não serve a nenhuma persona.
- Tema manual (claro/escuro/sistema): o app é `automatic`; só entra se pedirem.
- Trocar de workspace: hoje o usuário tem um só. A tela mostra qual é; seletor só quando existir
  o segundo.
- Excluir conta: precisa de decisão de produto e de retenção legal de dados — não inventar aqui.
