-- Corrige app_users_role_check para aceitar o papel 'eletrica'.
--
-- Contexto: sql/create_eletrica_vistorias.sql (Fase 1 da aba "Elétrica")
-- ampliou contratos_edificacao_pode_ler() e as RLS de eletrica_vistorias para
-- aceitar o papel 'eletrica', e a tela de administração (index.html/admin.js)
-- já oferece essa opção no <select> — mas ninguém tinha atualizado a CHECK
-- constraint de app_users.role, que não vive em nenhum script deste
-- repositório (foi criada direto no dashboard em algum momento anterior).
-- Resultado: salvar um usuário como 'eletrica' falhava com
-- "new row for relation app_users violates check constraint
-- app_users_role_check".
--
-- Lista de valores ANTES (conferida por consulta em produção em 24/09/2026):
--   'pending', 'fiscal', 'gerente', 'externo', 'admin'
-- Lista DEPOIS: a mesma + 'eletrica'.
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase (Dashboard > SQL Editor).

begin;

alter table app_users drop constraint app_users_role_check;

alter table app_users add constraint app_users_role_check
  check (role = ANY (ARRAY['pending'::text, 'fiscal'::text, 'gerente'::text,
                            'externo'::text, 'admin'::text, 'eletrica'::text]));

commit;

-- Verificação pós-migração:
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'app_users_role_check';
-- deve mostrar 'eletrica' na lista.
