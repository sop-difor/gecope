-- ============================================================================
-- diagnostico_exportar_rls_atual.sql — SOMENTE LEITURA. Revisão técnica 08/10/2026
-- (docs/code-review/REVIEW.md, #9 e #10).
--
-- Objetivo: trazer para o repositório o que hoje existe só no banco de produção:
--   [1] policies atuais de app_users (sql/_aplicados/rls_app_users.sql está desatualizado)
--   [2] definição da função app_users_lookup_by_matricula (usada no login, sem SQL versionado)
--   [3] policies de Storage (storage.objects) e se os buckets são públicos
--   [4] policies hoje permissivas demais (USING/CHECK = true) em tabelas do schema public
--   [5] funções SECURITY DEFINER do schema public executáveis por anon
--
-- Como usar: rode cada bloco no SQL Editor e cole o resultado de volta na conversa (ou salve
-- em resultados/). Nada aqui altera o banco.
-- ============================================================================

-- [1] Policies de app_users
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_users'
order by cmd, policyname;

-- [2] Função de lookup por matrícula
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'app_users_lookup_by_matricula';

-- [3a] Buckets e se são públicos
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by name;

-- [3b] Policies em storage.objects
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- [4] Policies permissivas demais (condição literal "true") fora as de leitura intencionais
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual = 'true' or with_check = 'true')
order by tablename, policyname;

-- [5] Funções SECURITY DEFINER do schema public que o papel anon pode executar
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;
