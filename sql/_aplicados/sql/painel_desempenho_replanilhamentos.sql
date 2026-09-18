-- Painel de desempenho dos replanilhamentos
--
-- Fonte para o dashboard: uma linha por processo valido. A view nao altera os
-- dados de origem e concentra as regras de contagem, evitando que cada grafico
-- trate status, datas e exclusoes de forma diferente.
--
-- Regra de exclusao: a convencao ja usada nas views `vw_gecope_revisao_*` e
-- `excluido_por is null`; `data_exclusao` isoladamente nao basta, pois ha dados
-- legados com essa data preenchida.
--
-- Execute no SQL Editor do Supabase. E seguro executar novamente.

create or replace view public.vw_painel_desempenho_replanilhamentos
with (security_invoker = true)
as
with base as (
  select
    p.id,
    p.processo,
    p.status,
    upper(trim(coalesce(p.status, ''))) as status_normalizado,
    coalesce(nullif(trim(p.analista), ''), 'Nao atribuido') as analista,
    p.fiscal,
    p.contratante,
    p.contratada,
    p.distrito_operacional,
    p.municipio,
    p.prioritario,
    p.data_abertura,
    p.data_recebimento,
    p.data_compromisso_fiscal,
    p.data_devolucao_correcoes,
    p.data_aprovacao_gecope,
    p.created_at,
    p.ultima_atualizacao,
    p.reperc_fiscal,
    p.reperc_gecope,
    coalesce(p.data_recebimento, p.data_abertura, p.created_at::date) as data_entrada
  from public.processos p
  where p.excluido_por is null
), classificacao as (
  select
    b.*,
    case
      when b.status_normalizado = 'ARQUIVADO' then 'Arquivado'
      when b.status_normalizado = 'APROVADO' then 'Aprovado'
      when b.status_normalizado = '' then 'Sem status'
      else 'Em tramitacao'
    end as situacao,
    b.status_normalizado not in ('APROVADO', 'ARQUIVADO') and b.status_normalizado not like 'EXCLU%' as em_tramitacao,
    case
      when b.status_normalizado like '%DEVOLVIDO%' or b.status_normalizado like '%REAN%' then
        coalesce(b.data_devolucao_correcoes, b.ultima_atualizacao::date, b.data_entrada)
      else coalesce(b.ultima_atualizacao::date, b.data_entrada)
    end as data_inicio_status,
    b.status_normalizado in ('APROVADO', 'ARQUIVADO') as encerrado,
    case
      when b.status_normalizado like '%AN%LISE FISCAL%' then 'FISCALIZACAO'
      when b.status_normalizado in ('APROVADO', 'ARQUIVADO') then 'ENCERRADO'
      else 'GECOPE'
    end as responsavel_atual
  from base b
)
select
  c.id,
  c.processo,
  c.status,
  c.status_normalizado,
  c.analista,
  c.fiscal,
  c.contratante,
  c.contratada,
  c.distrito_operacional,
  c.municipio,
  c.prioritario,
  c.data_abertura,
  c.data_recebimento,
  c.data_compromisso_fiscal,
  c.data_devolucao_correcoes,
  c.data_aprovacao_gecope,
  c.created_at,
  c.ultima_atualizacao,
  c.reperc_fiscal,
  c.reperc_gecope,
  c.data_entrada,
  c.situacao,
  c.em_tramitacao,
  c.encerrado,
  date_trunc('month', c.data_entrada)::date as mes_entrada,
  date_trunc('month',
    case when c.encerrado then coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) end
  )::date as mes_conclusao,
  case
    when c.em_tramitacao and c.data_inicio_status is not null
      then greatest(current_date - c.data_inicio_status, 0)
  end as dias_em_aberto,
  case
    when c.encerrado and c.data_entrada is not null
      and coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) is not null
      then greatest(coalesce(c.data_aprovacao_gecope, c.ultima_atualizacao::date) - c.data_entrada, 0)
  end as dias_ate_conclusao,
  case
    when c.responsavel_atual <> 'FISCALIZACAO' or c.data_compromisso_fiscal is null then null
    when c.em_tramitacao then current_date > c.data_compromisso_fiscal
    when c.data_aprovacao_gecope is not null
      then c.data_aprovacao_gecope > c.data_compromisso_fiscal
  end as meta_estourada,
  coalesce(c.reperc_fiscal, 0) - coalesce(c.reperc_gecope, 0) as impacto_revisao,
  case
    when nullif(abs(c.reperc_fiscal), 0) is not null
      then (coalesce(c.reperc_fiscal, 0) - coalesce(c.reperc_gecope, 0))
           / abs(c.reperc_fiscal)
  end as percentual_impacto_revisao,
  c.data_inicio_status,
  c.responsavel_atual
from classificacao c;

comment on view public.vw_painel_desempenho_replanilhamentos is
  'Base analitica, uma linha por processo de replanilhamento valido, para o painel de desempenho.';

grant select on public.vw_painel_desempenho_replanilhamentos to authenticated;

-- Resumo atual para os cartoes principais do painel.
select
  count(*) as processos_validos,
  count(*) filter (where em_tramitacao) as em_tramitacao,
  count(*) filter (where em_tramitacao and responsavel_atual = 'GECOPE') as carteira_gecope,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO') as em_fiscalizacao,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO' and meta_estourada) as atrasados_fiscalizacao,
  count(*) filter (where encerrado) as encerrados,
  round(avg(dias_em_aberto) filter (where em_tramitacao and responsavel_atual = 'GECOPE'), 1) as idade_media_carteira_gecope_dias,
  round(avg(dias_em_aberto) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO'), 1) as idade_media_fiscalizacao_dias
from public.vw_painel_desempenho_replanilhamentos;

-- Composicao atual da carteira para grafico por status e responsavel.
select
  responsavel_atual,
  status,
  count(*) as processos,
  count(*) filter (where prioritario) as prioritarios,
  count(*) filter (where meta_estourada) as metas_estouradas,
  round(avg(dias_em_aberto), 1) as idade_media_dias
from public.vw_painel_desempenho_replanilhamentos
where em_tramitacao
group by responsavel_atual, status
order by responsavel_atual, processos desc, status;

-- Indicadores mensais: entradas e conclusoes sao agrupadas em suas competencias.
with meses as (
  select mes_entrada as mes from public.vw_painel_desempenho_replanilhamentos where mes_entrada is not null
  union
  select mes_conclusao from public.vw_painel_desempenho_replanilhamentos where mes_conclusao is not null
), entradas as (
  select mes_entrada as mes, count(*) as recebidos
  from public.vw_painel_desempenho_replanilhamentos where mes_entrada is not null group by 1
), conclusoes as (
  select mes_conclusao as mes, count(*) as concluidos,
    round(avg(dias_ate_conclusao), 1) as tempo_medio_conclusao_dias,
    round((percentile_cont(0.5) within group (order by dias_ate_conclusao))::numeric, 1) as mediana_conclusao_dias,
    count(*) filter (where data_compromisso_fiscal is not null
      and coalesce(data_aprovacao_gecope, ultima_atualizacao::date) > data_compromisso_fiscal
    ) as conclusoes_apos_meta_fiscal,
    coalesce(sum(impacto_revisao), 0) as impacto_revisao_concluidos
  from public.vw_painel_desempenho_replanilhamentos where mes_conclusao is not null group by 1
)
select m.mes as mes_referencia, coalesce(e.recebidos, 0) as recebidos,
  coalesce(c.concluidos, 0) as concluidos, c.tempo_medio_conclusao_dias,
  c.mediana_conclusao_dias, coalesce(c.conclusoes_apos_meta_fiscal, 0) as conclusoes_apos_meta_fiscal,
  coalesce(c.impacto_revisao_concluidos, 0) as impacto_revisao_concluidos
from meses m left join entradas e on e.mes = m.mes
left join conclusoes c on c.mes = m.mes
order by 1;

-- Recorte atual por analista: carga, atraso e produtividade acumulada.
select
  case upper(trim(analista))
    when 'A' then 'Ada'
    when 'F' then 'Felipe'
    when 'H' then 'Helder'
    when 'N' then 'Nildeno'
    when 'P' then 'Pedro'
    when 'W' then 'Walace'
    else analista
  end as analista,
  count(*) filter (where em_tramitacao and responsavel_atual = 'GECOPE') as carteira_gecope,
  count(*) filter (where encerrado) as encerrados,
  round(avg(dias_em_aberto) filter (where em_tramitacao and responsavel_atual = 'GECOPE'), 1) as idade_media_carteira_gecope_dias,
  round(avg(dias_ate_conclusao) filter (where encerrado), 1) as tempo_medio_conclusao_dias,
  coalesce(sum(impacto_revisao) filter (where encerrado), 0) as impacto_revisao_acumulado
from public.vw_painel_desempenho_replanilhamentos
group by analista
order by carteira_gecope desc, idade_media_carteira_gecope_dias desc nulls last, analista;

-- Recorte atual da Fiscalizacao, agrupado pelo fiscal responsavel no GECOPE.
select
  coalesce(nullif(trim(fiscal), ''), 'Nao informado') as fiscal,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO') as processos_em_fiscalizacao,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO' and meta_estourada) as atrasados_fiscalizacao,
  round(avg(dias_em_aberto) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO'), 1) as idade_media_fiscalizacao_dias,
  count(*) filter (where em_tramitacao and responsavel_atual = 'FISCALIZACAO' and prioritario) as prioritarios
from public.vw_painel_desempenho_replanilhamentos
where em_tramitacao and responsavel_atual = 'FISCALIZACAO'
group by 1
order by atrasados_fiscalizacao desc, processos_em_fiscalizacao desc, fiscal;

-- Conferencia: processos em aberto que exigem atencao imediata.
select
  processo,
  status,
  responsavel_atual,
  analista,
  fiscal,
  data_inicio_status,
  data_entrada,
  data_compromisso_fiscal,
  dias_em_aberto,
  meta_estourada,
  prioritario,
  distrito_operacional,
  municipio
from public.vw_painel_desempenho_replanilhamentos
where em_tramitacao
order by meta_estourada desc nulls last, prioritario desc, dias_em_aberto desc nulls last, processo;
