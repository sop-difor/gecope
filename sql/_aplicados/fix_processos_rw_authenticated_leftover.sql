-- ============================================================================
-- fix_processos_rw_authenticated_leftover.sql — URGENTE, achado ao lado do trabalho de
-- egress, não é sobre egress.
--
-- ACHADO DE SEGURANÇA (18/09/2026): investigando por que app_users (91 linhas) foi
-- varrida ~5,27 milhões de vezes (bloco [3] de sql/diagnostico_egress.sql), achei que o
-- banco em produção tem HOJE uma política de RLS chamada "processos_rw_authenticated"
-- (comando ALL, papel `authenticated`) que NÃO existe em nenhum arquivo deste
-- repositório — nem em sql/rls_processos_composicoes_orcamentos.sql (a migração que
-- criou processos_select/processos_insert/processos_update), nem em nenhum outro script.
--
-- A regra dela, ao vivo (confirmada em resultados/... (7), bloco [5b] do diagnóstico):
--   (COALESCE(app_users.role, '') <> 'fiscal') OR (fiscal_matricula = minha_matricula)
--
-- RLS combina múltiplas políticas permissivas da MESMA tabela com OR — esta política
-- SOMA (não substitui) às regras corretas de processos_insert/processos_update, que
-- exigem role IN ('admin','gerente'). Na prática, hoje:
--
--   Qualquer usuário autenticado cujo papel NÃO seja 'fiscal' pode GRAVAR em processos
--   (INSERT/UPDATE/DELETE) — inclusive:
--     - role = 'externo', documentado em rls_processos_composicoes_orcamentos.sql linha
--       22 como "só leitura";
--     - role = 'pending' (cadastro aguardando aprovação do admin);
--     - um usuário autenticado sem NENHUMA linha em app_users — meu_papel() retorna
--       NULL, e COALESCE(NULL, '') = '' <> 'fiscal' também é verdade.
--
--   Ou seja: a restrição "só admin/gerente grava" das políticas novas está sendo
--   silenciosamente contornada por esta política mais antiga, pra qualquer papel que não
--   seja fiscal.
--
-- Não há registro de quando isso foi criado — a hipótese mais provável é uma etapa
-- anterior à Fase 4 (RLS "de verdade"), cujo DROP foi esquecido quando as políticas novas
-- entraram (processos_select/insert/update têm DROP POLICY IF EXISTS antes de si mesmas;
-- esta não tem DROP nenhum referenciando o nome dela em lugar nenhum do repositório).
--
-- CORREÇÃO: remover a política antiga. As políticas já existentes (processos_select/
-- insert/update) cobrem, sozinhas, tudo que está documentado como intencional.
-- ============================================================================

-- [1] CONFIRME ANTES DE APLICAR: leia a definição completa (USING e WITH CHECK) da
--     política que está prestes a remover. Se o texto que voltar daqui não bater com o
--     que este comentário descreve, PARE e me avise antes de rodar o [2].
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'processos' and policyname = 'processos_rw_authenticated';

-- [2] Remove a política antiga. Idempotente (IF EXISTS) — seguro rodar mesmo se [1] já
--     tiver vindo vazio (ou seja, se ela já não existir mais por algum outro motivo).
drop policy if exists "processos_rw_authenticated" on public.processos;

-- [3] CONFIRME DEPOIS: só devem restar processos_select, processos_insert,
--     processos_update (regras de negócio) e ia_ro_select (leitura do assistente de IA).
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'processos'
order by cmd, policyname;

-- ============================================================================
-- Item de performance (secundário — o achado de segurança acima já é, por si só, a
-- maior parte do motivo de app_users ser varrida tantas vezes, porque a política
-- removida em [2] refazia essa subconsulta a cada linha avaliada). Mas
-- processos_insert/processos_update tinham o MESMO tipo de subconsulta sem o padrão
-- "(select fn())" que faz o Postgres cachear o resultado uma vez por consulta em vez de
-- recalcular por linha — só processos_select já usava esse padrão (comentário na própria
-- migração, linha ~91-93, cita isso como "achado em 2026-09-17" e diz ter sido "a mesma
-- correção aplicada em autorizacoes_especiais.sql", mas na prática só chegou a
-- processos_select).
-- ============================================================================

drop policy if exists "processos_insert" on public.processos;
create policy "processos_insert"
  on public.processos
  for insert
  to authenticated
  with check ((select public.meu_papel()) in ('admin','gerente'));

drop policy if exists "processos_update" on public.processos;
create policy "processos_update"
  on public.processos
  for update
  to authenticated
  using ((select public.meu_papel()) in ('admin','gerente'))
  with check ((select public.meu_papel()) in ('admin','gerente'));
