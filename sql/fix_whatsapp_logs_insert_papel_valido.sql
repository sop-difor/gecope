-- ============================================================================
-- fix_whatsapp_logs_insert_papel_valido.sql — revisão técnica 08/10/2026
-- (docs/code-review/REVIEW.md, #3)
--
-- ACHADO: a policy "whatsapp_logs_insert_authenticated" só exige status = 'processando'.
-- Como o cadastro é aberto (conta nova entra como 'pending'), qualquer pessoa pode inserir
-- logs de WhatsApp com destinatário e mensagem à vontade. O proxy já foi corrigido para
-- recusar contas sem papel válido em /api/whatsapp/send; esta policy fecha o mesmo furo no
-- banco (defesa em profundidade, e impede encher a tabela de logs).
--
-- CORREÇÃO: mesma condição de antes + tem_papel_valido() (admin/gerente/fiscal/externo).
-- processarNotificacao (whatsapp.js) insere o log com o usuário logado, que sempre tem papel.
--
-- Idempotente. Reversão no fim.
-- ============================================================================

-- [1] CONFIRME ANTES: definição atual da policy.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'whatsapp_logs' and cmd = 'INSERT';

-- [2] Aplicação
begin;

drop policy if exists "whatsapp_logs_insert_authenticated" on public.whatsapp_logs;
create policy "whatsapp_logs_insert_authenticated"
  on public.whatsapp_logs
  for insert
  to authenticated
  with check (status = 'processando' and (select public.tem_papel_valido()));

commit;

-- REVERSÃO:
--   drop policy "whatsapp_logs_insert_authenticated" on public.whatsapp_logs;
--   create policy "whatsapp_logs_insert_authenticated" on public.whatsapp_logs
--     for insert to authenticated with check (status = 'processando');
