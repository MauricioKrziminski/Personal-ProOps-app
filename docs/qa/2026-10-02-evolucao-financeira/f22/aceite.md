# F22 — aceite e limites

Estado: **aceito no staging** em 05/10/2026. Branch `gabriel/financas-22-melhorias`, staging
`utkqoiigimqzeenxkxdl`. [Contrato](contrato.md).

**Duplicar abre o formulário.** "Duplicar" (detalhe e toque longo da lista de Lançamentos) não
grava mais uma cópia: abre `/finance/lancar` (Uma vez) pré-preenchido, com a data de HOJE, e quem
grava é o Salvar. Copia só dado da pessoa (`paramsDaCopia`, `src/lib/duplicar.ts`, com teste da
lista de colunas); nunca id, fatura, plano, série, dívida, pagamento, status, vencimento ou
origem. A parcela vira lançamento à vista no valor dela ("Cópia da parcela 7/8 — vira um
lançamento à vista"). Pagamento de fatura, de dívida e juros do Pix não têm Duplicar.

**Favoritos** (`transaction_templates`): "Salvar como favorito" no formulário e "Virar favorito"
no detalhe gravam um modelo (nome padrão = título, sem data nem vínculo). A fileira Favoritos no
topo do formulário de criação preenche os campos e nunca grava sozinha. Gerenciar → Favoritos:
usar, editar, renomear, arquivar/desarquivar e apagar (apagar não toca lançamento nenhum).

## Banco

`20261005180000_transaction_templates.sql` (escrita como `20261005140000`, renomeada na
integração): RLS por espaço, nome único (sem caixa e espaços) só entre não arquivados, `fields`
objeto, autor com `on delete cascade` e índice, `revoke all` de public/anon/authenticated antes
dos grants. `transaction_templates.sql` (RLS entre usuários, unique, arquivar, anon) e
`anon_sem_execute` passaram depois do push. Types regenerados do staging.

## Código

Na integração: o topo do formulário juntou as perguntas da voz (F16), o seletor de formato, a
fileira de favoritos e a nota da cópia, nessa ordem; a transferência duplicada leva a conta de
destino. `npx tsc --noEmit`, `npx expo lint` e `npm test` (2345) com exit 0.

## Nativo

| Aparelho | Resultado |
|---|---|
| iPhone 17 Pro, iOS 26.5 (simulador) | 11/11: menu do detalhe, duas duplicações = dois lançamentos (data de hoje), parcela à vista, recorrente e transferência preenchidas, fatura e dívida sem Duplicar, toque longo na lista, favorito criado/usado sem gravar, nome repetido recusado, renomear/arquivar/desarquivar/apagar, Virar favorito, escuro + fonte grande + ocultar valores + Reduzir movimento. [Resultado e capturas](evidence/ios/) |
| Android 16 `emulator-5574` | 10 casos + 4 não verificados: menu, duplicar com a data de hoje, duplo toque = um, parcela à vista, fatura sem Duplicar, toque longo, favorito, nome repetido, Gerenciar → Favoritos com estrela, escuro + 1,3 + 384dp. [Resultado e capturas](evidence/android/) |

O "toque longo sem Duplicar" e "Gerenciar sem Favoritos" do primeiro relatório dos dois aparelhos
eram bundle velho: o Metro não pegou os arquivos escritos pelo `git apply`. Depois de `touch` e
relançar, conferido nos dois (reconferência do iPhone no `resultado.md`). No iPhone o item tocado
era o "Aluguel" previsto, que tem o menu das previstas.

Oráculo contra a linha de base do dev@: as linhas novas eram só as dos testes (2 "QA F22 iOS dup",
2 do Android e uma gravada sem querer no Android), todas `source='app'`, sem fatura, plano, série,
dívida, pagamento nem vencimento; nenhuma linha da base sumiu. Apagadas por ID, com o favorito
que sobrou.

## Limites

- Tocar num favorito já conta como uso ("usado Nx"), mesmo sem salvar o lançamento.
- A seção de arquivados diz "Arquivados · N" (o componente comum), não "Arquivadas".
- Não vistos: favorito com conta ou categoria arquivada/apagada, editar favorito no aparelho,
  transferência e pagamento de dívida no Android (o staging não tinha), ocultar valores no
  Android, "outro espaço não vê" (coberto no SQL).
- Salvar levou de 10 a 40 s no staging com os dois aparelhos ao mesmo tempo.
- O agente não usa favoritos nem duplica (`AGENTE-PARIDADE-COM-O-APP.md`).
- `QA-ANDROID-20261003-ANR` (F07) segue aberta. Sem produção, push ou tag.
