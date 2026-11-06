-- add_verificar_cadastro_matricula.sql — 06/11/2026
--
-- Impede que alguém que JÁ tem conta de login crie uma segunda conta com outro e-mail
-- (caso ÁGABE, matrícula 70023512: cadastrou-se de novo com um Gmail; a conta nova ficou
-- sem perfil e ele seguia sem acesso). A tela de cadastro passa a perguntar à Edge Function
-- login-matricula (acao "verificar_cadastro") antes de chamar auth.signUp.
--
-- "Tem conta" = existe linha em app_users com a matrícula E um auth.users com o mesmo e-mail.
-- Só o perfil não basta: há fiscais pré-cadastrados pelo admin (e-mail real, sem login)
-- que precisam continuar podendo se cadastrar.

-- 1. Função consultada só pela Edge Function (service_role). Devolve apenas booleano.
create or replace function public.matricula_tem_conta(p_matricula text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.app_users a
      join auth.users u on lower(u.email) = a.email
     where a.matricula = p_matricula
       and u.deleted_at is null
  );
$$;

revoke all on function public.matricula_tem_conta(text) from public, anon, authenticated;
grant execute on function public.matricula_tem_conta(text) to service_role;

-- 2. Limite de tentativas da nova ação (mesma tabela do login/recuperar).
alter table public.login_matricula_tentativas
  drop constraint if exists login_matricula_tentativas_acao_check;
alter table public.login_matricula_tentativas
  add constraint login_matricula_tentativas_acao_check
  check (acao = any (array['login'::text, 'recuperar'::text, 'cadastro'::text]));
