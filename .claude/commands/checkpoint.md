---
description: Tira ou restaura um checkpoint dos dados (produção por padrão)
argument-hint: "[salvar | voltar | listar]"
---

Gerencie o checkpoint dos dados com `scripts/checkpoint.py`. Ação pedida: **$ARGUMENTS**
(sem argumento, entenda como `salvar`).

O checkpoint existe para o Gabriel poder mexer na conta REAL para testar e voltar tudo como
estava. Ele cobre o schema `public` inteiro; não cobre login (`auth.users`) nem as conversas do
agente (`langgraph`).

## salvar

```
agent/.venv/bin/python scripts/checkpoint.py backup --prod
```

Depois diga a pasta criada, quantas linhas e a versão do schema. Se o último checkpoint tiver
menos de uma hora, diga isso e pergunte se ele quer outro mesmo assim.

## listar

```
agent/.venv/bin/python scripts/checkpoint.py list
```

## voltar

**Isto APAGA os dados atuais.** Nesta ordem, sem pular passo:

1. `agent/.venv/bin/python scripts/checkpoint.py list`
2. Se ele não disse qual, mostre a lista e **pergunte** — nunca escolha por ele.
3. Diga, em uma linha, o que vai ser perdido: o que mudou desde aquele checkpoint (compare pelo
   menos a contagem de `transactions` atual com a do manifesto).
4. Só então:
   ```
   PROOPS_PROD_OK=1 agent/.venv/bin/python scripts/checkpoint.py restore <pasta> --prod
   ```
   ⚠️ Você não consegue rodar isso — o classificador de permissão recusa escrita em produção.
   **Entregue a linha para ele colar com `! ` na frente.**
5. Depois de ele rodar, confirme lendo o banco: contagem de `transactions`, `accounts` e o saldo
   das contas correntes.

Staging é o mesmo sem `--prod` e sem `PROOPS_PROD_OK`, e aí você mesmo pode rodar.
