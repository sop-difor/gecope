-- ============================================================================
-- fix_rls_cache_funcoes_auxiliares.sql — achado ao lado do Passo 5 de remedição de
-- egress (22/09/2026), complementar a fix_composicoes_orcamentos_write_authenticated_leftover.sql.
--
-- ACHADO DE DESEMPENHO: várias políticas de RLS, em várias tabelas, chamam funções
-- auxiliares "caras" (STABLE SECURITY DEFINER, a maioria consultando app_users por
-- dentro) SEM o padrão `(select fn())` — um padrão que este mesmo projeto já usa
-- corretamente em `processos` e em `contratos_edificacao_select` (achado documentado em
-- comentário de 17/09, "recomendação oficial de performance de RLS do Supabase": sem o
-- wrapper, o Postgres reavalia a função UMA VEZ POR LINHA lida, em vez de uma vez por
-- consulta — cacheada como "InitPlan").
--
-- CONFIRMADO ao vivo (22/09) via `EXPLAIN ANALYZE` numa consulta real a `processos`: o
-- padrão `(select fn())` funciona exatamente como esperado lá (avaliação única,
-- `loops=1`). O problema é que esse padrão só foi aplicado em `processos` e em
-- `contratos_edificacao_select` — as outras ~35 políticas abaixo, em 15 tabelas, ainda
-- chamam a função sem o wrapper.
--
-- Funções confirmadas (leitura do código-fonte) consultando `app_users` por dentro:
-- `app_users_is_admin()`, `meu_papel()`, `tem_papel_valido()`, `pode_gravar_orcamentos()`,
-- `pode_editar_composicoes_terceiros()`. As demais (`contratos_edificacao_pode_ler/
-- escrever()`, `checklist_aditivo_pode_ler/escrever()`, `alerta_retorno_pode_ler/
-- escrever()`, `curva_abc_pode_ler/escrever()`) não têm o corpo versionado neste
-- repositório para conferir — mas seguem a mesma convenção de nomenclatura e assinatura
-- (STABLE SECURITY DEFINER) das confirmadas, e envolvê-las com `(select ...)` é seguro e
-- sem custo mesmo se alguma delas não consultar app_users (é só cache de resultado,
-- nunca muda o valor).
--
-- Candidata mais provável a maior contribuinte, pelo volume medido no Passo 5:
-- `composicoes_biblioteca`/`orcamentos_biblioteca` (`tem_papel_valido()`) e
-- `app_notifications` (`app_users_is_admin()`, tabela varrida ~79 mil vezes/dia mesmo
-- tendo só 83 linhas). Aplique fix_composicoes_orcamentos_write_authenticated_leftover.sql
-- PRIMEIRO — depois de remover a política guarda-chuva de lá, o SELECT de
-- composicoes_biblioteca ainda fica coberto por composicoes_biblioteca_read_public (true,
-- sem custo), então o ganho de desempenho do SELECT ali é só para INSERT/UPDATE, que
-- passam a ser checados de verdade.
--
-- SEM MUDANÇA DE COMPORTAMENTO: cada bloco abaixo é o texto exato da política atual (via
-- pg_policies, 22/09/2026), só com `(select ...)` em volta de cada chamada de função —
-- mesmo papel (TO), mesmo comando, mesma condição lógica.
-- ============================================================================

-- [0] CONFIRME ANTES: leia as políticas atuais das 14 tabelas abaixo e compare com o que
--     este script assume. Se algo mudou desde 22/09, PARE antes de aplicar.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in (
  'aditivos_contrato','alerta_retorno_comentarios','app_notifications',
  'autorizacoes_especiais','checklist_documentacao_aditivo','comissao_fiscalizacao',
  'composicoes_biblioteca','config_whatsapp','contratos_edificacao',
  'curva_abc_itens','curva_abc_versoes','ficha_contrato','medicoes',
  'orcamentos_biblioteca','whatsapp_logs'
)
order by tablename, policyname;

-- [1] Aplique os blocos abaixo.

-- aditivos_contrato -----------------------------------------------------------------
drop policy if exists "leitura autenticada aditivos_contrato" on public.aditivos_contrato;
create policy "leitura autenticada aditivos_contrato"
  on public.aditivos_contrato
  for select
  to authenticated
  using ((select public.contratos_edificacao_pode_ler()));

-- alerta_retorno_comentarios ---------------------------------------------------------
drop policy if exists "alerta_retorno_insert" on public.alerta_retorno_comentarios;
create policy "alerta_retorno_insert"
  on public.alerta_retorno_comentarios
  for insert
  to public
  with check ((select public.alerta_retorno_pode_escrever()));

drop policy if exists "alerta_retorno_select" on public.alerta_retorno_comentarios;
create policy "alerta_retorno_select"
  on public.alerta_retorno_comentarios
  for select
  to public
  using ((select public.alerta_retorno_pode_ler()));

-- app_notifications (maior suspeita de volume: ~79 mil varreduras/dia numa tabela de 83 linhas)
drop policy if exists "app_notifications_delete_admin" on public.app_notifications;
create policy "app_notifications_delete_admin"
  on public.app_notifications
  for delete
  to authenticated
  using ((select public.app_users_is_admin()));

drop policy if exists "app_notifications_select_admin" on public.app_notifications;
create policy "app_notifications_select_admin"
  on public.app_notifications
  for select
  to authenticated
  using ((select public.app_users_is_admin()));

drop policy if exists "app_notifications_update_admin" on public.app_notifications;
create policy "app_notifications_update_admin"
  on public.app_notifications
  for update
  to authenticated
  using ((select public.app_users_is_admin()))
  with check ((select public.app_users_is_admin()));

-- autorizacoes_especiais --------------------------------------------------------------
drop policy if exists "autorizacoes_insert" on public.autorizacoes_especiais;
create policy "autorizacoes_insert"
  on public.autorizacoes_especiais
  for insert
  to authenticated
  with check ((select public.meu_papel()) = 'admin');

drop policy if exists "autorizacoes_select" on public.autorizacoes_especiais;
create policy "autorizacoes_select"
  on public.autorizacoes_especiais
  for select
  to authenticated
  using (
    (select public.meu_papel()) = 'admin'
    or lower(usuario_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "autorizacoes_update" on public.autorizacoes_especiais;
create policy "autorizacoes_update"
  on public.autorizacoes_especiais
  for update
  to authenticated
  using ((select public.meu_papel()) = 'admin')
  with check ((select public.meu_papel()) = 'admin');

-- checklist_documentacao_aditivo -------------------------------------------------------
drop policy if exists "checklist_aditivo_delete" on public.checklist_documentacao_aditivo;
create policy "checklist_aditivo_delete"
  on public.checklist_documentacao_aditivo
  for delete
  to public
  using ((select public.checklist_aditivo_pode_escrever()));

drop policy if exists "checklist_aditivo_insert" on public.checklist_documentacao_aditivo;
create policy "checklist_aditivo_insert"
  on public.checklist_documentacao_aditivo
  for insert
  to public
  with check ((select public.checklist_aditivo_pode_escrever()));

drop policy if exists "checklist_aditivo_select" on public.checklist_documentacao_aditivo;
create policy "checklist_aditivo_select"
  on public.checklist_documentacao_aditivo
  for select
  to public
  using ((select public.checklist_aditivo_pode_ler()));

-- comissao_fiscalizacao ----------------------------------------------------------------
drop policy if exists "leitura autenticada comissao_fiscalizacao" on public.comissao_fiscalizacao;
create policy "leitura autenticada comissao_fiscalizacao"
  on public.comissao_fiscalizacao
  for select
  to authenticated
  using ((select public.contratos_edificacao_pode_ler()));

-- composicoes_biblioteca (aplique fix_composicoes_orcamentos_write_authenticated_leftover.sql
-- antes deste — senão a política guarda-chuva continua mascarando o efeito de insert/update)
drop policy if exists "composicoes_delete" on public.composicoes_biblioteca;
create policy "composicoes_delete"
  on public.composicoes_biblioteca
  for delete
  to authenticated
  using (
    (select public.pode_editar_composicoes_terceiros())
    or lower(criador_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "composicoes_insert" on public.composicoes_biblioteca;
create policy "composicoes_insert"
  on public.composicoes_biblioteca
  for insert
  to authenticated
  with check (
    (select public.tem_papel_valido())
    and lower(criador_email) = lower((select auth.jwt()) ->> 'email')
  );

drop policy if exists "composicoes_select" on public.composicoes_biblioteca;
create policy "composicoes_select"
  on public.composicoes_biblioteca
  for select
  to authenticated
  using ((select public.tem_papel_valido()));

drop policy if exists "composicoes_update" on public.composicoes_biblioteca;
create policy "composicoes_update"
  on public.composicoes_biblioteca
  for update
  to authenticated
  using ((select public.tem_papel_valido()))
  with check ((select public.tem_papel_valido()));

-- config_whatsapp ------------------------------------------------------------------------
drop policy if exists "config_whatsapp_insert_admin" on public.config_whatsapp;
create policy "config_whatsapp_insert_admin"
  on public.config_whatsapp
  for insert
  to public
  with check ((select public.app_users_is_admin()));

drop policy if exists "config_whatsapp_update_admin" on public.config_whatsapp;
create policy "config_whatsapp_update_admin"
  on public.config_whatsapp
  for update
  to public
  using ((select public.app_users_is_admin()))
  with check ((select public.app_users_is_admin()));

-- contratos_edificacao (contratos_edificacao_select JÁ estava correto — não mexido aqui)
drop policy if exists "contratos_edificacao_delete" on public.contratos_edificacao;
create policy "contratos_edificacao_delete"
  on public.contratos_edificacao
  for delete
  to public
  using ((select public.contratos_edificacao_pode_escrever()));

drop policy if exists "contratos_edificacao_insert" on public.contratos_edificacao;
create policy "contratos_edificacao_insert"
  on public.contratos_edificacao
  for insert
  to public
  with check ((select public.contratos_edificacao_pode_escrever()));

drop policy if exists "contratos_edificacao_update" on public.contratos_edificacao;
create policy "contratos_edificacao_update"
  on public.contratos_edificacao
  for update
  to public
  using ((select public.contratos_edificacao_pode_escrever()))
  with check ((select public.contratos_edificacao_pode_escrever()));

-- curva_abc_itens --------------------------------------------------------------------------
drop policy if exists "curva_abc_itens_insert" on public.curva_abc_itens;
create policy "curva_abc_itens_insert"
  on public.curva_abc_itens
  for insert
  to public
  with check ((select public.curva_abc_pode_escrever()));

drop policy if exists "curva_abc_itens_select" on public.curva_abc_itens;
create policy "curva_abc_itens_select"
  on public.curva_abc_itens
  for select
  to public
  using ((select public.curva_abc_pode_ler()));

drop policy if exists "curva_abc_itens_update" on public.curva_abc_itens;
create policy "curva_abc_itens_update"
  on public.curva_abc_itens
  for update
  to public
  using ((select public.curva_abc_pode_escrever()))
  with check ((select public.curva_abc_pode_escrever()));

-- curva_abc_versoes ------------------------------------------------------------------------
drop policy if exists "curva_abc_versoes_delete" on public.curva_abc_versoes;
create policy "curva_abc_versoes_delete"
  on public.curva_abc_versoes
  for delete
  to public
  using ((select public.curva_abc_pode_escrever()));

drop policy if exists "curva_abc_versoes_insert" on public.curva_abc_versoes;
create policy "curva_abc_versoes_insert"
  on public.curva_abc_versoes
  for insert
  to public
  with check ((select public.curva_abc_pode_escrever()));

drop policy if exists "curva_abc_versoes_select" on public.curva_abc_versoes;
create policy "curva_abc_versoes_select"
  on public.curva_abc_versoes
  for select
  to public
  using ((select public.curva_abc_pode_ler()));

drop policy if exists "curva_abc_versoes_update" on public.curva_abc_versoes;
create policy "curva_abc_versoes_update"
  on public.curva_abc_versoes
  for update
  to public
  using ((select public.curva_abc_pode_escrever()))
  with check ((select public.curva_abc_pode_escrever()));

-- ficha_contrato ----------------------------------------------------------------------------
drop policy if exists "leitura autenticada ficha_contrato" on public.ficha_contrato;
create policy "leitura autenticada ficha_contrato"
  on public.ficha_contrato
  for select
  to authenticated
  using ((select public.contratos_edificacao_pode_ler()));

-- medicoes ------------------------------------------------------------------------------------
drop policy if exists "leitura autenticada medicoes" on public.medicoes;
create policy "leitura autenticada medicoes"
  on public.medicoes
  for select
  to authenticated
  using ((select public.contratos_edificacao_pode_ler()));

-- orcamentos_biblioteca (aplique fix_composicoes_orcamentos_write_authenticated_leftover.sql
-- antes deste, mesmo motivo de composicoes_biblioteca acima)
drop policy if exists "orcamentos_delete" on public.orcamentos_biblioteca;
create policy "orcamentos_delete"
  on public.orcamentos_biblioteca
  for delete
  to authenticated
  using ((select public.pode_gravar_orcamentos()));

drop policy if exists "orcamentos_insert" on public.orcamentos_biblioteca;
create policy "orcamentos_insert"
  on public.orcamentos_biblioteca
  for insert
  to authenticated
  with check ((select public.pode_gravar_orcamentos()));

drop policy if exists "orcamentos_select" on public.orcamentos_biblioteca;
create policy "orcamentos_select"
  on public.orcamentos_biblioteca
  for select
  to authenticated
  using ((select public.tem_papel_valido()));

drop policy if exists "orcamentos_update" on public.orcamentos_biblioteca;
create policy "orcamentos_update"
  on public.orcamentos_biblioteca
  for update
  to authenticated
  using ((select public.tem_papel_valido()))
  with check ((select public.tem_papel_valido()));

-- whatsapp_logs ---------------------------------------------------------------------------------
-- Nota: whatsapp_logs_update_admin nunca teve WITH CHECK (só USING) — preservado assim,
-- não é um erro deste script, é o comportamento já existente.
drop policy if exists "whatsapp_logs_delete_admin" on public.whatsapp_logs;
create policy "whatsapp_logs_delete_admin"
  on public.whatsapp_logs
  for delete
  to public
  using ((select public.app_users_is_admin()));

drop policy if exists "whatsapp_logs_select_admin" on public.whatsapp_logs;
create policy "whatsapp_logs_select_admin"
  on public.whatsapp_logs
  for select
  to authenticated
  using ((select public.app_users_is_admin()));

drop policy if exists "whatsapp_logs_update_admin" on public.whatsapp_logs;
create policy "whatsapp_logs_update_admin"
  on public.whatsapp_logs
  for update
  to authenticated
  using ((select public.app_users_is_admin()));

-- [2] CONFIRME DEPOIS: todas as políticas das 14 tabelas devem continuar com o mesmo
--     conjunto de nomes/comandos/papéis de antes (só a condição interna mudou).
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in (
  'aditivos_contrato','alerta_retorno_comentarios','app_notifications',
  'autorizacoes_especiais','checklist_documentacao_aditivo','comissao_fiscalizacao',
  'composicoes_biblioteca','config_whatsapp','contratos_edificacao',
  'curva_abc_itens','curva_abc_versoes','ficha_contrato','medicoes',
  'orcamentos_biblioteca','whatsapp_logs'
)
order by tablename, policyname;
