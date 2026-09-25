-- Amplia o acesso do papel 'eletrica' a Composições, Orçamentos e Curva ABC (pedido do
-- usuário, 25/09/2026) — Contratos (mapa de obras) já tinha sido liberado na Fase 1 de
-- Vistorias Elétricas (ver sql/create_eletrica_vistorias.sql). Tabelas (tabelas_itens/
-- referencia_carregada) não tem policy de RLS por papel neste repositório — é aberta a
-- qualquer autenticado — então não precisa de mudança aqui, só no front (index.html).
--
-- Nota histórica: sql/create_eletrica_vistorias.sql dizia explicitamente "não tocamos
-- tem_papel_valido() (governa Processos/Composições/Orçamentos, módulos alheios a esta
-- feature)" — decisão deliberada na época para MANTER eletrica fora desses 3 módulos.
-- Este script reverte essa decisão para Composições/Orçamentos (não para Processos, que
-- continua fora do pedido do usuário e usa checagem própria em meu_papel(), não em
-- tem_papel_valido()).
--
-- ATENÇÃO (achado à parte, não é o objetivo deste script): em 25/09/2026,
-- sql/fix_composicoes_orcamentos_write_authenticated_leftover.sql ainda está pendente
-- de aplicação (não está em sql/_aplicados/) — enquanto ele não for rodado, uma policy
-- antiga (`..._write_authenticated`, ALL/authenticated/true) já libera INSERT/UPDATE/
-- DELETE em composicoes_biblioteca e orcamentos_biblioteca para QUALQUER autenticado,
-- inclusive eletrica, por fora de tem_papel_valido(). Ou seja: enquanto aquele fix não
-- for aplicado, eletrica já teria acesso de escrita mesmo sem este script. Rodar este
-- script agora deixa a regra CORRETA já pronta para quando aquele leftover for corrigido
-- (não é urgente resolver os dois juntos, mas registra a dependência).
--
-- Efeito de cada mudança abaixo:
--   tem_papel_valido(): eletrica passa a poder VER e CRIAR composições (mesmo nível que
--     fiscal/externo já têm hoje — composicoes_insert não distingue por papel além de
--     tem_papel_valido()); em orçamentos, eletrica passa a poder VER e comentar (criar/
--     nova versão/excluir continuam só admin/gerente, checados à parte em
--     orcamentos_insert/orcamentos_delete/orcamentos_pode_atualizar()).
--   curva_abc_pode_ler(): eletrica passa a poder ver Curva ABC (mesmo nível de leitura
--     que fiscal já tem); curva_abc_pode_escrever() não muda — salvar nova versão
--     continua só admin/gerente, igual já era para fiscal/externo.
--
-- Idempotente (CREATE OR REPLACE). Uso: rode este arquivo inteiro no SQL Editor do
-- Supabase (Dashboard > SQL Editor).

begin;

create or replace function public.tem_papel_valido()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email')
      and u.role in ('admin','gerente','fiscal','externo','eletrica'));
$function$;

create or replace function public.curva_abc_pode_ler()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from app_users u
    where u.email = auth.jwt() ->> 'email'
      and u.role in ('admin', 'gerente', 'fiscal', 'eletrica')
  );
$$;

commit;

-- Verificação pós-migração:
-- select pg_get_functiondef('public.tem_papel_valido()'::regprocedure);
-- select pg_get_functiondef('public.curva_abc_pode_ler()'::regprocedure);
-- as duas devem listar 'eletrica' na lista de papéis aceitos.
