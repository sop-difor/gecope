-- Revisão de segurança de 04/11/2026: a policy "Usuários podem atualizar próprio perfil"
-- (UPDATE, authenticated, USING email = jwt.email) não tem WITH CHECK, então o usuário pode
-- reescrever qualquer coluna da própria linha. O role já é protegido pelo trigger
-- trg_app_users_block_role_self_change, mas email e matricula não:
--   * matricula: processos_select libera ao fiscal as linhas com fiscal_matricula =
--     minha_matricula(). Um fiscal que troca a própria matrícula pela de outro fiscal ainda
--     sem conta passa a ler os processos dele (o índice único só impede matrícula já em uso).
--   * email: todas as funções de papel casam app_users.email com o e-mail do JWT.
--
-- O front só altera essas colunas pelo painel de admin (modules/administracao/admin.js) e
-- no "claim" de registro fantasma no cadastro (core/auth.js:71, linha com e-mail
-- @gecope.app / @sop-ghost.internal). Os dois casos continuam liberados.

begin;

create or replace function public.app_users_block_identity_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_users_is_admin() then
    return new;
  end if;
  -- claim de registro fantasma no cadastro
  if old.email like '%@gecope.app' or old.email like '%@sop-ghost.internal' then
    return new;
  end if;
  if new.email is distinct from old.email then
    raise exception 'Alteracao de e-mail nao permitida (somente admin).';
  end if;
  if new.matricula is distinct from old.matricula then
    raise exception 'Alteracao de matricula nao permitida (somente admin).';
  end if;
  return new;
end;
$$;

revoke execute on function public.app_users_block_identity_self_change() from public, anon, authenticated;

drop trigger if exists trg_app_users_block_identity_self_change on public.app_users;
create trigger trg_app_users_block_identity_self_change
  before update on public.app_users
  for each row execute function public.app_users_block_identity_self_change();

commit;

-- Rollback:
-- drop trigger if exists trg_app_users_block_identity_self_change on public.app_users;
-- drop function if exists public.app_users_block_identity_self_change();
