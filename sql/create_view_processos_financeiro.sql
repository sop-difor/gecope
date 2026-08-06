-- Script: create_view_processos_financeiro.sql
-- Objetivo: Fornecer uma fonte única e reutilizável (view) com os processos que
-- devem entrar na análise financeira (Painel Financeiro), evitando que cada
-- relatório precise reimplementar a regra de negócio abaixo.
--
-- Regra de negócio:
--   - Processos com status APROVADO ou ARQUIVADO só entram quando já foram
--     efetivamente revisados pela GECOPE, ou seja, quando existem valores de
--     repercussão tanto da Fiscalização quanto da GECOPE
--     (reperc_fiscal <> 0 E reperc_gecope <> 0). A guarda é a mesma para os
--     dois status: um processo APROVADO com a GECOPE zerada (ex. campo não
--     salvo) não deve ser contabilizado como corte de 100% da repercussão
--     ("corte fantasma") que infla a economia relatada.
--
--   NOTA (melhoria futura, não implementada): usar reperc_gecope <> 0 como
--   prova de "foi revisado" descarta silenciosamente um processo em que a
--   GECOPE legitimamente zerou a repercussão (supressão total do aditivo).
--   O ideal é substituir esse proxy por um sinal explícito de revisão
--   concluída (coluna booleana revisado_gecope ou data_aprovacao_gecope
--   IS NOT NULL).
--
-- Uso: Cole este script no SQL Editor do projeto Supabase e execute.

create or replace view public.vw_processos_financeiro
with (security_invoker = true)
as
select p.*
from public.processos p
where p.status in ('APROVADO', 'ARQUIVADO')
  and coalesce(p.reperc_fiscal, 0) <> 0
  and coalesce(p.reperc_gecope, 0) <> 0;

-- Garante que os papéis usados pelo cliente (anon/authenticated) consigam
-- consultar a view. Ajuste conforme as políticas de RLS já existentes em
-- "processos" (a view usa security_invoker, então as mesmas RLS se aplicam).
grant select on public.vw_processos_financeiro to anon, authenticated;
