# Validação financeira no PostgreSQL staging

Data: 2026-09-08. Migração 0057 já aplicada pelo coordenador antes deste teste.

Comando executado do diretório `agent/`:

```sh
PYTHONPATH=. .venv/bin/python scripts/verify_staging_finance.py
```

`scripts/supabase-target.sh` confirmou CLI e `.env.local` no staging `utkqoiigimqzeenxkxdl`. O script exige esse ref na DATABASE_URL e valida separadamente host direto ou usuário do pooler; produção e alvo não demonstrado são rejeitados antes da conexão. Não imprime credenciais, IDs de contas/perfis nem e-mails.

Todos os writes ficaram em uma única transação `psycopg.transaction(force_rollback=True)`. Foi criado um workspace exclusivo, com nome aleatório e apenas o ID de um perfil staging existente como autor. Não houve atualização de registros preexistentes.

| Caso executado no banco real | Resultado |
| --- | --- |
| Transação fixture com `source=whatsapp`, edição de valor | Mesmo registro e origem preservados |
| Mudança de data cruzando fechamento | Vencimento recalculado de 20/09 para 20/10/2026 |
| Troca entre dois cartões com datas diferentes | Fatura e vencimento atualizados para 15/10/2026 |
| Troca de cartão para conta bancária | Fatura e vencimento herdado removidos, ainda uma única transação |
| Financiamento: RPC de pagamento de 11.000 centavos, saldo inicial 100.000, juros 1% | Uma despesa; juros 1.000, principal 10.000, saldo 90.000 |
| Correção do último pagamento para 21.000 centavos | Mesmo pagamento, saldo 80.000 e uma parcela paga |
| Exclusão desse pagamento | Saldo original 100.000 e zero parcelas pagas restaurados |
| Recorrência fixture criada/editada com `auto_confirm=false` | Valor e regra persistiram dentro da transação |
| Verificação após rollback | Zero fixtures em workspaces, accounts, transactions, card_invoices, debts e recurring_transactions |

Saída final: **todos os casos executados passaram; rollback confirmado**.

O scheduler não foi executado: `materialize_horizon` e `_promote_due_transactions` abrangem dados globalmente, sem parâmetro de workspace. O teste de recorrência comprova armazenamento/edição, não materialização nem promoção automática.

A conexão direta valida constraints, triggers e RPC no PostgreSQL real. Não comprova RLS com sessão autenticada, interação no app, transporte WhatsApp, entrega de alertas nem produção. Nenhuma migration, scheduler global ou publicação foi executada por este script.
