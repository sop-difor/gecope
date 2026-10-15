-- Limpeza das duplicatas de historico_suite_eventos (revisão do Log Ingestion, 15/10/2026)
--
-- Contexto: até 14/10/2026 a Edge Function sincronizar-suite incluía `permanency` no hash
-- `chave_evento`, e o evento mais recente de cada processo ganhava uma linha nova por rodada.
-- A função já foi corrigida e publicada; este script remove as cópias antigas.
-- Medido em 15/10/2026: 75.816 linhas, 18.351 eventos lógicos, 57.465 excedentes, 59 MB.
--
-- Identidade lógica de um evento: (processo_id, nome, status, data_evento, capacity) — a mesma
-- usada por chaveLogicaEvento() na função. Em todos os grupos duplicados só `permanency`
-- (e ordem_evento/sincronizado_em) diferem entre as cópias.
--
-- Qual cópia fica: a de MENOR ordem_evento (desempate: maior id). As funções de tempo
-- (calcular_tempo_suite_processo/_periodo e vw_tempo_fiscal_processo) ordenam por
-- (data_evento, ordem_evento DESC, id); só o último de cada grupo de eventos com a mesma data
-- gera intervalo não nulo, e esse é justamente a linha de menor ordem_evento. Manter essa
-- cópia preserva o resultado exatamente.
--
-- Segurança: tudo roda num único bloco DO (transação). Se qualquer conferência falhar, ele
-- levanta exceção e NADA é aplicado (inclusive o DISABLE TRIGGER).
--   1. o trigger trg_atualizar_tempo_suite é desligado só durante o DELETE, senão cada linha
--      apagada recalcularia o tempo do processo (~57 mil recálculos);
--   2. o tempo_suite calculado antes e depois, nos processos afetados, tem de ser idêntico;
--   3. as linhas restantes têm de ser exatamente o número de eventos lógicos.
--
-- Quando rodar: fora do cron (0 7-20 * * 1-5 UTC), p.ex. depois das 17h de Brasília ou no fim de
-- semana. O ALTER TABLE espera a rodada em andamento terminar e bloqueia escritas até o fim.
-- Não escreve em outras tabelas.

do $$
declare
  v_antes       bigint;
  v_logicos     bigint;
  v_apagadas    bigint;
  v_depois      bigint;
  v_divergentes bigint;
begin
  select count(*) into v_antes from public.historico_suite_eventos;

  select count(*) into v_logicos
  from (
    select 1
    from public.historico_suite_eventos
    group by processo_id, nome, status, data_evento, capacity
  ) s;

  -- Tempo de cada processo que tem duplicata, antes da limpeza.
  create temp table _tempo_antes on commit drop as
  select p.processo_id,
         public.calcular_tempo_suite_processo(p.processo_id) as tempo
  from (
    select distinct processo_id
    from (
      select processo_id
      from public.historico_suite_eventos
      group by processo_id, nome, status, data_evento, capacity
      having count(*) > 1
    ) g
  ) p;

  alter table public.historico_suite_eventos
    disable trigger trg_atualizar_tempo_suite;

  with ranqueadas as (
    select id,
           row_number() over (
             partition by processo_id, nome, status, data_evento, capacity
             order by ordem_evento asc, id desc
           ) as rn
    from public.historico_suite_eventos
  )
  delete from public.historico_suite_eventos h
  using ranqueadas r
  where h.id = r.id
    and r.rn > 1;

  get diagnostics v_apagadas = row_count;

  alter table public.historico_suite_eventos
    enable trigger trg_atualizar_tempo_suite;

  select count(*) into v_depois from public.historico_suite_eventos;

  if v_depois <> v_logicos or v_antes - v_apagadas <> v_depois then
    raise exception 'Conferência falhou: antes=%, apagadas=%, depois=%, logicos=%',
      v_antes, v_apagadas, v_depois, v_logicos;
  end if;

  select count(*) into v_divergentes
  from _tempo_antes a
  where abs(a.tempo - public.calcular_tempo_suite_processo(a.processo_id)) > 0.000001;

  if v_divergentes > 0 then
    raise exception 'Conferência falhou: % processo(s) mudaram de tempo_suite; nada foi aplicado',
      v_divergentes;
  end if;

  raise notice 'OK: % linhas antes, % apagadas, % depois (= eventos lógicos)',
    v_antes, v_apagadas, v_depois;
end
$$;

-- Conferência pós-aplicação (rodar à parte). Esperado: linhas = eventos_logicos, excedentes = 0.
select count(*) as linhas,
       (select count(*) from (select 1 from public.historico_suite_eventos
                              group by processo_id, nome, status, data_evento, capacity) s) as eventos_logicos,
       count(*) - (select count(*) from (select 1 from public.historico_suite_eventos
                                         group by processo_id, nome, status, data_evento, capacity) s) as excedentes,
       (select tgenabled from pg_trigger
         where tgrelid = 'public.historico_suite_eventos'::regclass
           and tgname = 'trg_atualizar_tempo_suite') as trigger_habilitado  -- esperado: 'O'
from public.historico_suite_eventos;

-- Opcional, em execução separada (VACUUM não roda dentro de transação): devolve o espaço
-- das linhas apagadas ao reaproveitamento e atualiza as estatísticas.
-- vacuum (analyze) public.historico_suite_eventos;
