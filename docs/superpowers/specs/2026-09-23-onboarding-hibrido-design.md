# Onboarding híbrido: "Primeira frase" + "Próximo passo" (+ o caminho da importação)

Item 5 do lote de 23/09/2026 (tarde). Bug doc:
`docs/bugs/2026-09-23-tarde-calendario-busca-valor-financiamento.md`.

## O pedido

*"Onboarding/tutorial minimalista falando de tudo"*. O pai do dono do produto usou o app e não
sabia o que existia nele, nem como importar a fatura. O pedido é algo "bem criativo e moderno, no
nível de app de Awwwards".

## A evidência (pesquisa de 23/09/2026)

- **NN/g (n=70).** Tutorial em cartões na abertura não melhora o acerto: 91% contra 94%, sem
  diferença significativa. E faz as tarefas parecerem MAIS difíceis (p=0,047).
- **Chameleon (550 milhões de eventos).**
  - Tour de 3–4 passos completa ~72%; de 7 ou mais, 16%.
  - Aberto pelo toque da pessoa completa 67%; disparado por tempo, 31%.
- **YNAB e Monarch** trocaram o fluxo travado por checklist "no seu ritmo". **Revolut** mostra
  "Suggested for you" no lugar, conforme o uso. **Duolingo, Headspace e Things** ensinam fazendo.
- **A queixa do pai tem uma causa concreta.**
  - Não existe caminho para importar a partir da fatura nem dos Cartões: são quatro caminhos, e
    nenhum sai de onde a fatura mora.
  - A importação é do Pro, e o Free só descobre depois de escolher a conta e o arquivo (o erro
    402 no fim).

## Decisão (dono do produto): híbrido, "2 + 1"

1. **Na primeira abertura, "Primeira frase".** O passo ① deixa de ser três promessas em texto e
   vira uma demonstração. A pessoa toca num exemplo e vê o resultado se montar. Aprende vendo,
   sem ler.
2. **Dentro do app, "Próximo passo".** Um card na Hoje apresenta, um de cada vez, o recurso que a
   pessoa ainda não usou. Ele depende de dado real e aparece depois dos Primeiros passos.
3. **O conserto da importação.**
   - "Importar fatura" no menu da fatura e na ação de cada cartão, com a conta já escolhida.
   - A tela de importação avisa o Pro ANTES de pedir arquivo.

Tudo só JS (entra por OTA). Reanimated 4, Skia, gesture-handler e haptics já estão no projeto,
sem biblioteca nova.

## 1. "Primeira frase" (passo ① do onboarding)

- **Fica:** a marca girando, o título "Seu dinheiro, em ordem." e o subtítulo, que passa a ser
  "Fale do seu jeito. Toque num exemplo."
- **Três exemplos em pílula**, um por natureza do produto. Os três cobrem as três promessas que
  eram texto:

| exemplo | o que se monta embaixo |
|---|---|
| "Gastei 45 no mercado" | lançamento: ícone de sacola, "Mercado", "alimentação · hoje", **−R$ 45,00** |
| "Me lembra do aluguel todo dia 5" | lembrete: sino, "Aluguel", "todo dia 5 · 9h" |
| "Anota: comprar pão" | nota: "comprar pão", "Notas" |

- **O movimento**, ao tocar:
  1. a frase sobe num balão de conversa (lado da pessoa, tinta);
  2. ~300 ms depois, o cartão do resultado se monta (lado do app): o título entra, depois a linha
     de apoio, depois o valor, com um háptico leve no pouso;
  3. o cartão leva a etiqueta "exemplo". **Nada é gravado.**
- **Tocar outro exemplo** troca a cena em cross-fade.
- **Na chegada do passo** o primeiro exemplo toca sozinho, uma vez, depois da entrada. O passo
  mostra o produto mesmo para quem só aperta "Continuar".
- **Reduce Motion:** tudo vira fade, sem deslize nem mola.
- Balão e cartão usam os mesmos tokens da Conversa organizada da Hoje (balão da pessoa,
  `BlockHeader` de voz do app). Monocromático, e o vermelho/verde do valor são semânticos.

## 2. "Próximo passo" (card na Hoje)

**Quando aparece:** os Primeiros passos terminaram (ou foram escondidos), e sobra um passo
aplicável que a pessoa não dispensou. Um card por vez.

| ordem | passo | aplica quando | leva a |
|---|---|---|---|
| 1 | Traga a fatura do cartão | tem cartão e nunca importou (`import_batches`) | `/import?conta=<cartão>` |
| 2 | Veja até quando o dinheiro dura | sempre (sai ao tocar ou dispensar) | `/finance/forecast` |
| 3 | Peça um lembrete | nenhum lembrete | `/reminder-form` |
| 4 | Compra parcelada vira parcelas sozinhas | tem cartão e nenhuma compra parcelada | `/finance/transaction-form` |
| 5 | Anote do seu jeito | nenhuma nota | `/notes` |

**Conteúdo do card:**
- o glifo do recurso num selo redondo;
- um título e uma linha de apoio;
- o botão do passo (`secondary`);
- o "…" com "Agora não".

"Agora não" vale **por passo**, gravado no aparelho, por usuário.

**Movimento:** o card entra com a cascata da Hoje. Quando um passo sai (feito ou dispensado), o
próximo entra em cross-fade, com um háptico de seleção.

**Lógica:** pura em `src/lib/proximo-passo.ts`, com teste. As contagens vêm de UMA consulta
(`useProximoPasso`, contagens `head` em paralelo). Afirmar "falta fazer" exige `isSuccess`.

## 3. O caminho da importação

- **`/import?conta=<id>`:** a tela nasce com a conta escolhida.
- **Fatura:** o menu "…" ganha "Importar fatura" (a do cartão daquela fatura).
- **Cartões:** a lista ganha "Importar fatura" nas ações de cada cartão (toque longo).
- **Plano Free:** a tela de importação mostra, antes de pedir o arquivo, "Importar é do plano Pro"
  com o botão "Ver planos". O 402 continua como rede.

## Fora do escopo

- Reapresentar o onboarding para quem já concluiu. O "Próximo passo" é o caminho de descoberta
  para essa pessoa.
- Tour com destaque sobre a dock: no iOS a `NativeTabs` é a barra do sistema.
- A tela-vitrine "O que dá para fazer" (direção 3).

## Validação

- **Testes:**
  - `node --test` de `proximo-passo.ts`: a ordem, o que dispensa, e o `null` sem passo.
  - UI: a Hoje mostra o card só depois dos Primeiros passos.
  - UI: a importação com `?conta=` e o aviso do Pro.
- **Aparelhos:** Android 384dp × 1,3 e iOS, claro e escuro.
  - O onboarding, forçado pela flag `onboarding_completed = false` numa conta de teste.
  - A Hoje com os Primeiros passos concluídos.
  - O menu da fatura e o dos Cartões.
- Agente `ui-polisher` nas telas.
