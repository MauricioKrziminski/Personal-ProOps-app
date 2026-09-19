# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Uma pessoa só, cuidando da própria vida financeira e das próprias pendências, no Brasil. Ela
anota no WhatsApp ao longo do dia, em linguagem natural e às pressas ("gastei 45 no mercado",
"me lembra de pagar o aluguel todo dia 5"), e abre o app depois para ver aquilo organizado e
decidir o que fazer. O caso real do dono do produto: salário em duas datas, dois cartões
vencendo no mesmo dia, e uma planilha paralela que o app existe para aposentar.

## Product Purpose

App mobile pessoal de notas rápidas, lembretes e controle financeiro completo (lançamentos,
contas, cartões e faturas, parcelamentos, metas, orçamentos, dívidas, projeção de caixa),
operado por conversa com um agente de IA — pelo WhatsApp e dentro do próprio app. Sucesso é a
pessoa confiar no número da tela sem conferir numa planilha: "quanto eu realmente posso gastar
até o fim do meu ciclo".

## Positioning

O que a pessoa joga solto na conversa aparece organizado no app em tempo real, e o app é o lugar
calmo onde ela decide. A IA entende; quem calcula e grava é código determinístico, com
confirmação antes de qualquer escrita destrutiva ou de valor alto. O mês financeiro fecha no dia
em que o usuário paga, não no dia 31.

## Operating Context

- Uso em pé, entre uma coisa e outra, com o celular numa mão; Android e iPhone, com fonte do
  sistema frequentemente aumentada (régua de verificação: 384dp × fonte 1,3).
- Aberto várias vezes por dia para conferir um número; formulários e ajustes são ocasionais.
- Convive na tela com apps de banco e carteira do sistema, e é comparado com eles.
- Dinheiro sensível: há "esconder saldo" e trava por biometria/senha do sistema.

## Capabilities and Constraints

- Expo SDK 57 (managed) + expo-router + TypeScript; Reanimated 4, Skia, Gesture Handler já no
  projeto. iOS usa a tab bar nativa (`NativeTabs`, Liquid Glass); Android tem tab bar própria.
- Backend Python/FastAPI + LangGraph (Gemini); Supabase Postgres como banco e fila.
- Login por e-mail e senha (código de 6 dígitos por e-mail) e Phone OTP para quem já tinha conta.
- Dinheiro sempre em centavos inteiros; texto de interface em pt-BR informal.
- A interface nunca mostra valor falso, nem por um quadro de animação.

## Brand Commitments

- Nome do app: "ProOps".
- A marca (a espiral, `assets/images/brand/`) é monocromática: preta no claro, branca no escuro;
  nunca colorida.
- Cor de emissor aparece só dentro da forma de um cartão de crédito. Roxo como cor do app está
  descartado (lê como um banco concorrente no Brasil).
- Cores e tipografia da interface estão abertas para redesenho (decidido em 16/09/2026); a marca
  não.

## Evidence on Hand

- Dados de demonstração no staging (usuário `dev@proops.local`), sem dado financeiro real.
- Nenhum depoimento, cliente ou número de mercado para usar em tela.

## Product Principles

1. Calma acima de tudo o que é frequente; espetáculo só onde é raro e merecido.
2. Número verdadeiro sempre — animação nunca inventa um valor.
3. Na dúvida, perguntar; nunca deduzir em nome do usuário.
4. Cada plataforma no seu idioma: iOS e Android não precisam ficar iguais.

## Accessibility & Inclusion

Dynamic Type/fonte grande sem truncar identificadores, alvos de toque de 44pt, rótulo em todo
botão só-ícone, Reduce Motion respeitado, light e dark.
