-- ============================================================================
-- historico_metas — (1) acabar com os registros repetidos e (2) permitir excluir um registro
--
-- PROBLEMA 1 — a mesma meta aparece 2x na janela "Definir Meta" (mesmo registro, mesmos dias,
-- mesma data meta; autores diferentes, ex.: "Sistema" e o nome do admin).
--   Causa: a chave única `historico_metas_dedupe_key` inclui `autor`. A meta automática
--   (ANÁLISE FISCAL = criação + 20 dias) é gravada pelo "Sistema" ao carregar a tela e TAMBÉM
--   pelo usuário que salva o processo ao mudar o status; como o autor difere, a chave não
--   barra a segunda. O mesmo ocorre quando a pessoa aparece com nomes diferentes ("ADA
--   CATARINA" / "ADA CATARINA SOARES DE SENA COSTA").
--   Diagnóstico de 20/10/2026: 45 processos afetados, 333 linhas no total (40 pares
--   Sistema+usuário; os demais são o mesmo usuário com nome variado).
--
-- PROBLEMA 2 — não existe policy de DELETE em historico_metas (só INSERT e SELECT), então
--   nenhuma exclusão feita pela tela é aceita pelo banco. Esta migração cria a policy, só admin.
--
-- COMO APLICAR: rode cada bloco no SQL Editor do Supabase, na ordem. ANTES de publicar o
-- código novo do navegador (ele passa a usar onConflict sem `autor`, que depende do índice do
-- bloco 3). O código antigo continua funcionando depois deste script (o índice antigo fica).
-- ============================================================================


-- [1] CONFERIR (somente leitura) — o que será apagado
with g as (
  select id, processo_id, registros, meta, dias_estipulados, autor,
         row_number() over (
           partition by processo_id, registros, meta, dias_estipulados
           order by coalesce(autor = 'Sistema', false) desc, length(coalesce(autor, '')) desc, id::text
         ) as rn,
         count(*) over (partition by processo_id, registros, meta, dias_estipulados) as qtd
  from public.historico_metas
)
select p.processo, g.registros, g.dias_estipulados, g.meta, g.autor,
       case when g.rn = 1 then 'FICA' else 'APAGAR' end as destino
from g join public.processos p on p.id = g.processo_id
where g.qtd > 1
order by p.processo, g.registros, g.rn;
-- Esperado: 45 grupos; em cada um, 1 linha FICA (a do "Sistema" quando existe; senão a do
-- nome mais completo) e as outras APAGAR.


-- [2] LIMPAR as repetidas
begin;

delete from public.historico_metas h
using (
  select id,
         row_number() over (
           partition by processo_id, registros, meta, dias_estipulados
           order by coalesce(autor = 'Sistema', false) desc, length(coalesce(autor, '')) desc, id::text
         ) as rn
  from public.historico_metas
) d
where h.id = d.id and d.rn > 1;

commit;


-- [3] IMPEDIR que volte: unicidade pelo CONTEÚDO (sem autor). NULLS NOT DISTINCT mantém o
--     mesmo critério do índice antigo para `meta` e `dias_estipulados` nulos ("meta zerada").
--     O índice antigo (com autor) fica: é redundante, mas o código antigo ainda aponta para ele.
create unique index if not exists historico_metas_conteudo_key
  on public.historico_metas (processo_id, registros, meta, dias_estipulados) nulls not distinct;


-- [4] PERMITIR excluir um registro do histórico — só administrador
begin;

drop policy if exists "historico_metas_delete_admin" on public.historico_metas;
create policy "historico_metas_delete_admin" on public.historico_metas
  for delete to authenticated
  using ((select public.app_users_is_admin()));

commit;


-- [5] CONFERIR depois
select count(*) as grupos_ainda_duplicados from (
  select 1 from public.historico_metas
  group by processo_id, registros, meta, dias_estipulados having count(*) > 1) x;   -- esperado: 0
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'historico_metas' order by cmd;           -- deve listar DELETE
-- Testar: como admin, abrir "Definir Meta" de um processo e excluir um registro do histórico.

-- REVERSÃO:
--   drop policy if exists "historico_metas_delete_admin" on public.historico_metas;
--   drop index if exists public.historico_metas_conteudo_key;
--   (as linhas apagadas no bloco 2 não voltam sem backup — por isso o bloco 1 antes.)
