-- Script: create_view_processos_financeiro.sql
-- Objetivo: Fornecer uma fonte única e reutilizável (view) com os processos que
-- devem entrar na análise financeira (Painel Financeiro), evitando que cada
-- relatório precise reimplementar a regra de negócio abaixo.
--
-- Regra de negócio:
--   - Processos com status APROVADO sempre entram (a GECOPE já concluiu a revisão).
--   - Processos com status ARQUIVADO só entram quando já foram efetivamente
--     revisados pela GECOPE, ou seja, quando existem valores de repercussão
--     tanto da Fiscalização quanto da GECOPE (reperc_fiscal <> 0 E reperc_gecope <> 0).
--     Isso evita contabilizar processos arquivados que nunca chegaram a ser
--     analisados pela GECOPE (sem dados de revisão), o que sujaria a análise.
--
-- Uso: Cole este script no SQL Editor do projeto Supabase e execute.

create or replace view public.vw_processos_financeiro
with (security_invoker = true)
as
select p.*
from public.processos p
where p.status = 'APROVADO'
   or (
        p.status = 'ARQUIVADO'
        and coalesce(p.reperc_fiscal, 0) <> 0
        and coalesce(p.reperc_gecope, 0) <> 0
      );

-- Garante que os papéis usados pelo cliente (anon/authenticated) consigam
-- consultar a view. Ajuste conforme as políticas de RLS já existentes em
-- "processos" (a view usa security_invoker, então as mesmas RLS se aplicam).
grant select on public.vw_processos_financeiro to anon, authenticated;
