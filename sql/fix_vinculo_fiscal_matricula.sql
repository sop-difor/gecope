-- ============================================================================
-- fix_vinculo_fiscal_matricula.sql — revisão do módulo Processos, 22/09/2026.
--
-- PROBLEMA: um fiscal pode não enxergar processos que são dele.
--
-- A política `processos_select` compara a matrícula em TEXTO PURO:
--
--     processos.fiscal_matricula = (select public.minha_matricula())
--
-- Se o processo foi gravado com `700.248-10` e o cadastro do fiscal em `app_users`
-- tem `70024810` (ou o contrário, ou com espaço sobrando), a comparação é falsa e o
-- BANCO simplesmente não entrega a linha. O processo some da tela do próprio fiscal,
-- sem erro e sem aviso.
--
-- Isso não era visível porque o navegador tinha o MESMO defeito com uma terceira
-- normalização própria, então parecia um problema de tela. Não é: a linha nunca chega
-- ao navegador. O lado do navegador já foi corrigido em
-- modules/processos/processos.js (a revisão usa `normalizarMatriculaFiscal`, que
-- descarta ponto, hífen, barra e espaço — a mesma regra da função criada no bloco [2]).
--
-- ORDEM DE EXECUÇÃO: rode o [1] primeiro e me mande o resultado. Ele NÃO altera nada.
-- Os blocos [2] e [3] só valem a pena se o [1] mostrar divergência.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [1] DIAGNÓSTICO — SOMENTE LEITURA. Quantos vínculos estão dessincronizados?
--
--     Compara a matrícula gravada no processo com a do cadastro do fiscal em
--     `app_users`, do jeito CRU (como a política faz hoje) e do jeito NORMALIZADO
--     (como passaria a fazer). As linhas que aparecem aqui são exatamente os
--     processos que hoje estão invisíveis para o fiscal a que pertencem.
-- ----------------------------------------------------------------------------
with norm as (
  select
    p.id,
    p.processo                                                        as nup,
    p.fiscal                                                          as fiscal_no_processo,
    p.fiscal_matricula                                                as matricula_no_processo,
    u.matricula                                                       as matricula_no_cadastro,
    u.email                                                           as email_do_fiscal,
    upper(regexp_replace(coalesce(p.fiscal_matricula, ''), '[.\-/[:space:]]+', '', 'g')) as mat_processo_norm,
    upper(regexp_replace(coalesce(u.matricula, ''),        '[.\-/[:space:]]+', '', 'g')) as mat_cadastro_norm
  from public.processos p
  join public.app_users u
    on upper(regexp_replace(coalesce(u.matricula, ''), '[.\-/[:space:]]+', '', 'g'))
     = upper(regexp_replace(coalesce(p.fiscal_matricula, ''), '[.\-/[:space:]]+', '', 'g'))
  where p.fiscal_matricula is not null
    and coalesce(u.role, '') = 'fiscal'
    and p.excluido_por is null
)
select
  nup,
  fiscal_no_processo,
  matricula_no_processo,
  matricula_no_cadastro,
  email_do_fiscal
from norm
where matricula_no_processo is distinct from matricula_no_cadastro   -- normalizadas batem, cruas não
order by fiscal_no_processo, nup;


-- ----------------------------------------------------------------------------
-- [2] A FUNÇÃO DE NORMALIZAÇÃO.
--
--     Mesma regra de `normalizarMatriculaFiscal` no JS: maiúsculas, sem ponto,
--     hífen, barra nem espaço. IMMUTABLE para poder ser usada em índice.
-- ----------------------------------------------------------------------------
create or replace function public.normalizar_matricula(m text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select nullif(upper(regexp_replace(coalesce(m, ''), '[.\-/[:space:]]+', '', 'g')), '');
$function$;

-- Índice que sustenta o segundo ramo da política (o normalizado). Sem ele, a
-- comparação normalizada força varredura da tabela a cada consulta do fiscal.
create index if not exists idx_processos_fiscal_matricula_norm
  on public.processos (public.normalizar_matricula(fiscal_matricula));


-- ----------------------------------------------------------------------------
-- [3] A POLÍTICA CORRIGIDA.
--
--     Mantém a comparação CRUA como primeiro ramo — ela usa o índice comum e
--     resolve a maioria esmagadora dos casos sem custo extra. O segundo ramo, o
--     normalizado, só entra quando o primeiro falha, e é o que recupera os
--     processos hoje invisíveis.
--
--     O resto da regra fica igual ao que está em sql/autorizacoes_especiais.sql:
--     quem tem `pode_ver_todos_processos()` continua vendo tudo, e o fiscal
--     continua vendo os processos sem matrícula (fiscal_matricula IS NULL).
--
--     O padrão `(select fn())` é mantido de propósito: sem ele o Postgres reavalia
--     a função linha a linha em vez de cachear como InitPlan.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "processos_select" ON public.processos;
CREATE POLICY "processos_select"
  ON public.processos
  FOR SELECT
  TO authenticated
  USING (
    (select public.pode_ver_todos_processos())
    OR (
      (select public.meu_papel()) = 'fiscal'
      AND (
        processos.fiscal_matricula = (select public.minha_matricula())
        OR public.normalizar_matricula(processos.fiscal_matricula)
           = (select public.normalizar_matricula(public.minha_matricula()))
        OR processos.fiscal_matricula IS NULL
      )
    )
  );


-- ----------------------------------------------------------------------------
-- [4] CONFIRME DEPOIS — deve listar processos_select, processos_insert,
--     processos_update e ia_ro_select, e mais nada.
-- ----------------------------------------------------------------------------
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'processos'
order by cmd, policyname;


-- ============================================================================
-- OBSERVAÇÃO SOBRE A CAUSA DE ORIGEM
--
-- Esta correção faz o sistema TOLERAR a divergência; ela não impede que novas
-- matrículas entrem em formatos diferentes. A causa de origem é não haver
-- normalização na gravação — nem em `processos.fiscal_matricula`, nem em
-- `app_users.matricula`. Padronizar os dados existentes é mexer em dado, o que
-- ficou de fora desta revisão por decisão (ver a seção "O que ficou de fora" em
-- docs/revisoes/2026-09-22-processos.md). O bloco [1] é o ponto de partida para
-- essa conversa quando ela acontecer.
-- ============================================================================
