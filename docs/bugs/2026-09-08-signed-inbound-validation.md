# Webhook assinado: validação HTTP isolada

08/09/2026. Executar: `agent/.venv/bin/python agent/scripts/verify_signed_inbound.py` na raiz do repositório.

O harness sobe uvicorn em porta efêmera de `127.0.0.1`, monta o router real `app.routes.inbound`, preserva HMAC/thread_id reais e chama `agent/scripts/fake_meta.py` em subprocessos. Banco, sessão e agendamento de tarefas são substituídos por memória. Não carrega o lifespan de produção, não lê `.env`, não conecta banco, não chama Cloud Tasks, Gemini ou WhatsApp. Segredo e telefone são fictícios; tudo termina ao sair.

Resultado executado:

- Texto “gastei 125 no mercado no cartão Nubank”: HTTP 200 e corpo preservado.
- Clique `pa:fixture-pending:c:change_card` com título “Trocar de Cartão”: HTTP 200; ID/título/list_reply preservados na fila.
- Dois payloads na mesma thread, duas tasks de debounce; segundo cancela a task anterior.
- HMAC inválido, ausente e corpo adulterado após assinatura: HTTP **401**, zero efeitos na fila/tarefas. Esse é o contrato atual do POST. **403** é a resposta real para token incorreto no GET de verificação, testado separadamente.
- Ruff do harness passou.

Limite: prova real de HTTP + assinatura + entrada/fila em memória. Não comprova worker, interpretação do clique no grafo, checkpoint persistido, resposta Meta ou WhatsApp fim a fim. O teste de grafo `test_card_change_consent.py` cobre separadamente que trocar cartão preserva rascunho e não executa; não confundir essas duas evidências com um único E2E publicado.
