-- ============================================================================
-- fix_lote_d_acesso_contas_pending.sql — revisão técnica 08/10/2026 (Lote D)
-- docs/code-review/REVIEW.md, itens #16 a #19.
--
-- CONTEXTO: o cadastro do GECOPE é aberto — qualquer pessoa cria uma conta e entra como
-- 'pending'. Várias policies/funções liberam para "qualquer usuário autenticado" (ou até para
-- anon), o que na prática significa qualquer pessoa da internet. O diagnóstico de RLS de
-- 08/10/2026 (sql/diagnostico_exportar_rls_atual.sql) mostrou onde.
--
-- COMO USAR: o arquivo tem 4 BLOCOS INDEPENDENTES. Aplique um por vez, na ordem, e teste o que
-- está indicado no fim de cada bloco. Cada bloco começa com um SELECT de conferência (rode
-- ele primeiro) e termina com a reversão. Nada aqui apaga dado, só troca regras de acesso.
-- Se um bloco falhar, nada dele é aplicado (está dentro de begin/commit).
-- ============================================================================


-- ============================================================================
-- BLOCO 1 (#16) — Storage: só quem tem papel válido envia/troca/apaga arquivos
-- Hoje: policies "Public Upload ..." deixam QUALQUER conta logada (inclusive autocadastro)
-- enviar, sobrescrever e APAGAR arquivos dos buckets orcamentos e composicoes_biblioteca.
-- Leitura pública NÃO muda (decisão #10 pendente).
-- ============================================================================

-- [1.a] Conferir: devem aparecer as 8 policies "Public Upload ..." dos dois buckets.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- [1.b] Aplicar
begin;

drop policy if exists "Public Upload 1e0n1yt_1" on storage.objects;  -- composicoes INSERT
drop policy if exists "Public Upload 1e0n1yt_2" on storage.objects;  -- composicoes UPDATE
drop policy if exists "Public Upload 1e0n1yt_3" on storage.objects;  -- composicoes DELETE
drop policy if exists "Public Upload 1src1ab_1" on storage.objects;  -- orcamentos INSERT
drop policy if exists "Public Upload 1src1ab_2" on storage.objects;  -- orcamentos UPDATE
drop policy if exists "Public Upload 1src1ab_3" on storage.objects;  -- orcamentos DELETE

create policy "storage_composicoes_insert_papel_valido" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'composicoes_biblioteca' and (select public.tem_papel_valido()));
create policy "storage_composicoes_update_papel_valido" on storage.objects
  for update to authenticated
  using (bucket_id = 'composicoes_biblioteca' and (select public.tem_papel_valido()))
  with check (bucket_id = 'composicoes_biblioteca' and (select public.tem_papel_valido()));
create policy "storage_composicoes_delete_papel_valido" on storage.objects
  for delete to authenticated
  using (bucket_id = 'composicoes_biblioteca' and (select public.tem_papel_valido()));

create policy "storage_orcamentos_insert_papel_valido" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'orcamentos' and (select public.tem_papel_valido()));
create policy "storage_orcamentos_update_papel_valido" on storage.objects
  for update to authenticated
  using (bucket_id = 'orcamentos' and (select public.tem_papel_valido()))
  with check (bucket_id = 'orcamentos' and (select public.tem_papel_valido()));
create policy "storage_orcamentos_delete_papel_valido" on storage.objects
  for delete to authenticated
  using (bucket_id = 'orcamentos' and (select public.tem_papel_valido()));

commit;

-- [1.c] Testar (usuário aprovado): enviar um orçamento novo, uma nova versão e uma composição
--       com anexo; excluir um arquivo de teste; abrir os arquivos existentes (leitura segue pública).
-- REVERSÃO: dropar as 6 policies "storage_*_papel_valido" e recriar as "Public Upload ..." com
--   `for insert/update/delete to authenticated` e `bucket_id = '<bucket>'` como condição.


-- ============================================================================
-- BLOCO 2 (#17) — app_users: conta recém-cadastrada só enxerga a PRÓPRIA linha
-- Hoje: a policy "Usuários autenticados podem ver perfis" (SELECT, true) deixa qualquer conta
-- logada ler nome, e-mail, matrícula, TELEFONE e papel de toda a equipe.
-- Depois: lê tudo quem tem papel válido (comportamento de hoje para a equipe); conta 'pending'
-- lê só a própria linha e os registros "fantasma" (e-mail @gecope.app / @sop-ghost.internal),
-- porque o cadastro (core/auth.js, signUpRequest) procura o fantasma pela matrícula para
-- reaproveitá-lo — sem isso, todo cadastro criaria uma linha duplicada.
-- ATENÇÃO (trade-off): os registros fantasma continuam legíveis por contas novas, inclusive o
-- telefone deles. Eliminar isso exige mover a busca do cadastro para uma função segura (mudança
-- de código, fora deste bloco).
-- ============================================================================

-- [2.a] Conferir TODAS as policies atuais de app_users (cole o resultado de volta se algo
--       além da "Usuários autenticados podem ver perfis" permitir SELECT amplo).
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_users'
order by cmd, policyname;

-- [2.b] Aplicar
begin;

drop policy if exists "Usuários autenticados podem ver perfis" on public.app_users;

drop policy if exists "app_users_select_proprio_ou_papel_valido" on public.app_users;
create policy "app_users_select_proprio_ou_papel_valido" on public.app_users
  for select to authenticated
  using (
    (select public.tem_papel_valido())
    or lower(email) = lower(auth.jwt() ->> 'email')
    or email like '%@gecope.app'
    or email like '%@sop-ghost.internal'
  );

commit;

-- [2.c] Testar: (1) entrar como admin, abrir Administração > usuários (lista completa);
--       (2) entrar como fiscal e abrir um processo (lista de fiscais carrega);
--       (3) FAZER UM CADASTRO DE TESTE com a matrícula de um registro fantasma e conferir que
--           NÃO cria linha duplicada em app_users; (4) login com matrícula continua funcionando.
-- REVERSÃO: drop policy "app_users_select_proprio_ou_papel_valido" on public.app_users;
--   create policy "Usuários autenticados podem ver perfis" on public.app_users
--     for select to authenticated using (true);


-- ============================================================================
-- BLOCO 3 (#18) — Funções de cálculo de tempo do SUITE deixam de ser chamáveis por anon
-- Hoje: atualizar_tempos_suite() e afins (SECURITY DEFINER) são executáveis por qualquer pessoa
-- com a chave pública do projeto (que está em config.js): dá para disparar recálculo pesado
-- repetidamente e sobrecarregar o banco. O app só usa essas funções logado ou pelo cron/service.
-- ============================================================================

-- [3.a] Conferir: lista as funções e se anon ainda pode executar.
select p.oid::regprocedure as funcao,
       has_function_privilege('anon', p.oid, 'execute') as anon_executa,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('atualizar_tempo_suite_processo', 'atualizar_tempos_suite',
                    'atualizar_tempos_suite_processos', 'calcular_tempo_suite_periodo',
                    'calcular_tempo_suite_processo');

-- [3.b] Aplicar (funciona mesmo que a assinatura de alguma função seja diferente da esperada)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('atualizar_tempo_suite_processo', 'atualizar_tempos_suite',
                        'atualizar_tempos_suite_processos', 'calcular_tempo_suite_periodo',
                        'calcular_tempo_suite_processo')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- [3.c] Conferir de novo com o SELECT de [3.a]: anon_executa deve ficar false e
--       authenticated_executa true. Testar: o Painel de Fiscais (mapa de obras) ainda carrega;
--       a sincronização do SUITE (sincronizar-suite) roda sem erro no próximo ciclo.
-- REVERSÃO: grant execute on function <assinatura> to anon, public;


-- ============================================================================
-- BLOCO 4 (#19) — Tabelas internas legíveis/graváveis por qualquer conta logada
--   historico_metas: INSERT aberto a qualquer autenticado (dá para forjar histórico de metas);
--   historico_metas, historico_atribuicao_fiscal, config_whatsapp: leitura aberta a qualquer
--   autenticado (quem é fiscal de qual processo; modelos de mensagem do WhatsApp).
-- Depois: só papel válido.
-- ============================================================================

-- [4.a] Conferir
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('historico_metas', 'historico_atribuicao_fiscal', 'config_whatsapp')
order by tablename, cmd, policyname;

-- [4.b] Aplicar
begin;

drop policy if exists "Permitir escrita para todos autenticados" on public.historico_metas;
create policy "historico_metas_insert_papel_valido" on public.historico_metas
  for insert to authenticated
  with check ((select public.tem_papel_valido()));

drop policy if exists "Permitir leitura para todos autenticados" on public.historico_metas;
create policy "historico_metas_select_papel_valido" on public.historico_metas
  for select to authenticated
  using ((select public.tem_papel_valido()));

drop policy if exists "historico_atribuicao_fiscal_select_authenticated" on public.historico_atribuicao_fiscal;
create policy "historico_atribuicao_fiscal_select_papel_valido" on public.historico_atribuicao_fiscal
  for select to authenticated
  using ((select public.tem_papel_valido()));

drop policy if exists "config_whatsapp_select_authenticated" on public.config_whatsapp;
create policy "config_whatsapp_select_papel_valido" on public.config_whatsapp
  for select to authenticated
  using ((select public.tem_papel_valido()));

commit;

-- [4.c] Testar (usuário aprovado): mudar a meta de um processo (grava no histórico); abrir o
--       Painel de Fiscais; disparar uma notificação de WhatsApp (lê a configuração).
-- REVERSÃO: dropar as 4 policies "*_papel_valido" deste bloco e recriar as originais com
--   `to authenticated` e condição `true` (insert: with check (true)).
