-- Migração: o Admin escolhe quem pode cadastrar a localização das obras.
--
-- Contexto: sql/create_obra_localizacao.sql (09/10/2026) deixou INSERT/UPDATE de obra_localizacao
-- abertos a todos os 5 papéis que leem Contratos (admin, gerente, fiscal, externo, eletrica). Pedido do
-- usuário em 09/10/2026: o Admin decide QUEM pode cadastrar, pessoa a pessoa.
--
-- Regra nova (mesmo padrão de "Processos: gravar" e "Orçamentos: gravar", ver sql/autorizacoes_especiais.sql):
--   - admin e gerente cadastram pelo papel;
--   - fiscal, externo e eletrica só cadastram com a autorização especial 'localizacao_cadastrar',
--     concedida e revogada pelo Admin na tela Administração > Autorizações Especiais;
--   - quem não lê o módulo Contratos (ex.: conta pendente) nunca cadastra, mesmo com a autorização.
--   - remover continua só admin/gerente (policy obra_localizacao_delete, inalterada); leitura inalterada.
--
-- O que este script faz:
--   1. inclui 'localizacao_cadastrar' na lista fechada de permissões (CHECK de autorizacoes_especiais);
--   2. cria public.pode_cadastrar_localizacao();
--   3. recria as policies de INSERT e UPDATE de obra_localizacao usando essa função.
--
-- EFEITO IMEDIATO: depois de aplicar, fiscal/externo/eletrica deixam de cadastrar até o Admin conceder.
-- Pontos já gravados (155 da planilha) não mudam. Idempotente.
--
-- Conferência pós-aplicação (rodar à parte):
--   select policyname, cmd, with_check from pg_policies where tablename = 'obra_localizacao' order by cmd;

begin;

-- 1. lista fechada de permissões concedíveis
alter table public.autorizacoes_especiais drop constraint if exists autorizacoes_especiais_permissao_check;
alter table public.autorizacoes_especiais add constraint autorizacoes_especiais_permissao_check
  check (permissao in (
    'financeiro',
    'assistente_dados',
    'processos_ver_todos',
    'processos_gravar',
    'composicoes_editar_terceiros',
    'orcamentos_gravar',
    'localizacao_cadastrar'
  ));

-- 2. quem pode cadastrar (gravar/alterar) a localização de uma obra
create or replace function public.pode_cadastrar_localizacao()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select public.contratos_edificacao_pode_ler()
     and (public.meu_papel() in ('admin','gerente')
          or public.tenho_autorizacao('localizacao_cadastrar'));
$function$;

-- 3. policies de escrita (select e delete não mudam)
drop policy if exists obra_localizacao_insert on public.obra_localizacao;
create policy obra_localizacao_insert on public.obra_localizacao
  for insert to authenticated
  with check ((select public.pode_cadastrar_localizacao()));

drop policy if exists obra_localizacao_update on public.obra_localizacao;
create policy obra_localizacao_update on public.obra_localizacao
  for update to authenticated
  using ((select public.pode_cadastrar_localizacao()))
  with check ((select public.pode_cadastrar_localizacao()));

commit;
