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
-- ORDEM DE EXECUÇÃO: rode [0], [1], [1b] e [1c] primeiro e me mande o resultado. Nenhum dos
-- quatro altera nada. Os blocos [2] e [3] só valem a pena se o [1] mostrar divergência, e
-- só são SEGUROS se o [1b] voltar VAZIO.
--
-- ----------------------------------------------------------------------------
-- RESULTADO DO PRÉ-VOO EM 22/09/2026 — **[2] E [3] NÃO FORAM APLICADOS.**
--
--   [0]  as quatro políticas esperadas, e `processos_select` idêntica à que o [3] recria
--        (fora o ramo novo). Nenhum ajuste feito direto no banco.
--   [1]  **VAZIO** — nenhum processo está invisível para o fiscal dele por formato de
--        matrícula. O defeito que este arquivo conserta não está acontecendo.
--   [1b] **VAZIO** — nenhuma colisão de matrícula normalizada entre pessoas.
--
-- Decisão: **não aplicar**. Com o [1] vazio, os blocos [2] e [3] alargariam a política de
-- SELECT e criariam um índice para tolerar uma divergência que não existe. E o [1b] é uma
-- FOTO, não uma garantia: ele diz que hoje não há colisão, não que não haverá — uma
-- matrícula cadastrada amanhã que colapse na chave de outra pessoa faria o ramo normalizado
-- entregar processos de um fiscal a outro, coisa que a comparação crua de hoje impede.
--
-- O arquivo fica no repositório porque o [1] é o diagnóstico para rodar de novo se o
-- sintoma aparecer (fiscal reclamando de processo que não vê). Se aparecer, a cura durável
-- é a da OBSERVAÇÃO SOBRE A CAUSA DE ORIGEM, no fim deste arquivo — normalizar na gravação
-- —, e não alargar a leitura.
-- ----------------------------------------------------------------------------
-- ============================================================================


-- ----------------------------------------------------------------------------
-- [0] CONFIRME ANTES — SOMENTE LEITURA.
--
--     O bloco [3] faz DROP + CREATE da política `processos_select`, reescrevendo-a a
--     partir da cópia versionada em sql/autorizacoes_especiais.sql. Se alguém tiver
--     ajustado a política direto no banco depois de 22/09/2026, esse ajuste seria
--     perdido em silêncio.
--
--     PARE e me avise se o `qual` devolvido aqui divergir do que o bloco [3] recria
--     (a diferença esperada é APENAS o ramo novo, com `normalizar_matricula`).
-- ----------------------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'processos'
order by cmd, policyname;


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
    -- `nullif(..., '')` nos DOIS lados: sem ele, um processo cuja matrícula seja só
    -- pontuação (normaliza para vazio) casaria com todo cadastro de matrícula vazia,
    -- enchendo o diagnóstico de falso positivo. A função do bloco [2] já faz isso — aqui
    -- é repetido inline de propósito, porque o [1] roda ANTES de a função existir.
    on nullif(upper(regexp_replace(coalesce(u.matricula, ''), '[.\-/[:space:]]+', '', 'g')), '')
     = nullif(upper(regexp_replace(coalesce(p.fiscal_matricula, ''), '[.\-/[:space:]]+', '', 'g')), '')
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
-- [1b] COLISÃO — SOMENTE LEITURA. **O bloco que autoriza ou veta os blocos [2] e [3].**
--
--      O [3] ALARGA a política de SELECT: passa a entregar ao fiscal também as linhas
--      cuja matrícula bate depois de normalizada. Isso é seguro enquanto a normalização
--      for injetiva entre pessoas. Se DUAS pessoas diferentes tiverem matrículas que
--      colapsam na mesma chave (`70024-810` e `700248-10` viram as duas `70024810`, e
--      `70024810a` e `70024810A` também, porque a função faz `upper`), uma passaria a
--      enxergar os processos da outra — coisa que a comparação crua de hoje impede.
--
--      RESULTADO ESPERADO: NENHUMA LINHA.
--      Se vier qualquer linha, NÃO aplique [2] e [3]; me mande o resultado primeiro.
-- ----------------------------------------------------------------------------
select
  nullif(upper(regexp_replace(coalesce(u.matricula, ''), '[.\-/[:space:]]+', '', 'g')), '') as chave_normalizada,
  count(distinct lower(u.email))  as pessoas_distintas,
  array_agg(distinct u.matricula) as matriculas_cruas,
  array_agg(distinct u.email)     as emails
from public.app_users u
where nullif(upper(regexp_replace(coalesce(u.matricula, ''), '[.\-/[:space:]]+', '', 'g')), '') is not null
group by 1
having count(distinct lower(u.email)) > 1;


-- ----------------------------------------------------------------------------
-- [1c] O OUTRO CAMINHO PARA O MESMO SINTOMA — SOMENTE LEITURA.
--
--      O [1] só enxerga processos cuja matrícula casa com ALGUÉM depois de normalizada. Um
--      processo com matrícula que não bate com cadastro nenhum — dígito trocado, matrícula
--      antiga, servidor que saiu — não aparece lá, e **some da tela do fiscal do mesmo
--      jeito**: a política exige `fiscal_matricula = minha_matricula()` ou NULL, e essa
--      linha não atende a nenhum dos dois. Admin e gerente continuam vendo, então o
--      processo não some do sistema — some de quem deveria tocá-lo.
--
--      Normalizar a comparação NÃO resolve esse caso. A correção é no dado: acertar a
--      matrícula do processo, ou apagá-la (com `fiscal_matricula IS NULL` a política já
--      entrega a linha a todos os fiscais, que foi decisão anterior).
--
--      Traz `fiscal` e `status` de propósito: é por eles que se reconhece se a linha é um
--      processo vivo que alguém deveria estar tocando ou resíduo antigo.
-- ----------------------------------------------------------------------------
select
  p.processo         as nup,
  p.fiscal           as fiscal_no_processo,
  p.fiscal_matricula as matricula_no_processo,
  p.status
from public.processos p
where p.fiscal_matricula is not null
  and p.excluido_por is null
  and not exists (
    select 1
    from public.app_users u
    where nullif(upper(regexp_replace(coalesce(u.matricula, ''),        '[.\-/[:space:]]+', '', 'g')), '')
        = nullif(upper(regexp_replace(coalesce(p.fiscal_matricula, ''), '[.\-/[:space:]]+', '', 'g')), '')
  )
order by p.fiscal, p.processo;


-- ----------------------------------------------------------------------------
-- [2] A FUNÇÃO DE NORMALIZAÇÃO.
--
--     Mesma regra de `normalizarMatriculaFiscal` no JS: maiúsculas, sem ponto,
--     hífen, barra nem espaço. IMMUTABLE para poder ser usada em índice.
--
--     Os blocos [2] e [3] são UMA transação: entre o DROP e o CREATE da política existe
--     um instante em que a tabela `processos` está com RLS ligado e SEM política de
--     SELECT — nesse intervalo ela devolve ZERO linhas para todo mundo, admin inclusive.
--     Rodando dentro de BEGIN/COMMIT isso nunca fica visível, e um erro em qualquer
--     ponto desfaz tudo em vez de deixar a tabela invisível para a aplicação inteira.
--     Cole os dois blocos JUNTOS, do BEGIN ao COMMIT.
--
--     AVISO sobre a função ser IMMUTABLE: ela sustenta o índice criado logo abaixo. Se a
--     regra de normalização for alterada um dia com `create or replace`, o índice fica
--     silenciosamente corrompido (guarda valores da regra antiga) e exige `REINDEX INDEX
--     idx_processos_fiscal_matricula_norm`.
-- ----------------------------------------------------------------------------
BEGIN;

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

COMMIT;


-- ----------------------------------------------------------------------------
-- [4] CONFIRME DEPOIS — deve listar processos_select, processos_insert,
--     processos_update e ia_ro_select, e mais nada.
--
--     Traz `qual` e `with_check` de propósito: sem a condição à vista não dá para
--     conferir se a política aplicada é a esperada — só que ela existe. O `qual` de
--     `processos_select` deve mostrar os três ramos do fiscal, incluindo o de
--     `normalizar_matricula`.
-- ----------------------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
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
