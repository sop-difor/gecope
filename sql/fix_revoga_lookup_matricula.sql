-- Revisão de segurança de 04/11/2026 (item 2, passo final): a RPC devolvia nome, sobrenome e
-- e-mail de qualquer matrícula sem login. Desde o PR #68 (publicado em 04/11/2026) o front
-- usa a Edge Function login-matricula e não chama mais esta função.
-- Fica só para service_role (a Edge Function não depende dela, mas não custa manter).

revoke execute on function public.app_users_lookup_by_matricula(text) from public, anon, authenticated;
grant execute on function public.app_users_lookup_by_matricula(text) to service_role;

-- Rollback:
-- grant execute on function public.app_users_lookup_by_matricula(text) to anon, authenticated;
