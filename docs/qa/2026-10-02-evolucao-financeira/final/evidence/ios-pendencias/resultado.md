# Pendências iOS (iPhone 17 Pro, staging utkqoiigimqzeenxkxdl) — 05/10/2026

Bundle conferido antes: Finanças → Gerenciar lista "Favoritos" (`00-bundle-favoritos.png`). App `com.proops.personal.dev`, dev@, Metro 8081.

## Como o offline foi produzido
O app é build debug comum (sem dev client) e lê a URL do Supabase de `Constants.expoConfig.extra.proops` gravado no build (`EXConstants.bundle/app.config`), que vence qualquer `EXPO_PUBLIC_*` do Metro; o segundo Metro na 8082 não teve efeito (a porta do Metro também está fixa em `RCTMetroPort` no Info.plist). Caminho usado:
1. Proxy local `aiohttp` em `127.0.0.1:54400` repassando para o Supabase de staging (só REST; Realtime não foi necessário).
2. No app INSTALADO no simulador (não no repositório) troquei `supabaseUrl` em `EXConstants.bundle/app.config` para `http://127.0.0.1:54400` (backup feito) e relancei; a chave de sessão muda com o host, então entrei por "Entrar como teste (dev)" (dev@ no staging).
3. Offline = `kill -9` do proxy; online = subir de novo. O bundle JS veio do Metro 8081 (o 2º Metro foi parado).
Restaurado ao final: `app.config` original, Info.plist original, proxy parado, app em dev@ no 8081 (`14-final-8081.png`).

## A. Offline
| Caso | Resultado |
|---|---|
| F02: "Criar conta" no seletor de origem, proxy derrubado no salvar | PASSA. Aparece "A confirmação não chegou. Verifique este cadastro antes de alterar os campos" + "Verificar cadastro"; nome, tipo e saldo ficam desabilitados (`enabled=false`) e título/valor/Pix do lançamento conservados (`03-offline-criar-conta.png`). |
| F02: proxy de volta → Verificar cadastro | PASSA. Exatamente 1 chamada `create_account` no proxy e 1 conta no banco: `QA FIN iOS offline conta` (`6314366e-c468-403a-8105-643a54d260c7`, corrente). Conta já selecionada no lançamento (`06-conta-selecionada.png`). |
| F02: salvar o lançamento | PASSA. 1 `save_transaction_payment`; `QA FIN iOS offline gasto` (`40b4672d-00ee-4684-93d1-fdf2c4a62046`), 123 cent, pix, na conta nova. |
| F01: Boleto com proxy derrubado | PASSA. Toast "Nada foi salvo. Tenta de novo." (`07-boleto-offline-toast.png`), formulário e campos intactos, nenhum lançamento criado. |
| F01: proxy de volta → salvar | PASSA. 1 `save_transaction_payment`; `QA FIN iOS offline boleto` (`edeff882-059e-42bb-9f62-532a2140a897`), 123 cent, `payment_method=boleto`, sem conta. |

## B. F22
| Caso | Resultado |
|---|---|
| Favorito com conta arquivada | PASSA. Conta `QA FIN iOS conta fav` (`d9656b1d-1ac9-4c5d-9682-d11de2b9411b`, corrente, arquivada); favorito `QA FIN iOS fav conta` (`b8d26a83-d4a1-4225-a339-a0e5e6376862`). Ao usar: Conta vem "Sem conta" e aparece "Esta conta não está disponível. Escolha outra conta." (`08-fav-conta-arquivada-aviso.png`). Nada salvo. |
| Editar favorito (valor + categoria) | PASSA. 5,00 → 7,89 e categoria casa; também preenchi o título `QA FIN iOS fav titulo`. Linha da lista: "R$ 7,89 · casa" (`12-favoritos-editado.png`); `fields` no banco com amount 789, category casa. |
| Usar o favorito editado | PASSA. Título, 7,89 e "casa" selecionada vêm preenchidos (`13-usar-favorito-editado.png`). Nada salvo. |

## Observações (não são defeitos confirmados)
- Editar um favorito cuja conta foi arquivada deixa "Salvar" desabilitado até escolher explicitamente outra opção no seletor de conta (inclusive "Sem conta", que já aparece selecionado). Pode confundir; a mensagem existe, mas o seletor mostrar "Sem conta" já escolhido sugere que está tudo certo.
- O favorito contou `use_count = 2` (duas aberturas por "usar"), sem lançamento salvo.
- O staging estava lento/instável hoje (auth 504, leituras de 5-20 s), por isso alguns "Sem resposta do servidor" aparecem fora dos casos de offline; não é do app.

## Nomes criados (não apaguei nada)
- Contas: `QA FIN iOS offline conta` (6314366e-c468-403a-8105-643a54d260c7), `QA FIN iOS conta fav` (d9656b1d-1ac9-4c5d-9682-d11de2b9411b, arquivada)
- Lançamentos: `QA FIN iOS offline gasto` (40b4672d-00ee-4684-93d1-fdf2c4a62046), `QA FIN iOS offline boleto` (edeff882-059e-42bb-9f62-532a2140a897)
- Favorito: `QA FIN iOS fav conta` (b8d26a83-d4a1-4225-a339-a0e5e6376862)
