# F06 — aceite técnico

Aceito em 03/10/2026 no staging `utkqoiigimqzeenxkxdl`, branch
`gabriel/financas-22-melhorias`. F07 liberado. Este aceite abrange classificação
independente, padrões e aplicação explícita de categoria, edição por alcance,
detalhe e recortes; não muda a identidade visual do app.

| Prova | Resultado confirmado |
|---|---|
| Código final | Node 1.703/1.703, zero falhas/skip/cancelled; TypeScript e lint exit0 após o ajuste final de validação |
| Banco | Quatro migrations novas aplicadas somente no staging, SHA preservados; tipos gerados; 16 suítes de rollback e casos do schema aplicado aprovados |
| Atomicidade | Replay de intenção, revisão esperada, duas conexões concorrentes e locks ordenados; decisões manuais protegidas por dimensão e workspace |
| Prévia | Caso real recusado antes da correção, depois 39 entradas válidas e duas inválidas; argumentos compartilhados com a escrita |
| Criação/edição | iOS e Android: criação, reabertura, defaults, decisões manuais/null, troca entre formatos e alcances de série/parcela/dívida |
| Sem efeito financeiro da classificação | Oito hashes financeiros comparados por leitura autenticada; o único gasto adicional do retry tem efeito esperado de nove centavos, um registro e um recibo |
| Recortes/recuperação | AND entre dimensões, OR nas opções, Não informado, previsões, cancelamento/aplicar/limpar, abertura fria/quente e URLs inválidas |
| Offline | Android: rascunho preservado, zero registros antes do retry, uma escrita confirmada ao recuperar rede |
| Interface | Claro/Escuro, fonte ampliada iPhone/Android, telefone384dp, layout800dp Android, iPad com rotação real; controles e ações alcançáveis |
| Privacidade | Dinheiro oculto visualmente e nos nomes acessíveis nos dois sistemas; não equivale a sessão falada de leitor de tela |
| Revisão independente | 17 capturas abertas e conferidas; única correção material de copy resolvida e recapturada; ship para a correção pontuada |
| Sistema visual | Merge F06 em DESIGN.md e sidecar; componentes incumbentes e controle compartilhado, sem nova paleta/biblioteca visual |

Rastreabilidade: [contrato](contrato.md), [banco](registro-sql.md),
[HTTP](registro-http.md), [matriz nativa e cronologia](registro-nativo.md),
[navegação Android](navegacao-android.md), [revisão visual](revisao-visual.md)
e [manifesto sanitizado das capturas](captures.json).

Limites: a fixture antiga de recorrência com data fixa vencida falha também no baseline
e não foi contada como verde. Offline nativo iOS, fala de VoiceOver/TalkBack, hardware
físico, build release, produção, paridade Gemini e benchmark de frames não certificados.
Android suporta retrato; o teste800dp usa resize do mesmo AVD. O veredito visual final
cobre a correção pontuada e mantém o alcance da revisão original. Preferências dos
simuladores/emulador foram restauradas. Evidências financeiras completas ficam privadas.
Sem push, release ou produção.
