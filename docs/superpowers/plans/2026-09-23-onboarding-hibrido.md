# Onboarding híbrido — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A primeira abertura ensina fazendo ("Primeira frase"), a Hoje apresenta um recurso por vez ("Próximo passo"), e a importação da fatura é achável de onde a fatura mora, com o aviso do Pro antes.

**Architecture:** Lógica de escolha do passo é pura (`lib/proximo-passo.ts`); as contagens vêm de uma consulta só; o card e a demonstração são componentes novos que usam os primitivos e tokens existentes. Nenhuma migration, nenhuma lib nova.

**Tech Stack:** Expo SDK 57, Reanimated 4, TanStack Query, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-23-onboarding-hibrido-design.md`

## Global Constraints

- Só JS (OTA). Sem biblioteca nova. Nada de `LinearTransition`; Reduce Motion vira fade.
- Monocromático, tokens (`theme.ts`/`tokens.ts`), zero hex/`fontSize` solto; "menos texto".
- Texto dentro de `Animated.View` com `entering` leva `flexShrink: 0` (design.md §3).
- A demonstração NÃO grava nada.
- Commits de uma linha, sem Co-Authored-By. Sem tag.

## Review Focus

1. Conta sem cartão nenhum: "Traga a fatura" e "Compra parcelada" nunca aparecem.
2. Consulta das contagens falhando: o card não aparece (nunca afirma "falta fazer" sem resposta).
3. `/import?conta=` com um id que não é da pessoa ou não existe: a tela ignora e segue sem conta.
4. Trocar de exemplo no meio da animação: a cena anterior não fica pela metade na tela.
5. Plano Pro: o aviso do Pro não aparece.

---

### Task 1: A escolha do próximo passo (pura)

**Files:** Create `src/lib/proximo-passo.ts`; Test `src/lib/proximo-passo.test.ts`

**Produces:** `type ProximoId = 'importar' | 'projecao' | 'lembrete' | 'parcelada' | 'nota'`; `proximoPasso(i: { cartaoId: string | null; importou: boolean; lembretes: number; parceladas: number; notas: number }, dispensados: ReadonlySet<ProximoId>): Proximo | null` com `Proximo = { id; titulo; texto; acao; icon; href }`.

- [ ] Teste que falha: ordem (importar → projeção → lembrete → parcelada → nota); sem cartão não oferece importar nem parcelada; dispensado pula; tudo feito e dispensado → `null`; `href` do importar leva `?conta=<cartaoId>`.
- [ ] Implementação; `node --test src/lib/proximo-passo.test.ts` verde.
- [ ] Commit `feat(onboarding): a escolha do próximo passo a partir do dado real`.

### Task 2: O card "Próximo passo" na Hoje

**Files:** Create `src/hooks/use-proximo-passo.ts`, `src/components/feed/proximo-passo.tsx`; Modify `src/app/(tabs)/today/index.tsx`; Test `src/lib/simple-finance-ui.test.ts` (ou o teste de UI da Hoje, se houver)

- [ ] `useProximoPasso(userId)`: uma `useQuery` (`['proximo-passo']`) com contagens `head` de `import_batches`, `reminders`, `notes` (sem lixeira) e `installment_plans`, mais o primeiro cartão de `useAccounts`; dispensados em AsyncStorage (`hoje:proximo-dispensados:<userId>`, JSON), leitura com `try/catch`. Devolve `{ passo, dispensar, pronto }`, e `passo` só quando a consulta tem `isSuccess`.
- [ ] `ProximoPassoCard`: card `surface` + borda; selo com o glifo, título (`headline`), apoio (`small`), `Button` `secondary` sm com a ação; "…" → `showItemActions('Próximo passo', [{ label: 'Agora não' }])`. Troca de passo em cross-fade (`key={passo.id}` + `FadeIn`/`FadeOut`), háptico de seleção.
- [ ] Hoje: mostra o card quando `!mostrarPassos` e há passo; tocar a ação navega e, no caso da projeção, dispensa.
- [ ] Teste de UI: com Primeiros passos pendentes o card não aparece; concluídos, aparece.
- [ ] Validar Android 384dp × 1,3 claro/escuro e iOS. Commit `feat(onboarding): card Próximo passo na Hoje`.

### Task 3: O caminho da importação

**Files:** Modify `src/app/import.tsx`, `src/app/finance/invoice/[id].tsx`, `src/app/finance/cards.tsx`

- [ ] `import.tsx`: `useLocalSearchParams<{ batch?: string; conta?: string }>`; `accountId` nasce de `params.conta` quando ele está em `accounts` (senão `null`); `usePlanStatus()`: com `plan === 'free'`, antes do seletor de arquivo, um `Card` com "Importar é do plano Pro" e `Button` "Ver planos" → `/paywall`.
- [ ] Fatura: `HeaderMenu` ganha "Importar fatura" (ícone `square.and.arrow.down`) → `router.push({ pathname: '/import', params: { conta: fatura.account_id } })`.
- [ ] Cartões: a ação de cada cartão (o toque longo, ou o menu que a linha já tiver) ganha "Importar fatura".
- [ ] Validar no Android e no iOS (menu da fatura, Cartões, a tela com a conta escolhida). Commit `feat(import): importar fatura a partir da fatura e dos cartões, com o aviso do Pro antes`.

### Task 4: "Primeira frase" no passo ① do onboarding

**Files:** Create `src/components/onboarding/primeira-frase.tsx`; Modify `src/app/onboarding.tsx`

- [ ] `PrimeiraFrase`: três pílulas de exemplo; estado `escolhido`; a cena (`key={escolhido}`) = balão da pessoa (tinta, alinhado à direita) + cartão do resultado (surface, alinhado à esquerda, etiqueta "exemplo"), entrando em sequência com `FadeInDown`/`FadeInUp` e atrasos de `Motion`; háptico `impactAsync(Light)` no pouso do cartão; Reduce Motion → `FadeIn`. O primeiro exemplo toca sozinho uma vez, depois da entrada (`setTimeout` limpo no unmount).
- [ ] `onboarding.tsx`: no passo ① a lista `PROMESSAS` sai; o subtítulo vira "Fale do seu jeito. Toque num exemplo."; `PrimeiraFrase` entra no lugar.
- [ ] Validar: onboarding forçado numa conta de teste (`onboarding_completed=false` no metadata do `dev@`, e devolver no fim) no Android 384dp × 1,3 claro/escuro e iOS; gravar em vídeo a sequência (adb screenrecord). Commit `feat(onboarding): o passo de boas-vindas ensina fazendo`.

### Task 5: Fechamento

- [ ] `ui-polisher` nas telas; aplicar o que couber.
- [ ] Tabela de validação do item 5 no bug doc. Commit `docs(bugs): validação do onboarding`.
