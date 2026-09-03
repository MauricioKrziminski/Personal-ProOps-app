-- Nome do usuário no perfil.
--
-- `profiles` guardava só o telefone, e por isso o app não tinha como saudar ninguém nem como
-- mostrar de quem é a conta sem escrever um número. Coluna anulável de propósito: quem já entrou
-- por Phone OTP não tem nome nenhum para preencher, e saudação sem nome simplesmente não aparece.
--
-- A política "profiles: own row" (0001) é `for all` na linha inteira — não há grant por coluna,
-- então o app já pode gravar aqui sem policy nova.

alter table public.profiles add column if not exists display_name text;
