-- ============================================================================
-- fix_composicoes_orcamentos_write_authenticated_leftover.sql — URGENTE, achado ao lado
-- do Passo 5 de remedição de egress. Mesma classe de achado que
-- fix_processos_rw_authenticated_leftover.sql (18/09/2026), só que em duas tabelas
-- diferentes, e passou despercebido naquela auditoria por não ter sido a explicação
-- completa do sintoma medido na época.
--
-- ACHADO DE SEGURANÇA (22/09/2026): remedindo egress (Passo 5), app_users continuava
-- sendo varrida em volume enorme (~5,9 milhões de vezes em só 4 dias) MESMO DEPOIS da
-- política processos_rw_authenticated já ter sido removida em 18/09. Investigando,
-- `resultados/Supabase Snippet Untitled query (7).csv` (a MESMA consulta de 18/09 que
-- achou a política de processos) já continha, na mesma lista:
--
--   composicoes_biblioteca_write_authenticated  | ALL | {authenticated} | true
--   orcamentos_biblioteca_write_authenticated   | ALL | {authenticated} | true
--
-- Confirmado ainda valendo em produção agora (22/09), via pg_policies. Mesmo padrão do
-- achado de processos: comando ALL, papel authenticated, sem condição nenhuma (USING e
-- WITH CHECK = true), coexistindo com políticas mais específicas e restritas na mesma
-- tabela (composicoes_insert/update/delete, orcamentos_insert/update/delete — que exigem
-- ser o autor ou ter papel/autorização especial, em sql/rls_processos_composicoes_orcamentos.sql).
--
-- RLS combina múltiplas políticas PERMISSIVAS da mesma tabela com OR — uma política
-- incondicional (true) SOMA-SE às outras e não pode ser restringida por elas. Na prática,
-- hoje, para QUALQUER usuário autenticado (não só admin/gerente, não só o autor):
--
--   composicoes_biblioteca: pode INSERT/UPDATE/DELETE em qualquer linha, sem checar
--     tem_papel_valido() nem ser o criador — composicoes_insert/update/delete existem no
--     banco mas nunca chegam a restringir nada, porque write_authenticated já libera tudo.
--   orcamentos_biblioteca: mesma coisa — pode INSERT/UPDATE/DELETE em qualquer linha, sem
--     checar pode_gravar_orcamentos() (que exige admin/gerente).
--
-- Não mexe em SELECT: composicoes_biblioteca_read_public e "Leitura Publica" (a de
-- orcamentos, restrita a `anon`) já liberavam leitura de propósito, por fora dessas
-- políticas — leitura pública parece ser intenção original (biblioteca compartilhada), e
-- não está em causa aqui. Só a permissão de ESCREVER é o problema.
--
-- Não há registro de origem no repositório (mesmo padrão do achado de processos: sem
-- nenhum DROP POLICY referenciando esses nomes em nenhum arquivo) — hipótese mais
-- provável é a mesma: scaffolding de uma fase anterior à RLS "de verdade", cujo DROP foi
-- esquecido quando composicoes_insert/update/delete e orcamentos_insert/update/delete
-- entraram.
--
-- CORREÇÃO: remover as duas políticas antigas. As políticas já existentes (composicoes_*,
-- orcamentos_*) cobrem, sozinhas, tudo que está documentado como intencional.
-- ============================================================================

-- [1] CONFIRME ANTES DE APLICAR: leia a definição completa das duas políticas prestes a
--     remover. Se o texto que voltar daqui não bater com "ALL / {authenticated} / true /
--     true" para as duas, PARE e me avise antes de rodar o [2].
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('composicoes_biblioteca', 'orcamentos_biblioteca')
  and policyname in ('composicoes_biblioteca_write_authenticated', 'orcamentos_biblioteca_write_authenticated');

-- [2] Remove as duas políticas antigas. Idempotente (IF EXISTS) — seguro rodar mesmo se
--     [1] já tiver vindo vazio.
drop policy if exists "composicoes_biblioteca_write_authenticated" on public.composicoes_biblioteca;
drop policy if exists "orcamentos_biblioteca_write_authenticated" on public.orcamentos_biblioteca;

-- [3] CONFIRME DEPOIS: em composicoes_biblioteca devem restar composicoes_biblioteca_read_public
--     (SELECT, público) e composicoes_select/insert/update/delete (regras de negócio). Em
--     orcamentos_biblioteca devem restar "Leitura Publica" (SELECT, anon) e
--     orcamentos_select/insert/update/delete (regras de negócio).
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename in ('composicoes_biblioteca', 'orcamentos_biblioteca')
order by tablename, cmd, policyname;

-- ============================================================================
-- TESTE MANUAL RECOMENDADO DEPOIS DE APLICAR (o script sozinho não prova que o
-- comportamento mudou, só que a política sumiu): peça para um usuário com papel
-- 'fiscal' ou 'externo' tentar editar ou excluir uma composição/orçamento que NÃO seja
-- dele — antes deste fix, provavelmente conseguia; depois, deve ser barrado.
-- ============================================================================
