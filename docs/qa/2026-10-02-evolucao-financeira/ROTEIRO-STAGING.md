# Roteiro de teste no staging — evolução financeira (22 pontos)

Para o Gabriel testar com as próprias mãos. Banco: staging `utkqoiigimqzeenxkxdl` (selo
STAGING no app). Conta de demonstração: `dev@proops.local` (botão "Entrar como teste (dev)" no
build de desenvolvimento). Tudo aqui é JavaScript: não há mudança nativa, então vale a build de
desenvolvimento com o Metro ou uma atualização OTA no canal `staging` da build de staging 1.6.3.

Cada linha: **onde** abrir, **o que** fazer e **o que deve acontecer**. O detalhe e os limites de
cada ponto estão no `fNN/aceite.md` (ou `registro-nativo.md` em F01–F05).

## Lançar e editar

| # | Onde | O que fazer | O que deve acontecer |
|---|---|---|---|
| F01 | Finanças → Lançar → Uma vez | Escolha a **Forma de pagamento** (Pix, Crédito, Débito, Dinheiro, Transferência, Boleto) e salve | O detalhe do lançamento mostra a forma. Recorrente, parcelado e financiamento também guardam a forma. Trocar Uma vez ↔ Recorrente não perde o que foi preenchido |
| F02 | Formulário → campo da conta → **Criar conta / Criar cartão** | Cadastre uma conta sem sair do lançamento | A conta nova volta selecionada e o lançamento continua preenchido. Cancelar o cadastro não perde o lançamento |
| F03 | Formulário → seletor de conta | Abra a lista | Cada conta mostra o saldo; cada cartão, o limite disponível. Com "ocultar valores", os números somem |
| F04 | Formulário → preencha valor e conta | Veja o bloco **Ao salvar** | Mostra o saldo da conta (ou o limite do cartão) antes → depois, e diz que nada foi gravado. Muda na hora quando você muda o valor |
| F06 | Formulário de gasto → **Classificação** | Marque Fixo/Variável e Essencial/Não essencial | O detalhe mostra a classificação. Em Categorias dá para definir o padrão da categoria, que lançamentos novos herdam |
| F09 | Formulário → depois da categoria, **Detalhe** | Escolha ou crie uma subcategoria | O lançamento fica com o detalhe. Em Gerenciar → Categorias dá para mover, juntar e remover detalhes sem apagar lançamentos |
| F16 | Finanças (ou Hoje) → Lançar → **Por voz** | Fale "gastei 45 no mercado no pix" | Transcreve, você edita o texto, e "Montar lançamento" abre o formulário preenchido. Nada é gravado até você salvar |
| F22 | Detalhe de um lançamento → "…" → **Duplicar** (ou toque longo na lista) | Duplique um gasto antigo | Abre o formulário com os dados e a data de HOJE; só grava no Salvar. Parcela vira "cópia à vista" |
| F22 | Formulário → **Salvar como favorito**; depois Lançar de novo | Use a fileira Favoritos no topo | Tocar no favorito preenche o formulário; não grava sozinho. Gerenciar → Favoritos: renomear, editar, arquivar, apagar |

## Consultar

| # | Onde | O que fazer | O que deve acontecer |
|---|---|---|---|
| F05 | Lançamentos → **Filtros** → Forma de pagamento | Marque Pix (e/ou "Não informado") | A lista e o total mostram só aquela forma; "Ver mais" mantém o filtro |
| F15 | Finanças → bloco "Para onde foi" → **Por que mudou?** | Troque entre Categoria / Detalhe / Pagamento / Tipo | Diz quanto cada item contribuiu para a diferença entre os dois períodos; tocar numa linha abre os lançamentos daquele recorte |
| F17 | Ícone **(i)** ao lado do título de Saúde, Reserva, Orçamentos, Projeção, Investimentos, ciclo | Toque no (i) | Explica o que conta, o período (com as datas reais) e a fonte do número |
| F17 | Um aviso de fatura/conta (Perfil → Alertas) | Toque no aviso | Abre a fatura ou o lançamento; se não existir mais, "Isto não existe mais" com o caminho para a lista |

## Planejar

| # | Onde | O que fazer | O que deve acontecer |
|---|---|---|---|
| F07 | Patrimônio → **Reserva de emergência** | Configure meses-alvo, base (manual ou pelos últimos 3 meses) e as contas que formam a reserva | Mostra quanto a reserva cobre em meses e o que falta. Separar dinheiro na reserva não muda o saldo nem o patrimônio |
| F08 | Metas → **Plano de metas** / **Simular juntas** | Simule as metas juntas | Mostra se cabe no seu fluxo e quando aperta ("Menor disponibilidade") |
| F10 | Metas → Nova meta | Escolha "Tenho um prazo" ou "Posso guardar por mês" | Um calcula quanto guardar por mês; o outro, quando você chega lá |
| F11 | Metas → uma meta → **Guardar / Retirar** | Escolha "Já está na conta" ou "Transferir" | "Já está na conta" só separa (saldo não muda); "Transferir" move dinheiro de verdade entre contas. Dá para desfazer no extrato da meta |
| F14 | Orçamentos → "…" → **Planejar por percentual** | Distribua a renda em % por grupo/categoria e aplique | Mostra os reais calculados e o antes → depois dos limites; aplicar só vale para o padrão ou para o mês escolhido |
| F19 | Metas → editar meta | Escolha ícone, cor e marcos (25/50/75% ou valores) | O card mostra o próximo marco; ao guardar e passar de um marco, o anel celebra uma vez (depois que a folha fecha) |
| F20 | Patrimônio → Investimentos → **Quanto vou acumular** (ou menu "…" de Finanças) | Simule aporte, prazo, taxa e inflação; compare até 3 cenários | Mostra o valor no fim, em dinheiro de hoje, e quando a renda desejada é atingida. Nada é gravado no banco |

## Investimentos

| # | Onde | O que fazer | O que deve acontecer |
|---|---|---|---|
| F12 | Patrimônio → Investimentos → uma posição → **Aplicar / Resgatar** | Aplique de uma conta corrente | O dinheiro sai da conta e entra na posição; o resgate faz o caminho inverso |
| F13 | A mesma posição → **Atualizar valor** / **Rendimento** | Informe o valor atual | Mostra aplicado, valor atual e resultado; resgatar no mesmo dia da atualização desconta certo |

## Recorrentes e primeiro uso

| # | Onde | O que fazer | O que deve acontecer |
|---|---|---|---|
| F18 | Lançar → Recorrente → Tipo **Transferência** | Crie "Da conta" → "Para a conta" todo mês | A projeção mostra as duas pontas; receita e despesa do mês não mudam |
| F18 | Recorrentes → uma série → **Encerrar** | Encerre uma assinatura | Antes de confirmar, diz o que fica (pagas, atrasadas) e o que sai (futuras em aberto). A série vai para Encerradas e volta por **Reabrir** |
| F21 | Numa conta SEM nenhuma conta cadastrada: Finanças → **Começar as finanças** (ou Hoje → Primeiros passos → "Cadastrar conta ou cartão") | Siga os 4 passos (conta, cartão, primeiro lançamento, resumo); feche o app no meio e volte | Volta no mesmo passo sem duplicar nada; o saldo inicial não cria lançamento de abertura |

## Correções feitas depois do seu teste

| Onde | O que fazer | O que deve acontecer |
|---|---|---|
| Lançamentos → buscar "fun" | Veja o valor do Fundacred | O valor da linha no tamanho normal, nunca minúsculo — inclusive depois de buscar, girar a tela ou mudar o tamanho da fonte |
| Com a trava do app ligada (Perfil → Segurança): abra um lançamento para **Editar**, saia do app e volte | A tela de bloqueio | A trava aparece POR CIMA do formulário (e de qualquer folha aberta); depois de desbloquear, o formulário continua como estava |
| Com a trava ligada, no Android: abra uma folha (Metas → Guardar), saia, volte e aperte **Voltar** na tela de bloqueio | A tela de bloqueio | Voltar não destrava nem fecha a folha: depois do PIN a folha continua aberta |
| Financiamento com parcela vencida e não paga → **Editar** → data da próxima parcela | Escolha uma data que já passou (ex.: 23/09) | O campo mantém a data escolhida e avisa "Venceu em 23/09 e ainda não foi paga"; a ficha mostra essa parcela como atrasada e as seguintes nas datas certas do contrato; o ciclo atual mostra a parcela atrasada; no ciclo que já fechou ela soma em "faltou pagar" |
| Lançar → **Financiamento** com parcelas já pagas, a última paga dentro do ciclo atual (ex.: 8 pagas, 8ª em 23/09) | Escolha a conta que paga e responda **Sim** em "A 8ª (23/09) já saiu da conta X?" | A 8ª vira um lançamento pago naquela conta, aparece no ciclo ("o que entra e sai") como saída no dia dela e o saldo da conta cai o valor. As parcelas de ciclos anteriores ficam só contadas. Responder Não deixa como antes |

## Pelo WhatsApp / Agente

Os recursos acima são do app. O que o agente passa a fazer pela conversa entra aqui por lotes,
conforme cada um é publicado no staging (ver `docs/AGENTE-PARIDADE-COM-O-APP.md`). Teste pela aba
**Agente** do app (staging) ou pelo WhatsApp do número de staging. Toda escrita pergunta antes, com
os números do banco, e só grava no **Sim**.

### Lote A (no staging desde a revisão `agente-staging-00213`)

| # | Diga | O que deve acontecer |
|---|---|---|
| F18 | "todo dia 5 transfere 500 da conta corrente para a poupança" | Pergunta com as duas contas e a data; no Sim cria a série de transferência (aparece em Recorrentes, as duas pontas na projeção) |
| F18 | "encerra a assinatura da Netflix no fim do mês" | Antes do Sim diz o que fica (pagas, atrasadas) e o que sai (futuras em aberto); no Sim a série vai para Encerradas |
| F18 | "reabre a Netflix" | Pergunta e, no Sim, a série volta a gerar as próximas |
| F09 | "o detalhe da recorrente do mercado é feira" (com o detalhe "feira" criado no app) | Pergunta e, no Sim, a série fica com o detalhe; detalhe que não existe ou casa com dois vira pergunta com a lista. Criar/mover/juntar detalhes continua só no app |
| F15 | "por que gastei mais esse mês que no anterior?" | Responde quanto cada CATEGORIA contribuiu para a diferença, com os dois períodos escritos (os outros recortes ficam no app) |
| F05 | "mostra meus lançamentos no pix esse mês" | Lista só os de forma Pix e diz o recorte; "ver mais" mantém o filtro; "sem forma informada" lista os que não têm |

### Lote B (metas, investimentos, plano percentual — no staging desde `agente-staging-00215`)

| # | Diga | O que deve acontecer |
|---|---|---|
| F11 | "separei 300 na Nubank para a meta Viagem" | Pergunta deixando claro que o dinheiro FICA na Nubank (só reservado); no Sim a meta sobe R$ 300 e o saldo da conta não muda |
| F11 | "transfere 300 da Nubank para a poupança da meta Viagem" | Pergunta dizendo que é uma transferência de verdade; no Sim o dinheiro sai de uma conta e entra na outra, e a meta sobe |
| F11 | "tira 100 da meta Viagem" (com dinheiro separado em mais de uma conta) | Pergunta de qual conta; "tira 100 da meta Viagem para a Nubank" transfere de volta. Mais do que o guardado é recusado antes do Sim |
| F12 | "apliquei 1000 no CDB saindo da Nubank" (CDB = conta tipo investimento) | Pergunta dizendo que é transferência e mostrando a posição antes → depois; "resgatei 200 do CDB" faz o inverso; resgatar mais do que a posição é recusado antes do Sim |
| F13 | "o CDB está valendo 1.050" / "o CDB rendeu 30" | Valor: só o patrimônio muda, nenhum dinheiro entra. Rendimento: vira receita de verdade (categoria rendimentos) |
| F14 | "como está meu plano de orçamento?" e depois "aplica o plano em todas as categorias só neste mês" | Lista as linhas em % e reais; aplicar mostra cada limite antes → depois e só grava no Sim. Criar ou editar o plano continua no app |

### Lote C (forma de pagamento, classificação e detalhe ao lançar pelo agente — no staging desde `agente-staging-00217`)

| # | Diga | O que deve acontecer |
|---|---|---|
| F01 | "gastei 45 no mercado no pix" | A pergunta do Sim termina com "· no Pix"; o lançamento grava a forma Pix (veja no detalhe do lançamento no app) |
| F01 | "gastei 200 na loja no crédito" (sem citar o cartão, com mais de um cartão) | Pergunta qual cartão, com botões só de cartões; "pix no crédito" também pergunta o cartão e grava Pix no cartão |
| F01 | "gastei 30 de uber" (sem forma) | Grava SEM forma ("Não informado"), nunca chuta Pix |
| F06 | "paguei 1200 de aluguel, gasto fixo e essencial" | A pergunta mostra "· fixo · essencial"; "não essencial" nunca vira essencial; sem dizer nada, vale o padrão da categoria e a frase mostra "(padrão de <categoria>)" |
| F09 | "gastei 80 no mercado, detalhe feira" (com o detalhe "feira" criado no app) | Grava com o detalhe; detalhe que não existe ou casa com dois pede o nome exato e lista as opções. Nunca cria detalhe novo |

### Lote D (reserva, plano de metas, prazo × mês, marcos, favoritos e duplicar — no staging desde `agente-staging-00219`)

| # | Diga | O que deve acontecer |
|---|---|---|
| F07 | "minha reserva cobre quantos meses?" | Cobertura, meta e quanto falta (ex.: "cobre 3,3 meses"); sem base configurada ou revisada diz o que falta, nunca "0 meses". "Configura minha reserva" responde que isso é no app |
| F08 | "cabe no meu plano de metas?" | Só diz "Cabe" com tudo calculável; senão "Pelo que dá para calcular nos próximos 12 meses, não aperta, mas ficou fora: …". Sem renda lançada: "não dá para dizer que cabe" |
| F10 | "quero juntar 10 mil até dezembro de 2027" / "guardando 500 por mês, quando chego em 10 mil?" | Cria a meta mostrando quanto dá por mês, ou responde quando chega; avisa que o plano mensal não fica salvo (isso é no app) |
| F19 | "coloca marcos de 25, 50 e 75% na meta Viagem" / "ícone de avião e cor azul" / "qual o próximo marco da Viagem?" | Mostra marcos antes → depois e grava no Sim; ícone ou cor fora da lista do app vira pergunta com as opções; a consulta diz o próximo marco e quanto falta. "Quanto falta pra minha meta reserva?" fala da META, não da reserva de emergência |
| F22 | "lança meu favorito Almoço" | Pergunta com os dados do favorito e a data de hoje; grava no Sim. Favorito no crédito sem cartão pergunta o cartão; conta arquivada pergunta a conta |
| F22 | "repete o lançamento do mercado de ontem" | Pergunta a cópia com a data de hoje (parcela vira à vista no valor dela); pagamento de fatura, de dívida e juro do Pix não duplicam |
