-- add_assumir_pre_cadastro.sql — 06/11/2026
--
-- Fiscal pré-cadastrado pelo admin (perfil em app_users com e-mail real, SEM conta de login)
-- que se cadastra com OUTRO e-mail ficava sem perfil: a RLS não deixa a conta nova ver o
-- pré-cadastro, o INSERT esbarra em app_users_matricula_key e sobra só a conta de login.
--
-- Agora o cadastro (signUpRequest, core/auth.js), já com a sessão da conta nova, chama
-- app_users_assumir_pre_cadastro(matricula). Se a matrícula tiver um perfil cujo e-mail não
-- tem login, o perfil passa para o e-mail da conta nova, volta a 'pending' e guarda o e-mail
-- e o papel anteriores para o admin conferir na lista de pendentes (modules/administracao/admin.js).
-- Matrícula, nome, GEDOP, gerência e processos (ligados por fiscal_matricula) ficam como estão.
--
-- Risco aceito: o login não confirma e-mail, então quem souber a matrícula de um pré-cadastrado
-- pode pedir o perfil. Por isso volta a 'pending' e o admin vê o aviso antes de aprovar; "Recusar"
-- desfaz (e-mail e papel anteriores).

-- 1. Colunas de auditoria (nulas fora desse caso).
alter table public.app_users
  add column if not exists pre_cadastro_email_anterior text,
  add column if not exists pre_cadastro_papel_anterior text,
  add column if not exists pre_cadastro_assumido_em timestamptz;

-- 2. O gatilho de identidade aceita a troca de e-mail feita por esta função (sinal local da
--    transação; o PostgREST não expõe set_config, então o navegador não consegue ligá-lo).
create or replace function public.app_users_block_identity_self_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.app_users_is_admin() then return new; end if;
  if old.email like '%@gecope.app' or old.email like '%@sop-ghost.internal' then return new; end if;
  if current_setting('gecope.assumir_pre_cadastro', true) = 'on'
     and new.matricula is not distinct from old.matricula then
    return new;
  end if;
  if new.email is distinct from old.email then
    raise exception 'Alteracao de e-mail nao permitida (somente admin).';
  end if;
  if new.matricula is distinct from old.matricula then
    raise exception 'Alteracao de matricula nao permitida (somente admin).';
  end if;
  return new;
end; $function$;

-- 3. A função chamada pelo cadastro.
--    Devolve: 'assumido' | 'sem_pre_cadastro' | 'mesmo_email' | 'ja_tem_conta' | 'email_em_uso' | 'sem_sessao'
--    'mesmo_email': o perfil já tem o e-mail desta conta; o cadastro segue o caminho antigo
--    (UPDATE pela política do próprio perfil, que também o põe em 'pending').
create or replace function public.app_users_assumir_pre_cadastro(p_matricula text, p_telefone text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_perfil public.app_users%rowtype;
begin
  if v_email = '' then return 'sem_sessao'; end if;

  select * into v_perfil from public.app_users where matricula = p_matricula for update;
  if not found then return 'sem_pre_cadastro'; end if;

  -- Já é o perfil desta conta: não mexe (o caminho antigo do cadastro cuida e põe em 'pending').
  if v_perfil.email = v_email then return 'mesmo_email'; end if;

  -- Perfil com login de verdade não é pré-cadastro.
  if exists (select 1 from auth.users u where lower(u.email) = v_perfil.email and u.deleted_at is null) then
    return 'ja_tem_conta';
  end if;

  -- O e-mail da conta nova já está em outro perfil.
  if exists (select 1 from public.app_users where email = v_email) then
    return 'email_em_uso';
  end if;

  perform set_config('gecope.assumir_pre_cadastro', 'on', true);
  update public.app_users
     set email = v_email,
         role = 'pending',
         telefone_whatsapp = coalesce(nullif(telefone_whatsapp, ''), nullif(p_telefone, '')),
         pre_cadastro_email_anterior = v_perfil.email,
         pre_cadastro_papel_anterior = v_perfil.role,
         pre_cadastro_assumido_em = now(),
         updated_at = now()
   where id = v_perfil.id;
  perform set_config('gecope.assumir_pre_cadastro', 'off', true);

  return 'assumido';
end;
$$;

revoke all on function public.app_users_assumir_pre_cadastro(text, text) from public, anon;
grant execute on function public.app_users_assumir_pre_cadastro(text, text) to authenticated;
