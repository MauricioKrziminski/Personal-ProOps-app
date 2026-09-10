# Checklist: corrigir a planilha (10/09/2026)

Alvo: `~/Library/CloudStorage/GoogleDrive-.../My Drive/Gastos/Planilha de gastos.xlsm`

Fonte: `docs/bugs/2026-09-09-conciliacao-setembro.md` (conferido linha a linha contra os PDFs/OFX).
**Os documentos originais não existem mais** — nada aqui foi re-derivado da fonte primária.

**Prova de que a lista está certa** — aplicando tudo abaixo:

| fatura | planilha hoje | corrigida | real (PDF) | Δ |
|---|---|---|---|---|
| Nubank 03/08→02/09 | 2.759,28 | **3.271,74** | 3.271,77 | 0,03 (ruído do PDF) |
| BB venc. 10/09 | 290,05 | **1.432,51** | 1.432,51 | **0,00 — exato** |

---

## ⚠️ Duas armadilhas antes de começar

**1. As fórmulas somam FAIXAS FIXAS. Linha fora da faixa não entra em total nenhum.**

| bloco | fórmula | faixa | livres em Setembro | livres em Outubro |
|---|---|---|---|---|
| Fixos | `G5 =SUMIF(E9:E20,"✖",I9:I20)` | **9–20** | 17, 18, 19, 20 | 17, 18, 19, 20 |
| Parcelamentos | `G22 =SUM(I26:I42)` | **26–42** | 40, 41, 42 | 38–42 |
| Gastos do Mês | `L5 =SUM(O9:O42)` | **9–42** | 30–42 | 11–42 |

**2. Em Fixos, a linha só conta se a coluna `E` for `✖`.** O `G5` é um `SUMIF` por esse símbolo —
linha nova sem o `✖` entra na tela e fica de fora do total.

> Bug latente da planilha, sem relação com esta correção: `V4` (Pix) e `V5` (Itaú) somam
> `M9:M41`, mas `V6` (BB), `V7` (Nubank) e `R23:R26` somam `M9:M42`. **Não use a linha 42 do bloco
> Gastos do Mês** — ela conta para uns tipos e não para outros.

---

## ⚠️ O "mês" da planilha não é o mês do app

`H2` diz **"03 Agosto → 02 Setembro"**: sua aba é o **ciclo da fatura Nubank**; o mês do app é o
**calendário**. Compare fatura com fatura.

E o mais importante: a produção **já foi corrigida por estes mesmos documentos**. Depois desta
lista as duas vão concordar nos DADOS por construção. A comparação passa a testar **lógica de
projeção** (ciclo de fatura, cronograma de parcela, recorrente, saldo que rola) — que é onde o
defeito real já apareceu uma vez.

---

# Aba "Setembro 26"

## 🔴 REMOVER (1)

| onde | o quê | por quê |
|---|---|---|
| `K17` | **Despesa Gato — 120,00** | não está na fatura, nem no extrato de agosto, nem no de setembro. A conta só fecha sem ela |

> Atalho: em vez de apagar e depois inserir, **reaproveite a linha 17** para o "Saldo em rotativo"
> logo abaixo.

## 🟢 ADICIONAR (4)

**Fixos** — use as linhas livres **17, 18, 19**, e não esqueça o `✖` na coluna `E`:

| C (Nome) | E | F (Data) | G (Tipo) | H (Categoria) | I (Valor) |
|---|---|---|---|---|---|
| Servicos Cla*Claro | ✖ | 12 | Nubank | Contas | **20,00** |
| Apple.Com/Bill | ✖ | 21 | Nubank | Assinaturas | **12,90** |
| MP*Ultrapasse Mensal | ✖ | 12 | **BB** | Contas | **3,99** |

**Gastos do Mês** — linha **17** (a que sobrou do Gato) ou a **30**:

| K (Nome) | L (Data) | M (Tipo) | O (Valor) |
|---|---|---|---|
| Saldo em rotativo de agosto | 10 | Nubank | **333,72** |

> Esta é a maior fonte de diferença estrutural: a fatura real tem "fatura anterior", e a planilha
> não modela isso.

## 🟡 CORRIGIR (15)

**Fixos**

| célula | de | para |
|---|---|---|
| `G12` Claude ProOps | `Pix` | **`BB`** ← 1.138,50 vão para a fatura BB |
| `G11` Manutenção dentista | `Pix` | **`Nubank`** ← é Pix no crédito |
| `I11` Manutenção dentista | 177,01 | **177,00** |
| `G13` DAS | `Pix` | **`Nubank`** ← é Pix no crédito |
| `F9` Meli+ | 11 | **9** |

**Parcelamentos**

| célula | de | para |
|---|---|---|
| `I30` Emprestimo Nubank | 782,61 | **781,64** |
| `F30` Emprestimo Nubank | 5 | **4** |
| `I31` Emprestimo Nubank 2 | 870,15 | **858,87** |
| `F31` Emprestimo Nubank 2 | 10 | **4** |
| `F29` Fundacred | 31 | **4** |
| `F34` Globo Premiere | 11 | **3** |
| `F36` Playground Gato ML | 18 | **3** |
| `I36` Playground Gato ML | 56,43 | **56,42** |
| `I33` Controle (mãe) | 60,11 | **60,08** |
| `F39` / `I39` Carro Peças | 21 / 140,11 | **22** / **140,12** |

**Gastos do Mês / Entradas**

| célula | de | para |
|---|---|---|
| `O10` Pix Karen | 85,23 | **85,22** |
| `R10` Pix Winicius | 303,00 | **420,00** |
| `R11` Pix pai carro | 340,00 | **350,00** |

> ✅ **Não mexa nos números de parcela** (2/10, 2/2…). A planilha já estava certa; era o app que
> estava um número atrasado.

---

# Aba "Outubro 26" (ciclo 03/09 → 02/10)

⚠️ O OFX que embasa isto é de **09/09** — cobre só até lá.

## 🔴 REMOVER (1) + conferir (1)

| onde | o quê | por quê |
|---|---|---|
| `C12` | **Claude ProOps — 1.091,58 (Pix)** | a partir de outubro sai do BB e vira DUAS assinaturas no Nubank. Reaproveite a linha (abaixo) |
| `K10` | **Despesa Gato — 120,00** | ⚠️ **confira.** É a mesma linha fantasma de setembro, mas nenhum documento cobre outubro — não dá para provar nem negar |

## 🟢 ADICIONAR (7)

**Fixos** — linha **12** (a do Claude) + livres **17, 18, 19**. Todas com `✖` em `E`:

| C (Nome) | E | F | G | H | I (Valor) |
|---|---|---|---|---|---|
| Claude (ProOps) | ✖ | 4 | Nubank | Assinaturas | **567,64** |
| ChatGPT (pessoal) | ✖ | 4 | Nubank | Assinaturas | **546,54** |
| IOF internacional (Claude) | ✖ | 4 | Nubank | Contas | **19,86** |
| IOF internacional (ChatGPT) | ✖ | 4 | Nubank | Contas | **19,12** |

**Gastos do Mês** — livres a partir da **11**:

| K (Nome) | L | M | O (Valor) |
|---|---|---|---|
| Casa do Acai Cafe | 4 | Nubank | **37,00** |
| Shopee *Shpstecnologia | 6 | Nubank | **19,99** |
| Auto Posto Costa Costa | 7 | Nubank | **70,00** |
| Auto Posto Costa Costa | 7 | Nubank | **14,00** |

## 🟡 CORRIGIR (13)

| célula | de | para |
|---|---|---|
| `F9` Meli+ | 11 | **8** |
| `G11` Manutenção dentista | `Pix` | **`Nubank`** ⚠️ mesma regra de setembro; sem documento de outubro |
| `G13` DAS | `Pix` | **`Nubank`** ⚠️ idem |
| `I30` Emprestimo Nubank | 782,61 | **781,64** |
| `F30` Emprestimo Nubank | 5 | **4** |
| `I31` Emprestimo Nubank 2 | 870,15 | **858,87** |
| `F31` Emprestimo Nubank 2 | 10 | **4** |
| `F29` Fundacred | 31 | **4** |
| `F34` Globo Premiere | 11 | **3** |
| `F35` Mac (2/12) | (vazio) | **3** |
| `F36` / `I36` Acessorios Mac | (vazio) / 134,16 | **3** / **134,15** |
| `F37` / `I37` Carro Peças | 21 / 140,11 | **3** / **140,10** |
| `R10` / `R11` Winicius / pai carro | 303 / 340 | **420,00** / **350,00** |

---

# Aba "Agosto 26" — só 3 datas

Os valores dos empréstimos **já estão certos** aqui (781,64 e 858,87).

| célula | de | para |
|---|---|---|
| `F30` Emprestimo Nubank | 5 | **4** |
| `F31` Emprestimo Nubank 2 | 10 | **4** |
| `F29` Fundacred | 31 | **4** |

---

# O que NÃO dá para verificar

- **Novembro 26** — nenhum documento cobre.
- **Outubro depois de 09/09** — Vivo (08/09), Nubank Chroma (10/09) e Cabelo Marcelao (15/09) não
  tinham postado. Deixe como previsto.
- **Carro (1.485,00, Itaú, dia 23)** — sai do BB, sem documento.
- **Fundacred de outubro (1.170,42)** — o valor varia todo mês; sem documento.
- **Salário CLT** — a planilha lança 2.632,00 como uma entrada só. Na realidade são duas
  (1.488,02 dia 5 + 1.148,00 dia 20) e **não caem na conta corrente do Nubank** — chegam no BB.
  Agosto diz 2.636,02 e Set/Out dizem 2.632,00; decidir exige um extrato do BB.

---

# ✅ Salário PJ — resolvido, nada a fazer

Confirmado pelo Gabriel: **dia 5, na Conta corrente**. Produção já está assim
(`FREQ=MONTHLY;BYMONTHDAY=5`, conta `Conta corrente`, futuras 05/10, 05/11, 05/12).

⚠️ O §6 do doc de 09/09 erra nesta linha ("real dia 4"): **05/09/2026 caiu num sábado**, então o
crédito veio na sexta, 04/09. A conciliação leu data de CRÉDITO como dia AGENDADO.

> **Regra que fica:** data de crédito num extrato não é o dia agendado de uma recorrência. Antes
> de mover uma série por causa de extrato, veja em que dia da semana caiu o dia nominal.
> Os empréstimos e o Fundacred no dia 4 continuam valendo — 05/08/2026 foi quarta-feira.

Sem ação, mas anotado: **05/12/2026 também é sábado**, então dezembro deve cair em 04/12.
