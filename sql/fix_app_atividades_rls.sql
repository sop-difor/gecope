-- ============================================================================
-- fix_app_atividades_rls.sql — revisão técnica 08/10/2026 (docs/code-review/REVIEW.md, #4)
--
-- ACHADO: a policy "app_atividades_all_authenticated" (ALL, authenticated, USING true /
-- WITH CHECK true) dá a QUALQUER conta autenticada leitura, inserção, alteração e exclusão
-- do feed de atividades. O cadastro é aberto (role 'pending' entra sozinho), então isso
-- vale para qualquer pessoa da internet: pode forjar ou apagar atividades e gravar texto
-- no campo `tipo`, que o feed exibe aos demais usuários.
--
-- O front só faz INSERT (registrarAtividade) e SELECT (carregarAtividades, resumo da home,
-- histórico de prioridade). Nenhum código faz UPDATE ou DELETE em app_atividades.
--
-- CORREÇÃO: troca a policy ALL por duas — SELECT e INSERT — só para quem tem papel válido
-- (admin/gerente/fiscal/externo). Sem policy de UPDATE/DELETE: o banco nega para todos;
-- limpeza manual continua possível pelo SQL Editor (role postgres ignora RLS).
--
-- Idempotente. Reversão no fim do arquivo.
-- ============================================================================

-- [1] CONFIRME ANTES DE APLICAR: veja as policies atuais da tabela. Se houver outra policy
--     permissiva além da "app_atividades_all_authenticated", ela também precisa sair.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_atividades';

-- [2] Aplicação
begin;

drop policy if exists "app_atividades_all_authenticated" on public.app_atividades;

drop policy if exists "app_atividades_select" on public.app_atividades;
create policy "app_atividades_select"
  on public.app_atividades
  for select
  to authenticated
  using ((select public.tem_papel_valido()));

drop policy if exists "app_atividades_insert" on public.app_atividades;
create policy "app_atividades_insert"
  on public.app_atividades
  for insert
  to authenticated
  with check ((select public.tem_papel_valido()));

commit;

-- [3] Conferência (como usuário aprovado no app): a home e a aba Atividades continuam
--     listando; criar/atualizar um processo continua registrando atividade.
--     Como conta 'pending': select * from app_atividades devolve 0 linhas e o insert falha.

-- REVERSÃO (só se algo essencial quebrar):
--   drop policy "app_atividades_select" on public.app_atividades;
--   drop policy "app_atividades_insert" on public.app_atividades;
--   create policy "app_atividades_all_authenticated" on public.app_atividades
--     for all to authenticated using (true) with check (true);
