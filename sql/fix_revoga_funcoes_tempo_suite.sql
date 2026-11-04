-- Revisão de segurança de 04/11/2026 (item 5): as funções de recálculo do tempo no SUITE
-- são SECURITY DEFINER (ignoram RLS) e qualquer usuário logado — inclusive conta ainda não
-- aprovada — podia chamá-las pela API (/rest/v1/rpc/...) e regravar processos.tempo_suite.
-- Não vazam dados (devolvem número/void), mas permitiam alterar processos sem permissão.
--
-- Quem as usa de verdade continua funcionando:
--   * trigger trg_atualizar_tempo_suite em historico_suite_eventos (roda como dono);
--   * as próprias funções entre si (SECURITY DEFINER, rodam como dono);
--   * Edge Function sincronizar-suite (service_role, mantida).
-- O front-end não chama nenhuma delas (conferido em 04/11/2026).

begin;

revoke execute on function public.atualizar_tempo_suite_processo()                 from public, anon, authenticated;
revoke execute on function public.atualizar_tempo_suite_processo(uuid)             from public, anon, authenticated;
revoke execute on function public.atualizar_tempos_suite()                         from public, anon, authenticated;
revoke execute on function public.atualizar_tempos_suite_processos(uuid[])         from public, anon, authenticated;
revoke execute on function public.calcular_tempo_suite_processo(uuid)              from public, anon, authenticated;
revoke execute on function public.calcular_tempo_suite_periodo(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.trg_atualizar_tempo_suite()                      from public, anon, authenticated;

grant execute on function public.atualizar_tempo_suite_processo(uuid)             to service_role;
grant execute on function public.atualizar_tempos_suite()                         to service_role;
grant execute on function public.atualizar_tempos_suite_processos(uuid[])         to service_role;
grant execute on function public.calcular_tempo_suite_processo(uuid)              to service_role;
grant execute on function public.calcular_tempo_suite_periodo(uuid, timestamptz, timestamptz) to service_role;

commit;

-- Rollback:
-- grant execute on function public.atualizar_tempo_suite_processo(uuid), public.atualizar_tempos_suite(),
--   public.atualizar_tempos_suite_processos(uuid[]), public.calcular_tempo_suite_processo(uuid),
--   public.calcular_tempo_suite_periodo(uuid, timestamptz, timestamptz),
--   public.atualizar_tempo_suite_processo(), public.trg_atualizar_tempo_suite() to authenticated;
